import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unpackStreamId, Room } from '../src/room';
import { ParticipantInfo_State, TrackType, TrackSource } from '../src/proto/models';

// ─── unpackStreamId ─────────────────────────────────────────────────────────

describe('unpackStreamId', () => {
  it('should split participantSid|trackSid', () => {
    const result = unpackStreamId('PA_abc123|TR_xyz789');
    expect(result).toEqual({
      participantSid: 'PA_abc123',
      trackSid: 'TR_xyz789',
    });
  });

  it('should handle trackSid containing pipe characters', () => {
    // unpackStreamId splits on first "|" only
    const result = unpackStreamId('PA_abc|TR_x|extra');
    expect(result).toEqual({
      participantSid: 'PA_abc',
      trackSid: 'TR_x|extra',
    });
  });

  it('should return empty trackSid when no pipe', () => {
    const result = unpackStreamId('PA_abc123');
    expect(result).toEqual({
      participantSid: 'PA_abc123',
      trackSid: '',
    });
  });

  it('should handle empty string', () => {
    const result = unpackStreamId('');
    expect(result).toEqual({
      participantSid: '',
      trackSid: '',
    });
  });

  it('should handle pipe at start (empty participantSid)', () => {
    const result = unpackStreamId('|TR_xyz');
    expect(result).toEqual({
      participantSid: '',
      trackSid: 'TR_xyz',
    });
  });
});

// ─── Room track matching ────────────────────────────────────────────────────

/**
 * Create a Room with fake internal state (bypassing connect()).
 * Sets localParticipant and allows adding remote participants.
 */
function createTestRoom(): Room {
  const room = new Room();
  // Bypass connect() — set localParticipant directly
  (room as any).localParticipant = {
    sid: 'PA_local',
    identity: 'bot',
  };
  return room;
}

function addRemoteParticipant(
  room: Room,
  sid: string,
  identity: string,
  tracks: Array<{ sid: string; name: string }> = [],
) {
  const trackInfos = tracks.map((t) => ({
    sid: t.sid,
    name: t.name,
    type: TrackType.AUDIO,
    source: TrackSource.MICROPHONE,
    muted: false,
    width: 0,
    height: 0,
    simulcast: false,
    disableDtx: false,
    layers: [],
    mimeType: 'audio/opus',
    mid: '',
  }));

  // Call getOrCreateParticipant via the public interface indirectly —
  // just create participant info and pass through handleParticipantUpdate
  const info = {
    sid,
    identity,
    name: identity,
    metadata: '',
    state: ParticipantInfo_State.ACTIVE,
    tracks: trackInfos,
    region: '',
    isPublisher: false,
    joinedAt: 0,
    permission: undefined,
    version: 0,
  };

  // Access private method to add participant
  (room as any).getOrCreateParticipant(info);
}

/** Fake media track */
function fakeMediaTrack(kind = 'audio') {
  return { kind, uuid: `media-${Math.random().toString(36).slice(2, 8)}` };
}

/** Fake transceiver with remoteStreamId set */
function fakeTransceiver(streamId: string) {
  return {
    mid: '0',
    receiver: { remoteStreamId: streamId },
  };
}

