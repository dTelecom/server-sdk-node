/**
 * Opus encoder wrapper around @discordjs/opus.
 *
 * Encodes PCM16 audio into Opus frames. Supports any Opus-valid sample rate
 * (8000, 12000, 16000, 24000, 48000) — libopus handles internal resampling.
 */

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

let OpusEncoderClass: any = null;
let opusLibraryName: string = '';

function getOpusEncoder(): any {
  if (!OpusEncoderClass) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const opus = require('@discordjs/opus');
      OpusEncoderClass = opus.OpusEncoder;
      opusLibraryName = '@discordjs/opus (native)';
    } catch {
      try {
        // Fallback to opusscript (WASM)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const OpusScript = require('opusscript');
        OpusEncoderClass = OpusScript;
        opusLibraryName = 'opusscript (WASM)';
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

    const Encoder = getOpusEncoder();
    this.encoder = new Encoder(sampleRate, channels);

    // Set bitrate if the encoder supports it
    if (typeof this.encoder.setBitrate === 'function') {
      this.encoder.setBitrate(bitrate);
    }

    // Enable DTX (Discontinuous Transmission) — during silence the encoder
    // produces tiny frames instead of full-rate encoded zeros, eliminating
    // artifacts at speech↔silence boundaries. The decoder generates comfort
    // noise automatically. OPUS_SET_DTX_REQUEST = 4016.
    if (typeof this.encoder.applyEncoderCTL === 'function') {
      try {
        this.encoder.applyEncoderCTL(4016, 1);
        log.info(`Opus encoder: ${opusLibraryName}, ${sampleRate}Hz, ${channels}ch, ${bitrate / 1000}kbps, frameSize=${this.frameSize}, DTX=on`);
      } catch (err) {
        log.warn('Failed to enable DTX:', err);
        log.info(`Opus encoder: ${opusLibraryName}, ${sampleRate}Hz, ${channels}ch, ${bitrate / 1000}kbps, frameSize=${this.frameSize}`);
      }
    } else {
      log.info(`Opus encoder: ${opusLibraryName}, ${sampleRate}Hz, ${channels}ch, ${bitrate / 1000}kbps, frameSize=${this.frameSize}`);
    }
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
    return this.encoder.encode(buf, this.frameSize);
  }

  /** Clean up native resources */
  destroy(): void {
    if (this.encoder && typeof this.encoder.delete === 'function') {
      this.encoder.delete();
    }
    this.encoder = null;
  }
}
