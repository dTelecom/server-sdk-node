import { describe, it, expect } from 'vitest';
import { downsample, upsample, resample } from '../src/audio/resampler';

describe('resampler', () => {
  describe('downsample', () => {
    it('should downsample 48kHz to 16kHz (3:1 ratio)', () => {
      // 960 samples at 48kHz = 20ms
      const input = new Int16Array(960);
      for (let i = 0; i < 960; i++) {
        input[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / 48000) * 16000);
      }

      const output = downsample(input, 48000, 16000, 1);
      expect(output.length).toBe(320); // 960 / 3
    });

    it('should return copy for same rate', () => {
      const input = new Int16Array([100, 200, 300]);
      const output = downsample(input, 16000, 16000, 1);
      expect(output.length).toBe(3);
      expect(output[0]).toBe(100);
    });

    it('should average samples correctly', () => {
      // 3:1 downsample: average each group of 3
      const input = new Int16Array([10, 20, 30, 40, 50, 60]);
      const output = downsample(input, 48000, 16000, 1);
      expect(output.length).toBe(2);
      expect(output[0]).toBe(20); // (10+20+30)/3 = 20
      expect(output[1]).toBe(50); // (40+50+60)/3 = 50
    });

    it('should throw for fromRate < toRate', () => {
      const input = new Int16Array(100);
      expect(() => downsample(input, 16000, 48000, 1)).toThrow();
    });
  });

  describe('upsample', () => {
    it('should upsample 16kHz to 48kHz (1:3 ratio)', () => {
      const input = new Int16Array(320);
      for (let i = 0; i < 320; i++) {
        input[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / 16000) * 16000);
      }

      const output = upsample(input, 16000, 48000, 1);
      expect(output.length).toBe(960); // 320 * 3
    });

    it('should return copy for same rate', () => {
      const input = new Int16Array([100, 200]);
      const output = upsample(input, 16000, 16000, 1);
      expect(output.length).toBe(2);
    });

    it('should interpolate linearly', () => {
      // 1:3 upsample from [0, 300]
      // Expected: 0, 100, 200, 300, 300, 300
      const input = new Int16Array([0, 300]);
      const output = upsample(input, 16000, 48000, 1);
      expect(output.length).toBe(6);
      expect(output[0]).toBe(0);
      expect(output[1]).toBe(100);
      expect(output[2]).toBe(200);
      // Last sample group interpolates toward itself
      expect(output[3]).toBe(300);
    });

    it('should throw for fromRate > toRate', () => {
      const input = new Int16Array(100);
      expect(() => upsample(input, 48000, 16000, 1)).toThrow();
    });
  });

  describe('resample (auto-detect)', () => {
    it('should downsample when fromRate > toRate', () => {
      const input = new Int16Array(960);
      const output = resample(input, 48000, 16000, 1);
      expect(output.length).toBe(320);
    });

    it('should upsample when fromRate < toRate', () => {
      const input = new Int16Array(320);
      const output = resample(input, 16000, 48000, 1);
      expect(output.length).toBe(960);
    });

    it('should return copy for same rate', () => {
      const input = new Int16Array([1, 2, 3]);
      const output = resample(input, 16000, 16000, 1);
      expect(output).toEqual(new Int16Array([1, 2, 3]));
    });
  });

  describe('stereo support', () => {
    it('should downsample stereo correctly', () => {
      // 6 interleaved stereo samples = 3 samples per channel
      // At 3:1 ratio, should produce 1 sample per channel = 2 total
      const input = new Int16Array([
        10, 100,   // ch0=10, ch1=100
        20, 200,   // ch0=20, ch1=200
        30, 300,   // ch0=30, ch1=300
      ]);
      const output = downsample(input, 48000, 16000, 2);
      expect(output.length).toBe(2); // 1 sample per channel * 2 channels
      expect(output[0]).toBe(20);    // avg(10,20,30) = 20
      expect(output[1]).toBe(200);   // avg(100,200,300) = 200
    });
  });
});
