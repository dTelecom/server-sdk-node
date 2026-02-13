/**
 * Audio resampler for converting between sample rates.
 *
 * Supports integer-ratio resampling (e.g. 48kHz ↔ 16kHz = 3:1).
 * Uses linear interpolation for downsampling and zero-fill + interpolation
 * for upsampling. Adequate quality for speech audio.
 */

/**
 * Downsample PCM16 from a higher sample rate to a lower sample rate.
 * Supports integer-ratio downsampling (e.g. 48000 → 16000 = 3:1).
 *
 * Uses simple averaging of N samples → 1 output sample (anti-alias filter).
 */
export function downsample(
  input: Int16Array,
  fromRate: number,
  toRate: number,
  channels: number = 1,
): Int16Array {
  if (fromRate === toRate) {
    return new Int16Array(input);
  }

  if (fromRate < toRate) {
    throw new Error(`downsample: fromRate (${fromRate}) must be >= toRate (${toRate})`);
  }

  const ratio = fromRate / toRate;
  if (!Number.isInteger(ratio)) {
    // Non-integer ratio — use linear interpolation
    return resampleLinear(input, fromRate, toRate, channels);
  }

  const inputSamplesPerChannel = input.length / channels;
  const outputSamplesPerChannel = Math.floor(inputSamplesPerChannel / ratio);
  const output = new Int16Array(outputSamplesPerChannel * channels);

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < outputSamplesPerChannel; i++) {
      // Average `ratio` input samples to produce 1 output sample
      let sum = 0;
      for (let j = 0; j < ratio; j++) {
        sum += input[(i * ratio + j) * channels + ch];
      }
      output[i * channels + ch] = Math.round(sum / ratio);
    }
  }

  return output;
}

/**
 * Upsample PCM16 from a lower sample rate to a higher sample rate.
 * Supports integer-ratio upsampling (e.g. 16000 → 48000 = 1:3).
 *
 * Uses linear interpolation between samples.
 */
export function upsample(
  input: Int16Array,
  fromRate: number,
  toRate: number,
  channels: number = 1,
): Int16Array {
  if (fromRate === toRate) {
    return new Int16Array(input);
  }

  if (fromRate > toRate) {
    throw new Error(`upsample: fromRate (${fromRate}) must be <= toRate (${toRate})`);
  }

  const ratio = toRate / fromRate;
  if (!Number.isInteger(ratio)) {
    return resampleLinear(input, fromRate, toRate, channels);
  }

  const inputSamplesPerChannel = input.length / channels;
  const outputSamplesPerChannel = inputSamplesPerChannel * ratio;
  const output = new Int16Array(outputSamplesPerChannel * channels);

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < inputSamplesPerChannel; i++) {
      const currentSample = input[i * channels + ch];
      const nextSample = i + 1 < inputSamplesPerChannel
        ? input[(i + 1) * channels + ch]
        : currentSample;

      // Linear interpolation between current and next sample
      for (let j = 0; j < ratio; j++) {
        const t = j / ratio;
        const interpolated = currentSample + (nextSample - currentSample) * t;
        output[(i * ratio + j) * channels + ch] = Math.round(interpolated);
      }
    }
  }

  return output;
}

/**
 * General linear interpolation resampler for non-integer ratios.
 */
function resampleLinear(
  input: Int16Array,
  fromRate: number,
  toRate: number,
  channels: number,
): Int16Array {
  const inputSamplesPerChannel = input.length / channels;
  const outputSamplesPerChannel = Math.round(inputSamplesPerChannel * toRate / fromRate);
  const output = new Int16Array(outputSamplesPerChannel * channels);
  const ratio = fromRate / toRate;

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < outputSamplesPerChannel; i++) {
      const srcPos = i * ratio;
      const srcIndex = Math.floor(srcPos);
      const frac = srcPos - srcIndex;

      const s0 = srcIndex < inputSamplesPerChannel
        ? input[srcIndex * channels + ch]
        : 0;
      const s1 = srcIndex + 1 < inputSamplesPerChannel
        ? input[(srcIndex + 1) * channels + ch]
        : s0;

      output[i * channels + ch] = Math.round(s0 + (s1 - s0) * frac);
    }
  }

  return output;
}

/**
 * Resample to any target rate (auto-detects up/downsample).
 */
export function resample(
  input: Int16Array,
  fromRate: number,
  toRate: number,
  channels: number = 1,
): Int16Array {
  if (fromRate === toRate) return new Int16Array(input);
  if (fromRate > toRate) return downsample(input, fromRate, toRate, channels);
  return upsample(input, fromRate, toRate, channels);
}
