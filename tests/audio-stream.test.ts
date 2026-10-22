import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioStream } from '../src/audio/audio-stream';

vi.mock('../src/audio/opus-decoder', () => ({
  OpusDecoder: class {
    private channels: number;
    constructor(_rate: number, channels: number) { this.channels = channels; }
    decode(payload: Buffer) {
      const samples = payload[0] === 2 ? 1920 : 960;
      const result = Buffer.alloc(samples * this.channels * 2);
      for (let i = 0; i < result.length; i += 2) result.writeInt16LE(payload[0], i);
      return result;
    }
    destroy() {}
  },
}));

function setup(channels = 1) {
  let receive: (packet: any) => void;
  const stream = new AudioStream({ uuid: 'test', onReceiveRtp: {
    subscribe(callback: typeof receive) { receive = callback; }, once() {},
  } } as any, 16000, channels);
  return {
    stream,
    packet(seq: number, timestamp: number, value = 1, ssrc = 1) {
      receive({ header: { sequenceNumber: seq, timestamp, ssrc }, payload: Buffer.from([value]) });
    },
    async finish() {
      stream.close();
      const frames = [];
      for await (const frame of stream) frames.push(frame);
      return {
        samples: frames.reduce((sum, frame) => sum + frame.samplesPerChannel, 0),
        speech: frames.filter(frame => frame.data.some(sample => sample !== 0)),
        frames,
      };
    },
  };
}

describe('AudioStream receive timeline', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps continuous speech immediate and does not insert silence', async () => {
    const test = setup();
    for (let i = 0; i < 100; i++) {
      test.packet(i, i * 960);
      await vi.advanceTimersByTimeAsync(20);
    }
    const result = await test.finish();
    expect(result.samples).toBe(32000);
    expect(result.speech).toHaveLength(100);
  });

  it('reconstructs DTX timestamp gaps with consecutive packet sequences', async () => {
    const test = setup();
    test.packet(1, 0);
    test.packet(2, 9600);
    const result = await test.finish();
    expect(result.samples).toBe(3520); // 220 ms, including both 20 ms packets
    expect(result.speech).toHaveLength(2);
  });

  it('uses actual decoded packet duration for variable packetization', async () => {
    const test = setup(2);
    test.packet(1, 0, 2); // 40 ms
    test.packet(2, 1920, 1);
    const result = await test.finish();
    expect(result.samples).toBe(960);
    expect(result.frames).toHaveLength(2);
    expect(result.frames.every(frame => frame.channels === 2)).toBe(true);
  });

  it('accounts for both sequence loss and missing RTP time once', async () => {
    const test = setup();
    test.packet(100, 0);
    test.packet(103, 2880);
    expect((await test.finish()).samples).toBe(1280);
  });

  it('supplies elapsed silence when the sender stops completely', async () => {
    const test = setup();
    test.packet(1, 0);
    await vi.advanceTimersByTimeAsync(2200);
    const result = await test.finish();
    expect(result.samples / 16000).toBeCloseTo(2.14);
    expect(result.speech).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not double-count timer silence when a sparse packet arrives', async () => {
    const test = setup();
    test.packet(1, 0);
    await vi.advanceTimersByTimeAsync(200);
    test.packet(2, 9600);
    const result = await test.finish();
    expect(result.samples).toBe(3520);
    expect(result.speech).toHaveLength(2);
  });

  it('preserves the whole resumed packet even when it arrives late', async () => {
    const test = setup();
    test.packet(1, 0);
    await vi.advanceTimersByTimeAsync(500);
    test.packet(2, 960);
    test.packet(3, 1920);
    const result = await test.finish();
    expect(result.speech).toHaveLength(3);
    expect(result.speech.every(frame => frame.samplesPerChannel === 320)).toBe(true);
  });

  it('rejects duplicates and reordered packets without manufacturing a huge gap', async () => {
    const test = setup();
    test.packet(100, 0);
    test.packet(101, 960);
    test.packet(101, 960);
    test.packet(99, 0xfffffc40);
    test.packet(102, 1920);
    expect((await test.finish()).samples).toBe(960);
  });

  it('handles RTP timestamp and sequence wraparound', async () => {
    const test = setup();
    test.packet(65535, 0xfffffc40);
    test.packet(0, 0);
    test.packet(1, 960);
    expect((await test.finish()).samples).toBe(960);
  });

  it('rebases on SSRC changes and implausible timestamp jumps', async () => {
    const test = setup();
    test.packet(100, 0);
    test.packet(1, 1000000000, 1, 2);
    test.packet(2, 2000000000, 1, 2);
    expect((await test.finish()).samples).toBe(960);
  });

  it('does not generate silence before the first packet or after close', async () => {
    const test = setup();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
    test.packet(1, 0);
    test.stream.close();
    await vi.advanceTimersByTimeAsync(500);
    expect((await test.finish()).samples).toBe(320);
    expect(vi.getTimerCount()).toBe(0);
  });
});
