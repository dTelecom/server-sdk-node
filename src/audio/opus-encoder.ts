/**
 * Opus encoder using opusscript (libopus compiled to WASM): about 0.1 ms per 20 ms frame, with no
 * native build at install time.
 *
 * Encodes PCM16 audio into Opus frames. Supports any Opus-valid sample rate
 * (8000, 12000, 16000, 24000, 48000) — libopus handles internal resampling.
 */

import OpusScript from 'opusscript';
import { createLogger } from '../utils/logger';

const log = createLogger('OpusEncoder');

// Opus constants
export const OPUS_FRAME_DURATION_MS = 20;
/** Standard Opus decode rate — used by decoder and RTP (48kHz is the WebRTC standard) */
export const OPUS_SAMPLE_RATE = 48000;
/** 20ms frame size at 48kHz — used by decoder and RTP */
export const OPUS_FRAME_SIZE = OPUS_SAMPLE_RATE * OPUS_FRAME_DURATION_MS / 1000; // 960

/** Valid Opus sample rates */
const VALID_OPUS_RATES = [8000, 12000, 16000, 24000, 48000];

export class OpusEncoder {
  private encoder: OpusScript | null;
  private readonly channels: number;
  /** Number of samples per channel in a 20ms frame at the encoder's sample rate */
  readonly frameSize: number;

  /**
   * Create an Opus encoder.
   * @param sampleRate Sample rate — must be a valid Opus rate (8000, 12000, 16000, 24000, 48000)
   * @param channels Number of channels (1 = mono, 2 = stereo)
   * @param bitrate Target bitrate in bps (default: 64000)
   */
  constructor(sampleRate: number = 48000, channels: number = 1, bitrate: number = 64000) {
    if (!VALID_OPUS_RATES.includes(sampleRate)) {
      throw new Error(`Invalid Opus sample rate: ${sampleRate}Hz. Valid rates: ${VALID_OPUS_RATES.join(', ')}`);
    }
    this.channels = channels;
    this.frameSize = sampleRate * OPUS_FRAME_DURATION_MS / 1000;

    this.encoder = new OpusScript(sampleRate as ConstructorParameters<typeof OpusScript>[0], channels, OpusScript.Application.AUDIO);
    this.encoder.setBitrate(bitrate);

    // Enable DTX (Discontinuous Transmission) — during silence the encoder
    // produces tiny frames instead of full-rate encoded zeros, eliminating
    // artifacts at speech↔silence boundaries. The decoder generates comfort
    // noise automatically. OPUS_SET_DTX_REQUEST = 4016.
    let dtx = false;
    try {
      this.encoder.encoderCTL(4016, 1);
      dtx = true;
    } catch (err) {
      log.warn('Failed to enable DTX:', err);
    }
    log.info(`Opus encoder: opusscript, ${sampleRate}Hz, ${channels}ch, ${bitrate / 1000}kbps, frameSize=${this.frameSize}${dtx ? ', DTX=on' : ''}`);
  }

  /**
   * Encode a PCM16 frame to Opus.
   * @param pcm PCM16 samples (Int16Array or Buffer). Must be exactly frameSize * channels samples.
   * @returns Opus-encoded bytes
   */
  encode(pcm: Buffer | Int16Array): Buffer {
    const buf = pcm instanceof Int16Array
      ? Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      : pcm;
    if (!this.encoder) throw new Error('Opus encoder destroyed');
    return this.encoder.encode(buf, this.frameSize);
  }

  /** Free the WASM encoder. */
  destroy(): void {
    this.encoder?.delete();
    this.encoder = null;
  }
}
