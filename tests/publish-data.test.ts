import { describe, it, expect, vi, afterEach } from 'vitest';
import { RTCEngine } from '../src/engine';
import { LocalParticipant } from '../src/participant';

/** A stand-in for a werift data channel: a state, a stateChanged event and send(). */
function fakeChannel(state: string) {
  const listeners = new Set<(s: string) => void>();
  return {
    readyState: state,
    sent: [] as Buffer[],
    send(data: Buffer) { this.sent.push(data); },
    stateChanged: {
      subscribe(fn: (s: string) => void) {
        listeners.add(fn);
        return { unSubscribe: () => listeners.delete(fn), disposer: () => {} };
      },
    },
    set(next: string) {
      this.readyState = next;
      for (const fn of [...listeners]) fn(next);
    },
    listenerCount: () => listeners.size,
  };
}

/** An engine whose publisher was never negotiated (subscriber-primary join, nothing published). */
function engineWith(channel: ReturnType<typeof fakeChannel>, negotiated = false) {
  const engine = new RTCEngine();
  const internals = engine as any;
  internals.reliableChannel = channel;
  internals.lossyChannel = fakeChannel('open');
  internals.publisherNegotiated = negotiated;
  const negotiate = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    internals.publisherNegotiated = true;
  });
  internals.runNegotiate = negotiate;
  return { engine, negotiate };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('publishData before a track is published', () => {
  it('negotiates once for concurrent sends, then sends when the channel opens', async () => {
    const channel = fakeChannel('connecting');
    const { engine, negotiate } = engineWith(channel);
    const participant = new LocalParticipant(engine, 'PA_1', 'bot');

    const sends = [
      participant.publishData(new Uint8Array([1])),
      participant.publishData(new Uint8Array([2])),
    ];
    await vi.waitFor(() => expect(negotiate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(channel.listenerCount()).toBe(2));
    channel.set('open');
    await Promise.all(sends);
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(channel.sent).toHaveLength(2);
    expect(channel.listenerCount()).toBe(0);
  });

  it('sends on an open channel without negotiating', async () => {
    const channel = fakeChannel('open');
    const { engine, negotiate } = engineWith(channel, true);
    await new LocalParticipant(engine, 'PA_1', 'bot').publishData(new Uint8Array([1]));
    expect(negotiate).not.toHaveBeenCalled();
    expect(channel.sent).toHaveLength(1);
  });

  it('rejects when the channel does not open in time', async () => {
    const channel = fakeChannel('connecting');
    const { engine } = engineWith(channel, true);
    const participant = new LocalParticipant(engine, 'PA_1', 'bot');
    await expect(participant.publishData(new Uint8Array([1]), { timeoutMs: 20 }))
      .rejects.toThrow('did not open within 20ms');
    expect(channel.listenerCount()).toBe(0);
  });

  it('rejects on a closed channel', async () => {
    const { engine } = engineWith(fakeChannel('closed'), true);
    await expect(new LocalParticipant(engine, 'PA_1', 'bot').publishData(new Uint8Array([1])))
      .rejects.toThrow('is closed');
  });

  it('rejects without canPublishData', async () => {
    const channel = fakeChannel('open');
    const { engine } = engineWith(channel, true);
    const participant = new LocalParticipant(engine, 'PA_1', 'bot');
    participant.permissions = { canSubscribe: true, canPublish: false, canPublishData: false, hidden: false, recorder: false };
    await expect(participant.publishData(new Uint8Array([1]))).rejects.toThrow('canPublishData');
    expect(channel.sent).toHaveLength(0);
  });

  it('serialises negotiations: a second one starts after the first answer', async () => {
    const { engine } = engineWith(fakeChannel('open'), true);
    const order: string[] = [];
    let first = 0;
    (engine as any).runNegotiate = vi.fn(async () => {
      const n = ++first;
      order.push(`start ${n}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end ${n}`);
    });
    await Promise.all([engine.negotiate(), engine.negotiate()]);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });
});
