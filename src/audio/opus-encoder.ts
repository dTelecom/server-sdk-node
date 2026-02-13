/**
 * Opus encoder wrapper around @discordjs/opus.
 *
 * Encodes PCM16 audio (48kHz) into Opus frames.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('OpusEncoder');

// Opus constants
export const OPUS_SAMPLE_RATE = 48000;
export const OPUS_FRAME_DURATION_MS = 20;
export const OPUS_FRAME_SIZE = OPUS_SAMPLE_RATE * OPUS_FRAME_DURATION_MS / 1000; // 960

let OpusEncoderClass: any = null;

function getOpusEncoder(): any {
  if (!OpusEncoderClass) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const opus = require('@discordjs/opus');
      OpusEncoderClass = opus.OpusEncoder;
    } catch {
      try {
        // Fallback to opusscript (WASM)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const OpusScript = require('opusscript');
        OpusEncoderClass = OpusScript;
      } catch {
        throw new Error(
          'No Opus library found. Install @discordjs/opus (recommended) or opusscript (WASM fallback).',
        );
      }
    }
  }
  return OpusEncoderClass;
}

export class OpusEncoder {
  private encoder: any;
  private readonly channels: number;

  /**
   * Create an Opus encoder.
   * @param sampleRate Must be 48000 (Opus native rate)
   * @param channels Number of channels (1 = mono, 2 = stereo)
   * @param bitrate Target bitrate in bps (default: 64000)
   */
  constructor(sampleRate: number = OPUS_SAMPLE_RATE, channels: number = 1, bitrate: number = 64000) {
    if (sampleRate !== OPUS_SAMPLE_RATE) {
      throw new Error(`Opus encoder requires ${OPUS_SAMPLE_RATE}Hz, got ${sampleRate}Hz. Resample first.`);
    }
    this.channels = channels;

    const Encoder = getOpusEncoder();
    this.encoder = new Encoder(sampleRate, channels);

    // Set bitrate if the encoder supports it
    if (typeof this.encoder.setBitrate === 'function') {
      this.encoder.setBitrate(bitrate);
    }

    log.debug(`Created Opus encoder: ${sampleRate}Hz, ${channels}ch, ${bitrate}bps`);
  }

  /**
   * Encode a PCM16 frame to Opus.
   * @param pcm PCM16 samples (Int16Array or Buffer). Must be exactly OPUS_FRAME_SIZE * channels samples.
   * @returns Opus-encoded bytes
   */
  encode(pcm: Buffer | Int16Array): Buffer {
    const buf = pcm instanceof Int16Array
      ? Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      : pcm;
    return this.encoder.encode(buf, OPUS_FRAME_SIZE);
  }

  /** Clean up native resources */
  destroy(): void {
    if (this.encoder && typeof this.encoder.delete === 'function') {
      this.encoder.delete();
    }
    this.encoder = null;
  }
}
