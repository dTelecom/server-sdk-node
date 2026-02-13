/**
 * AudioSource — feeds PCM16 audio into a local audio track.
 *
 * Handles:
 * - Resampling from user's sample rate (e.g. 16kHz) to Opus rate (48kHz)
 * - Opus encoding
 * - Frame buffering to ensure exact 20ms frame boundaries
 * - RTP packetization
 */

import { MediaStreamTrack } from 'werift';
import { AudioFrame } from './audio-frame';
import { OpusEncoder, OPUS_SAMPLE_RATE, OPUS_FRAME_SIZE } from './opus-encoder';
import { upsample } from './resampler';
import { createLogger } from '../utils/logger';

const log = createLogger('AudioSource');

export class AudioSource {
  readonly sampleRate: number;
  readonly channels: number;

  private encoder: OpusEncoder | null = null;
  private track: MediaStreamTrack | null = null;

  // Buffer for accumulating samples to form exact 20ms frames at 48kHz
  private sampleBuffer: Int16Array;
  private bufferOffset: number = 0;
  private readonly frameSizeAt48k: number;

  // Callback set by LocalAudioTrack to receive encoded Opus frames
  private _onEncodedFrame: ((opusData: Buffer) => void) | null = null;

  /**
   * @param sampleRate Input sample rate (e.g. 16000 for STT/TTS)
   * @param channels Number of channels (1 = mono)
   */
  constructor(sampleRate: number, channels: number = 1) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.frameSizeAt48k = OPUS_FRAME_SIZE * channels; // 960 for mono
    this.sampleBuffer = new Int16Array(this.frameSizeAt48k);
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
   * The frame is resampled to 48kHz, buffered to 20ms boundaries,
   * Opus-encoded, and sent to the track for RTP transmission.
   */
  async captureFrame(frame: AudioFrame): Promise<void> {
    // Lazy-init encoder
    if (!this.encoder) {
      this.encoder = new OpusEncoder(OPUS_SAMPLE_RATE, this.channels);
    }

    // Resample to 48kHz if needed
    let samples = frame.data;
    if (frame.sampleRate !== OPUS_SAMPLE_RATE) {
      samples = upsample(frame.data, frame.sampleRate, OPUS_SAMPLE_RATE, this.channels);
    }

    // Buffer samples and encode in 20ms chunks
    let offset = 0;
    while (offset < samples.length) {
      const remaining = this.frameSizeAt48k - this.bufferOffset;
      const available = samples.length - offset;
      const toCopy = Math.min(remaining, available);

      this.sampleBuffer.set(samples.subarray(offset, offset + toCopy), this.bufferOffset);
      this.bufferOffset += toCopy;
      offset += toCopy;

      // Full 20ms frame? Encode and send
      if (this.bufferOffset >= this.frameSizeAt48k) {
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

  private encodeAndSend(pcm: Int16Array): void {
    if (!this.encoder) return;

    try {
      const opusData = this.encoder.encode(pcm);

      if (this._onEncodedFrame) {
        this._onEncodedFrame(opusData);
      }
    } catch (err) {
      log.error('Opus encode failed', err);
    }
  }
}
