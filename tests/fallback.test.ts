import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RTCEngine } from '../src/engine';
import { rankedUrls, SessionEnded, TransportError } from '../src/connection';
import { Room } from '../src/room';
import { JoinResponse } from '../src/proto/signal';

const a = 'wss://a.example', b = 'wss://b.example', c = 'wss://c.example';
const opts = { fallbackUrls: [a, a + '/', b, c, c] };
const join = { participant: { sid: 'PA_1', identity: 'bot' }, otherParticipants: [] } as unknown as JoinResponse;
afterEach(() => vi.restoreAllMocks());

describe('issuer-ranked node connections', () => {
  it('deduplicates equivalent URL schemes and does not downgrade TLS', () => {
    expect(rankedUrls(a, ['https://a.example/', b, 'ws://unsafe.example', c, b])).toEqual([a, b, c]);
  });

  it('rotates on transport loss, reuses one participant, and uses the extended token', async () => {
    const attempt = vi.spyOn(RTCEngine.prototype, 'connect')
      .mockRejectedValueOnce(new TransportError('down')).mockResolvedValue(join);
    const room = new Room();
    await room.connect(a, 'first', opts);
    const local = room.localParticipant;
    room.updateConnectionToken('extended', [a, c]);
    attempt.mockRejectedValueOnce(new TransportError('lost'));
    const restored = new Promise<void>(resolve => room.once('reconnected', resolve));
    (room as any).engine.emit('disconnected', 'ICE failed', true);
    await restored;
    expect(room.localParticipant).toBe(local);
    expect(attempt.mock.calls.map(([url, token]) => [url, token])).toEqual([
      [a, 'first'], [b, 'first'], [a, 'extended'], [c, 'extended'],
    ]);
    await room.disconnect();
    attempt.mockClear().mockRejectedValue(new TransportError('gone'));
    await expect(room.connect(c, 'new')).rejects.toThrow('gone');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('honors a replacement issuer list while a reconnect is in flight', async () => {
    const attempt = vi.spyOn(RTCEngine.prototype, 'connect').mockResolvedValue(join);
    const room = new Room();
    await room.connect(a, 'original', opts);
    attempt.mockImplementationOnce(async () => {
      room.updateConnectionToken('extended', [c]);
      throw new TransportError('server unavailable');
    });
    const restored = new Promise<void>(resolve => room.once('reconnected', resolve));
    (room as any).engine.emit('disconnected', 'lost', true);
    await restored;
    expect(attempt.mock.calls.map(([url, token]) => [url, token])).toEqual([
      [a, 'original'], [a, 'original'], [c, 'extended'],
    ]);
    await room.disconnect();
  });

  it.each([401, 403])('stops after a real HTTP %i upgrade rejection', async status => {
    const http = createServer((_req, res) => res.writeHead(status).end());
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const port = (http.address() as AddressInfo).port;
    const connect = vi.spyOn(RTCEngine.prototype, 'connect');
    try {
      await expect(new Room().connect(`ws://127.0.0.1:${port}`, 'test-only', opts)).rejects.toThrow(`HTTP ${status}`);
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      http.close();
    }
  });

  it('does not rotate if removed during a full restart', async () => {
    const attempt = vi.spyOn(RTCEngine.prototype, 'connect').mockResolvedValueOnce(join)
      .mockRejectedValue(new SessionEnded('participant_removed'));
    const room = new Room();
    await room.connect(a, 'grant', opts);
    const reason = new Promise(resolve => room.once('disconnected', resolve));
    (room as any).engine.emit('disconnected', 'lost', true);
    await expect(reason).resolves.toBe('participant_removed');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending initial join without opening the next endpoint', async () => {
    const attempt = vi.spyOn(RTCEngine.prototype, 'connect').mockReturnValue(new Promise(() => {}));
    const room = new Room();
    const joining = expect(room.connect(a, 'grant', opts)).rejects.toThrow('client_initiated');
    await room.disconnect();
    await joining;
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
