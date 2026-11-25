/**
 * Echo Bot Example
 *
 * Joins a dTelecom room, subscribes to all audio, and echoes it back.
 *
 * Usage:
 *   DTELECOM_CLOUD_URL=https://cloud.dtelecom.org \
 *   DTELECOM_API_KEY=... \
 *   DTELECOM_API_SECRET=... \
 *   npx tsx examples/echo-bot.ts --room my-room
 */

import { parseArgs } from 'node:util';
import { CloudClient } from '@dtelecom/server-sdk-js';
import {
  Room,
  AudioSource,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  setLogLevel,
  LogLevel,
} from '@dtelecom/server-sdk-node';

const { values: { room: roomName } } = parseArgs({
  options: {
    room: { type: 'string', default: 'audio-demo' },
  },
});

async function main() {
  setLogLevel(LogLevel.INFO);

  console.log(`Echo bot starting for room: ${roomName}`);

  // Generate token
  const { token, wsUrl } = await new CloudClient().createToken({
    room: roomName, identity: 'echo-bot', ttl: '10m',
  });

  // Create room and audio source
  const room = new Room();
  const source = new AudioSource(16000, 1);
  const track = LocalAudioTrack.createAudioTrack('echo', source);

  // Subscribe to remote audio and echo it back
  room.on('trackSubscribed', async (
    remoteTrack: RemoteAudioTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    console.log(`Track subscribed from ${participant.identity}: ${publication.name}`);

    const stream = remoteTrack.createStream(16000, 1);

    for await (const frame of stream) {
      // Echo the frame back
      await source.captureFrame(frame);
    }

    console.log(`Stream from ${participant.identity} ended`);
  });

  // Log events
  room.on('participantConnected', (p) => console.log(`Participant joined: ${p.identity}`));
  room.on('participantDisconnected', (p) => console.log(`Participant left: ${p.identity}`));
  room.on('disconnected', (reason) => {
    console.log(`Disconnected: ${reason}`);
    process.exit(0);
  });

  // Connect
  await room.connect(wsUrl, token);
  console.log(`Connected as ${room.localParticipant.identity}`);

  // Publish our audio track
  await room.localParticipant.publishTrack(track);
  console.log('Audio track published');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await room.disconnect();
    process.exit(0);
  });

  console.log('Echo bot running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
