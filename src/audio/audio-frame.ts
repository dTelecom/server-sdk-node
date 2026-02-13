/**
 * AudioFrame — PCM16 audio container.
 *
 * This is the primary audio type exposed to users.
 * All audio flowing in/out of the SDK uses this format.
 */

export class AudioFrame {
  /** PCM16 samples (interleaved if stereo) */
  readonly data: Int16Array;
  /** Sample rate in Hz (e.g. 16000, 48000) */
  readonly sampleRate: number;
  /** Number of channels (1 = mono, 2 = stereo) */
  readonly channels: number;
  /** Number of samples per channel */
  readonly samplesPerChannel: number;

  constructor(data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) {
    this.data = data;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.samplesPerChannel = samplesPerChannel;
  }

  /** Create an empty (silent) AudioFrame */
  static create(sampleRate: number, channels: number, samplesPerChannel: number): AudioFrame {
    const data = new Int16Array(samplesPerChannel * channels);
    return new AudioFrame(data, sampleRate, channels, samplesPerChannel);
  }

  /** Duration of this frame in seconds */
  get duration(): number {
    return this.samplesPerChannel / this.sampleRate;
  }

  /** Duration of this frame in milliseconds */
  get durationMs(): number {
    return (this.samplesPerChannel / this.sampleRate) * 1000;
  }

  /** Total number of samples (channels * samplesPerChannel) */
  get totalSamples(): number {
    return this.data.length;
  }

  /** Convert to Buffer (for Opus encoder or file I/O) */
  toBuffer(): Buffer {
    return Buffer.from(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }

  /** Create AudioFrame from a Buffer of PCM16 data */
  static fromBuffer(buffer: Buffer, sampleRate: number, channels: number): AudioFrame {
    const data = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 2,
    );
    const samplesPerChannel = data.length / channels;
    return new AudioFrame(data, sampleRate, channels, samplesPerChannel);
  }

  /** Clone this AudioFrame */
  clone(): AudioFrame {
    return new AudioFrame(
      new Int16Array(this.data),
      this.sampleRate,
      this.channels,
      this.samplesPerChannel,
    );
  }
}
