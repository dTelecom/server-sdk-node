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
import { downsample } from './resampler';
import { AsyncQueue } from '../utils/queue';
import { createLogger } from '../utils/logger';

const log = createLogger('AudioStream');

// Normal packets are emitted immediately. Only absent packets use this grace
// period, so ordinary speech does not acquire a jitter-buffer delay.
const SILENCE_GRACE_MS = 60;
const MAX_TIMESTAMP_GAP_SAMPLES = OPUS_SAMPLE_RATE * 3;

export class AudioStream implements AsyncIterable<AudioFrame> {
  private decoder: OpusDecoder | null = null;
  private queue: AsyncQueue<AudioFrame>;
  private readonly outputSampleRate: number;
  private readonly outputChannels: number;
  private track: MediaStreamTrack | null = null;
  private _closed = false;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private lastTimestamp: number | null = null;
  private lastFrameSamples = 0;
  private lastPacketAt = 0;
  private concealedSamples = 0;
  private currentSsrc: number | null = null;
  private timestampSilenceSamples = 0;
  private stalledSilenceSamples = 0;

  /**
   * @param track The remote audio track to stream from
   * @param sampleRate Desired output sample rate (default: 16000 for STT)
   * @param channels Desired output channels (default: 1 = mono)
   */
  constructor(track: MediaStreamTrack, sampleRate: number = 16000, channels: number = 1) {
    this.outputSampleRate = sampleRate;
    this.outputChannels = channels;
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
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.silenceTimer = null;
    this.queue.close();

    if (this.decoder) {
      this.decoder.destroy();
      this.decoder = null;
    }

    this.track = null;
    log.info(`AudioStream closed: packets=${this.packetCount}, timestamp_silence_ms=${Math.round(this.timestampSilenceSamples / 48)}, stalled_silence_ms=${Math.round(this.stalledSilenceSamples / 48)}`);
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

    // A new source has an independent sequence/timestamp space and codec state.
    if (this.currentSsrc !== rtp.header.ssrc) {
      this.currentSsrc = rtp.header.ssrc;
      this.lastSequence = this.lastTimestamp = null;
      this.concealedSamples = 0;
      this.decoder?.destroy();
      this.decoder = null;
    }

    if (this.lastSequence !== null) {
      const delta = (rtp.header.sequenceNumber - this.lastSequence) & 0xffff;
      // Do not decode duplicates or late reordered packets into current audio.
      if (delta === 0 || delta >= 0x8000) return;
    }

    // Lazy init decoder
    if (!this.decoder) {
      this.decoder = new OpusDecoder(OPUS_SAMPLE_RATE, this.outputChannels);
    }

    try {
      // Defensive copy — werift may reuse internal UDP buffers
      const opusCopy = Buffer.from(payloadCopy);
      const pcmBuffer = this.decoder.decode(opusCopy);

      if (this.lastTimestamp !== null) {
        // RTP timestamps advance during DTX even though sequence numbers do not
        // skip. Subtract silence already emitted by the stall timer exactly once.
        const timestampDelta = (rtp.header.timestamp - this.lastTimestamp) | 0;
        const missing = timestampDelta - this.lastFrameSamples - this.concealedSamples;
        if (missing > 0 && missing <= MAX_TIMESTAMP_GAP_SAMPLES) {
          this.emitSilence(missing);
          this.timestampSilenceSamples += missing;
        } else if (missing > MAX_TIMESTAMP_GAP_SAMPLES || timestampDelta < 0) {
          log.warn('Audio RTP timestamp discontinuity; rebasing receive timeline');
        }
      }

      // Preserve all samples of an accepted speech packet even if network delay
      // made the stall timer advance further than its RTP timestamp.
      this.emitFrame(pcmBuffer);
      this.lastSequence = rtp.header.sequenceNumber;
      this.lastTimestamp = rtp.header.timestamp;
      this.lastFrameSamples = pcmBuffer.length / (2 * this.outputChannels);
      this.lastPacketAt = performance.now();
      this.concealedSamples = 0;
      if (!this.silenceTimer) {
        this.silenceTimer = setInterval(() => this.fillStalledInput(), 20);
        this.silenceTimer.unref();
      }
    } catch (err) {
      log.error(`Opus decode failed (${payloadCopy.length} bytes)`, err);
    }
  }

  private fillStalledInput(): void {
    if (this._closed || this.lastTimestamp === null) return;
    const elapsedSamples = Math.floor((performance.now() - this.lastPacketAt - SILENCE_GRACE_MS) * OPUS_SAMPLE_RATE / 1000);
    const missing = elapsedSamples - this.lastFrameSamples - this.concealedSamples;
    // Bound catch-up work after event-loop stalls; never allocate a huge buffer.
    const samples = Math.min(OPUS_FRAME_SIZE * 5, Math.floor(missing / OPUS_FRAME_SIZE) * OPUS_FRAME_SIZE);
    if (samples > 0) {
      this.emitSilence(samples);
      this.concealedSamples += samples;
      this.stalledSilenceSamples += samples;
    }
  }

  private emitSilence(samples: number): void {
    while (samples > 0) {
      const count = Math.min(samples, OPUS_FRAME_SIZE);
      // Null-packet PLC can segfault the native codec; explicit zeros are safe.
      this.emitFrame(Buffer.alloc(count * this.outputChannels * 2));
      samples -= count;
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
