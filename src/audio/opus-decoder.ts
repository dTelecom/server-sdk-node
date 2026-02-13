/**
 * Opus decoder using opusscript (WASM).
 *
 * @discordjs/opus v0.9.0 segfaults when decoding SILK or hybrid mode
 * Opus frames (TOC configs < 16). WebRTC browsers switch to these modes
 * when bitrate estimation drops below ~52kbps. opusscript (WASM) handles
 * all Opus modes correctly and cannot segfault.
 *
 * @discordjs/opus is still used for encoding (CELT-only at 64kbps) where
 * it works reliably.
 */

import { createLogger } from '../utils/logger';
import { OPUS_SAMPLE_RATE, OPUS_FRAME_SIZE } from './opus-encoder';

const log = createLogger('OpusDecoder');

let OpusDecoderClass: any = null;

function getOpusDecoder(): any {
  if (!OpusDecoderClass) {
    try {
      OpusDecoderClass = require('opusscript');
    } catch {
      throw new Error(
        'opusscript is required for Opus decoding. Install it: npm install opusscript',
      );
    }
  }
  return OpusDecoderClass;
}

export class OpusDecoder {
  private decoder: any;
  private readonly channels: number;

  /**
   * Create an Opus decoder.
   * @param sampleRate Must be 48000 (Opus native rate)
   * @param channels Number of channels (1 = mono, 2 = stereo)
   */
  constructor(sampleRate: number = OPUS_SAMPLE_RATE, channels: number = 1) {
    if (sampleRate !== OPUS_SAMPLE_RATE) {
      throw new Error(`Opus decoder requires ${OPUS_SAMPLE_RATE}Hz, got ${sampleRate}Hz`);
    }
    this.channels = channels;

    const Decoder = getOpusDecoder();
    this.decoder = new Decoder(sampleRate, channels);

    log.debug(`Created Opus decoder: ${sampleRate}Hz, ${channels}ch`);
  }

  /**
   * Decode an Opus frame to PCM16.
   * @param opus Opus-encoded bytes
   * @returns PCM16 samples as Buffer (OPUS_FRAME_SIZE * channels * 2 bytes)
   */
  decode(opus: Buffer): Buffer {
    return this.decoder.decode(opus);
  }

  /**
   * Decode an Opus frame to Int16Array.
   * @param opus Opus-encoded bytes
   * @returns PCM16 samples
   */
  decodeToInt16Array(opus: Buffer): Int16Array {
    const decoded = this.decode(opus);
    return new Int16Array(
      decoded.buffer,
      decoded.byteOffset,
      decoded.byteLength / 2,
    );
  }

  /** Generate a silence frame (packet loss concealment) */
  decodeMissing(): Buffer {
    return Buffer.alloc(OPUS_FRAME_SIZE * this.channels * 2);
  }

  /** Clean up resources */
  destroy(): void {
    if (this.decoder && typeof this.decoder.delete === 'function') {
      this.decoder.delete();
    }
    this.decoder = null;
  }
}
