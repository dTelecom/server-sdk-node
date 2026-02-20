/**
 * AudioSource — feeds PCM16 audio into a local audio track.
 *
 * Handles:
 * - Opus encoding (at input sample rate — libopus handles internal resampling)
 * - Frame buffering to ensure exact 20ms frame boundaries
 * - RTP packetization
 */

import { MediaStreamTrack } from 'werift';
import { AudioFrame } from './audio-frame';
import { OpusEncoder } from './opus-encoder';
import { createLogger } from '../utils/logger';

const log = createLogger('AudioSource');

export class AudioSource {
  readonly sampleRate: number;
  readonly channels: number;

  private encoder: OpusEncoder | null = null;
  private track: MediaStreamTrack | null = null;

  // Buffer for accumulating samples to form exact 20ms frames
  private sampleBuffer: Int16Array;
  private bufferOffset: number = 0;
  private readonly frameSize: number;

  // Callback set by LocalAudioTrack to receive encoded Opus frames
  private _onEncodedFrame: ((opusData: Buffer) => void) | null = null;

  /**
   * @param sampleRate Input sample rate (e.g. 16000 for STT/TTS)
   * @param channels Number of channels (1 = mono)
   */
  constructor(sampleRate: number, channels: number = 1) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    // 20ms frame size at input sample rate (e.g. 320 for 16kHz, 960 for 48kHz)
    this.frameSize = (sampleRate * 20 / 1000) * channels;
    this.sampleBuffer = new Int16Array(this.frameSize);
  }

  /** Set the callback for encoded Opus frames. Used internally by LocalAudioTrack. */
  set onEncodedFrame(cb: ((opusData: Buffer) => void) | null) {
    this._onEncodedFrame = cb;
  }

  /** Associate this source with a werift MediaStreamTrack */
  setTrack(track: MediaStreamTrack): void {
    this.track = track;
  }

  /**
   * Feed a PCM16 audio frame into the source.
   *
   * Buffered to 20ms boundaries, Opus-encoded at input sample rate,
   * and sent to the track for RTP transmission.
   */
  async captureFrame(frame: AudioFrame): Promise<void> {
    // Lazy-init encoder at input sample rate — libopus handles resampling internally
    if (!this.encoder) {
      this.encoder = new OpusEncoder(this.sampleRate, this.channels);
    }

    const samples = frame.data;

    // Buffer samples and encode in 20ms chunks
    let offset = 0;
    while (offset < samples.length) {
      const remaining = this.frameSize - this.bufferOffset;
      const available = samples.length - offset;
      const toCopy = Math.min(remaining, available);

      this.sampleBuffer.set(samples.subarray(offset, offset + toCopy), this.bufferOffset);
      this.bufferOffset += toCopy;
      offset += toCopy;

      // Full 20ms frame? Encode and send
      if (this.bufferOffset >= this.frameSize) {
        this.encodeAndSend(this.sampleBuffer);
        this.bufferOffset = 0;
      }
    }
  }

  /** Clear any buffered samples */
  flush(): void {
    // If there are buffered samples, pad with silence and encode
    if (this.bufferOffset > 0) {
      // Zero-fill remaining
      this.sampleBuffer.fill(0, this.bufferOffset);
      this.encodeAndSend(this.sampleBuffer);
      this.bufferOffset = 0;
    }
  }

  /** Release encoder resources */
  destroy(): void {
    if (this.encoder) {
      this.encoder.destroy();
      this.encoder = null;
    }
    this._onEncodedFrame = null;
    this.track = null;
  }

  private _rtpCount = 0;
  private _warnedNoCallback = false;

  private encodeAndSend(pcm: Int16Array): void {
    if (!this.encoder) return;

    try {
      const opusData = this.encoder.encode(pcm);

      if (this._onEncodedFrame) {
        this._onEncodedFrame(opusData);
        this._rtpCount++;
        if (this._rtpCount === 1) {
          log.info(`First RTP packet sent (${opusData.byteLength} bytes)`);
        }
      } else if (!this._warnedNoCallback) {
        this._warnedNoCallback = true;
        log.debug('Waiting for DTLS — buffered audio will be dropped');
      }
    } catch (err) {
      log.error('Opus encode failed', err);
    }
  }
}
