import { describe, it, expect } from 'vitest';
import { RTCEngine, leaveReason } from '../src/engine';
import { Room } from '../src/room';
import { DisconnectReason } from '../src/proto/models';

describe('a leave from the node', () => {
  it('names the node reason', () => {
    expect(leaveReason(DisconnectReason.PARTICIPANT_REMOVED)).toBe('participant_removed');
    expect(leaveReason(DisconnectReason.DUPLICATE_IDENTITY)).toBe('duplicate_identity');
    expect(leaveReason(DisconnectReason.ROOM_DELETED)).toBe('room_deleted');
    expect(leaveReason(DisconnectReason.UNKNOWN_REASON)).toBe('server_initiated');
    expect(leaveReason(undefined)).toBe('server_initiated');
    expect(leaveReason(99 as DisconnectReason)).toBe('server_initiated');
  });

  it('reaches Room disconnected with that reason, once', async () => {
    const room = new Room();
    const engine = (room as any).engine as RTCEngine;
    (engine as any).setupSignalHandlers(); // both done by connect()
    (room as any).setupEngineHandlers();
    (room as any)._isConnected = true;
    const reasons: (string | undefined)[] = [];
    room.on('disconnected', (reason) => reasons.push(reason));

    engine.signal.emit('leave', { canReconnect: false, reason: DisconnectReason.PARTICIPANT_REMOVED });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(reasons).toEqual(['participant_removed']);
  });

  it('keeps client_initiated when the app leaves', async () => {
    const room = new Room();
    (room as any)._isConnected = true;
    const reasons: (string | undefined)[] = [];
    room.on('disconnected', (reason) => reasons.push(reason));
    await room.disconnect();
    expect(reasons).toEqual(['client_initiated']);
  });
});
