import { describe, it, expect, vi } from 'vitest';
import { RTCEngine } from '../src/engine';
import { LocalParticipant } from '../src/participant';

describe('LocalParticipant.publishTrack permissions', () => {
  it('rejects at once without canPublish and sends nothing to the node', async () => {
    const engine = new RTCEngine();
    const request = vi.fn();
    (engine as any).requestPublishTrack = request;
    const participant = new LocalParticipant(engine, 'PA_1', 'viewer');
    participant.permissions = { canSubscribe: true, canPublish: false, canPublishData: true, hidden: false, recorder: false };
    const track = { cid: 'TR_local', name: 'mic' } as any;
    await expect(participant.publishTrack(track)).rejects.toThrow('canPublish');
    expect(request).not.toHaveBeenCalled();
  });

  it('asks the node when canPublish is allowed', async () => {
    const engine = new RTCEngine();
    const request = vi.fn(async () => ({ track: undefined }));
    (engine as any).requestPublishTrack = request;
    const participant = new LocalParticipant(engine, 'PA_1', 'bot');
    participant.permissions = { canSubscribe: true, canPublish: true, canPublishData: true, hidden: false, recorder: false };
    await expect(participant.publishTrack({ cid: 'TR_local', name: 'mic' } as any)).rejects.toThrow('Server did not return track info');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
