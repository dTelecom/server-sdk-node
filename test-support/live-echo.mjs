import { randomUUID } from 'node:crypto';
import { CloudClient } from '@dtelecom/server-sdk-js';
import { Room, AudioSource, LocalAudioTrack, setLogLevel, LogLevel } from '@dtelecom/server-sdk-node';
import { browserCall } from './browser-call.mjs';

setLogLevel(LogLevel.SILENT);
const cloud = new CloudClient();
const roomName = 'sdk-echo-' + randomUUID();
const room = new Room();
const source = new AudioSource(16000, 1);
room.on('trackSubscribed', async (track, _publication, participant) => {
  if (participant.identity !== 'browser') return;
  for await (const frame of track.createStream(16000, 1)) await source.captureFrame(frame);
});
try {
  const { wsUrl, token } = await cloud.createToken({ room: roomName, identity: 'echo', ttl: '3m' });
  await room.connect(wsUrl, token);
  await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('echo', source));
  await browserCall({ cloud, room: roomName, peer: 'echo' });
} finally {
  await room.disconnect();
  source.destroy();
}
