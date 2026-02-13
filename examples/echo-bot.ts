/**
 * Echo Bot Example
 *
 * Joins a dTelecom room, subscribes to all audio, and echoes it back.
 *
 * Usage:
 *   DTELECOM_URL=wss://my.dtelecom.org \
 *   DTELECOM_API_KEY=... \
 *   DTELECOM_API_SECRET=... \
 *   npx tsx examples/echo-bot.ts --room my-room
 */

import {
  Room,
  AudioSource,
  AudioStream,
  AudioFrame,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  setLogLevel,
  LogLevel,
} from '../src';

// Parse args
const args = process.argv.slice(2);
const roomName = args[args.indexOf('--room') + 1] || 'echo-test';

const url = process.env.DTELECOM_URL || 'wss://my.dtelecom.org';
const apiKey = process.env.DTELECOM_API_KEY;
const apiSecret = process.env.DTELECOM_API_SECRET;

if (!apiKey || !apiSecret) {
  console.error('Set DTELECOM_API_KEY and DTELECOM_API_SECRET environment variables');
  process.exit(1);
}

async function generateToken(roomName: string, identity: string): Promise<string> {
  // Use @dtelecom/server-sdk-js to generate token
  const { AccessToken } = await import('@dtelecom/server-sdk-js');
  const token = new AccessToken(apiKey, apiSecret, { identity });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  return token.toJwt();
}

async function main() {
  setLogLevel(LogLevel.DEBUG);

  console.log(`Echo bot starting for room: ${roomName}`);

  // Generate token
  const token = await generateToken(roomName, 'echo-bot');

  // Create room and audio source
  const room = new Room();
  const source = new AudioSource(16000, 1);
  const track = LocalAudioTrack.createAudioTrack('echo', source);

  // Connect
  await room.connect(url, token);
  console.log(`Connected as ${room.localParticipant.identity}`);

  // Publish our audio track
  await room.localParticipant.publishTrack(track);
  console.log('Audio track published');

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