describe('Room track matching', () => {
  let room: Room;

  beforeEach(() => {
    room = createTestRoom();
  });

  it('should match track to correct participant using streamId', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);
    addRemoteParticipant(room, 'PA_jack', 'jack', [{ sid: 'TR_j1', name: 'audio' }]);

    const events: Array<{ track: any; participant: any }> = [];
    room.on('trackSubscribed', (track, _pub, participant) => {
      events.push({ track, participant });
    });

    // Simulate Vadim's track arriving
    const vadimMedia = fakeMediaTrack();
    (room as any).handleRemoteTrack(vadimMedia, fakeTransceiver('PA_vadim|TR_v1'));

    // Simulate Jack's track arriving
    const jackMedia = fakeMediaTrack();
    (room as any).handleRemoteTrack(jackMedia, fakeTransceiver('PA_jack|TR_j1'));

    expect(events).toHaveLength(2);
    expect(events[0].participant.identity).toBe('vadim');
    expect(events[1].participant.identity).toBe('jack');
  });

  it('should NOT cross-assign tracks between participants', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);
    addRemoteParticipant(room, 'PA_jack', 'jack', [{ sid: 'TR_j1', name: 'audio' }]);

    const events: Array<{ trackSid: string; identity: string }> = [];
    room.on('trackSubscribed', (track, pub, participant) => {
      events.push({ trackSid: track.sid, identity: participant.identity });
    });

    // Both tracks arrive — each should go to the correct participant
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_jack|TR_j1'));

    // Vadim's track re-fires during renegotiation — should NOT go to Jack
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));

    expect(events).toHaveLength(3);
    // All Vadim events go to Vadim
    expect(events[0]).toEqual({ trackSid: 'TR_v1', identity: 'vadim' });
    expect(events[2]).toEqual({ trackSid: 'TR_v1', identity: 'vadim' });
    // Jack's event goes to Jack
    expect(events[1]).toEqual({ trackSid: 'TR_j1', identity: 'jack' });
  });

  it('should queue track if participant not yet known', () => {
    // Track arrives before participant update
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));

    const pendingTracks = (room as any).pendingTracks;
    expect(pendingTracks).toHaveLength(1);
    expect(pendingTracks[0].participantSid).toBe('PA_vadim');
    expect(pendingTracks[0].trackSid).toBe('TR_v1');
  });

  it('should flush pending tracks when participant arrives', () => {
    const events: Array<{ identity: string }> = [];
    room.on('trackSubscribed', (_track, _pub, participant) => {
      events.push({ identity: participant.identity });
    });

    // Track arrives first
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));
    expect(events).toHaveLength(0);

    // Then participant update arrives (which triggers flushPendingTracks)
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);
    (room as any).flushPendingTracks();

    expect(events).toHaveLength(1);
    expect(events[0].identity).toBe('vadim');
    expect((room as any).pendingTracks).toHaveLength(0);
  });

  it('should skip non-audio tracks', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'video' }]);

    const events: any[] = [];
    room.on('trackSubscribed', () => events.push(1));

    (room as any).handleRemoteTrack(
      { kind: 'video', uuid: 'v1' },
      fakeTransceiver('PA_vadim|TR_v1'),
    );

    expect(events).toHaveLength(0);
  });

  it('should reject track with empty streamId', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);

    const events: any[] = [];
    room.on('trackSubscribed', () => events.push(1));

    (room as any).handleRemoteTrack(fakeMediaTrack(), { mid: '0', receiver: {} });

    expect(events).toHaveLength(0);
    expect((room as any).pendingTracks).toHaveLength(0); // dropped, not queued
  });

  it('should reject track with missing trackSid (no pipe in streamId)', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);

    const events: any[] = [];
    room.on('trackSubscribed', () => events.push(1));

    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim'));

    expect(events).toHaveLength(0);
    expect((room as any).pendingTracks).toHaveLength(0); // dropped, not queued
  });

  it('should handle re-subscription (track already assigned)', () => {
    addRemoteParticipant(room, 'PA_vadim', 'vadim', [{ sid: 'TR_v1', name: 'audio' }]);

    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    room.on('trackSubscribed', (_t, _p, participant) => subscribed.push(participant.identity));
    room.on('trackUnsubscribed', (_t, _p, participant) => unsubscribed.push(participant.identity));

    // First subscription
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));
    expect(subscribed).toHaveLength(1);

    // Re-subscription (renegotiation re-fires onTrack)
    (room as any).handleRemoteTrack(fakeMediaTrack(), fakeTransceiver('PA_vadim|TR_v1'));
    expect(subscribed).toHaveLength(2);
    // Old track should have been removed first
    expect(unsubscribed).toHaveLength(1);
  });
});
