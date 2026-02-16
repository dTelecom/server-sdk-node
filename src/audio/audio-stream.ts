/**
 * AudioStream — async iterable stream of decoded audio frames
 * from a remote participant's audio track.
 *
 * Handles:
 * - RTP depacketization
 * - Opus decoding → PCM16 @ 48kHz
 * - Resampling to desired output rate (e.g. 16kHz for STT)
 * - Packet loss concealment
 */

import { MediaStreamTrack, RtpPacket } from 'werift';
import { AudioFrame } from './audio-frame';
import { OpusDecoder } from './opus-decoder';
import { OPUS_SAMPLE_RATE, OPUS_FRAME_SIZE } from './opus-encoder';
import { OpusRtpDepacketizer } from './rtp-opus';
import { downsample } from './resampler';
import { AsyncQueue } from '../utils/queue';
import { createLogger } from '../utils/logger';

const log = createLogger('AudioStream');

export class AudioStream implements AsyncIterable<AudioFrame> {
  private decoder: OpusDecoder | null = null;
  private depacketizer: OpusRtpDepacketizer;
  private queue: AsyncQueue<AudioFrame>;
  private readonly outputSampleRate: number;
  private readonly outputChannels: number;
  private track: MediaStreamTrack | null = null;
  private _closed = false;

  /**
   * @param track The remote audio track to stream from
   * @param sampleRate Desired output sample rate (default: 16000 for STT)
   * @param channels Desired output channels (default: 1 = mono)
   */
  constructor(track: MediaStreamTrack, sampleRate: number = 16000, channels: number = 1) {
    this.outputSampleRate = sampleRate;
    this.outputChannels = channels;
    this.depacketizer = new OpusRtpDepacketizer();
    this.queue = new AsyncQueue<AudioFrame>();
    this.track = track;
    this.start();
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Close the stream and release resources */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.queue.close();

    if (this.decoder) {
      this.decoder.destroy();
      this.decoder = null;
    }

    this.track = null;
    log.debug('AudioStream closed');
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return this.queue[Symbol.asyncIterator]();
  }

  /** SSRC of the first RTP packet received (for diagnostics) */
  private firstSsrc: number | null = null;
  private packetCount = 0;

  private start(): void {
    if (!this.track) return;

    const trackUuid = (this.track as any).uuid ?? '?';

    // Listen for RTP packets on the track
    this.track.onReceiveRtp.subscribe((rtpPacket: RtpPacket) => {
      if (this._closed) return;

      this.packetCount++;
      if (this.firstSsrc === null) {
        this.firstSsrc = rtpPacket.header.ssrc;
        log.info(`AudioStream first RTP: ssrc=${this.firstSsrc}, trackUuid=${trackUuid}`);
      } else if (rtpPacket.header.ssrc !== this.firstSsrc && this.packetCount < 20) {
        log.warn(`AudioStream SSRC changed: ${this.firstSsrc} → ${rtpPacket.header.ssrc}, trackUuid=${trackUuid}`);
      }

      try {
        this.processRtpPacket(rtpPacket);
      } catch (err) {
        log.error('Failed to process RTP packet', err);
      }
    });

    // Track ended
    this.track.onReceiveRtp.once(() => {
      // Note: werift doesn't have a clean "track ended" event,
      // we rely on the Room/Participant layer to call close()
    });

    log.debug(`AudioStream started, output: ${this.outputSampleRate}Hz ${this.outputChannels}ch, trackUuid=${trackUuid}`);
  }

  private processRtpPacket(rtp: RtpPacket): void {
    // Skip empty payloads
    if (!rtp.payload || rtp.payload.length === 0) {
      return;
    }

    // Ensure payload is a proper Buffer copy (werift may reuse internal buffers)
    const payloadCopy = Buffer.from(rtp.payload);

    // Skip suspiciously large payloads (not Opus)
    if (payloadCopy.length > 1500) {
      log.warn(`Skipping oversized RTP payload: ${payloadCopy.length} bytes`);
      return;
    }

    // Lazy init decoder
    if (!this.decoder) {
      this.decoder = new OpusDecoder(OPUS_SAMPLE_RATE, this.outputChannels);
    }

    const { opusFrame, lost } = this.depacketizer.processPacket(
      payloadCopy,
      rtp.header.sequenceNumber,
      rtp.header.timestamp,
    );

    // Handle packet loss — generate silence frames (PLC via null can segfault native addon)
    for (let i = 0; i < lost && i < 3; i++) {
      const silence = Buffer.alloc(OPUS_FRAME_SIZE * this.outputChannels * 2);
      this.emitFrame(silence);
    }

    // Decode the Opus frame
    if (opusFrame.length < 1) {
      return;
    }

    try {
      // Defensive copy — werift may reuse internal UDP buffers
      const opusCopy = Buffer.alloc(opusFrame.length);
      opusFrame.copy(opusCopy);
      const pcmBuffer = this.decoder.decode(opusCopy);
      this.emitFrame(pcmBuffer);
    } catch (err) {
      log.error(`Opus decode failed (${opusFrame.length} bytes)`, err);
    }
  }

  private emitFrame(pcm48k: Buffer): void {
    // Convert Buffer to Int16Array
    let samples = new Int16Array(
      pcm48k.buffer,
      pcm48k.byteOffset,
      pcm48k.byteLength / 2,
    );

    // Resample to desired output rate
    if (this.outputSampleRate !== OPUS_SAMPLE_RATE) {
      samples = downsample(samples, OPUS_SAMPLE_RATE, this.outputSampleRate, this.outputChannels);
    }

    const samplesPerChannel = samples.length / this.outputChannels;
    const frame = new AudioFrame(samples, this.outputSampleRate, this.outputChannels, samplesPerChannel);
    this.queue.push(frame);
  }
}
