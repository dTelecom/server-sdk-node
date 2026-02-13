/**
 * Receive Audio Example
 *
 * Joins a dTelecom room, subscribes to audio, and saves PCM16 to a file.
 *
 * Usage:
 *   DTELECOM_URL=wss://my.dtelecom.org \
 *   DTELECOM_API_KEY=... \
 *   DTELECOM_API_SECRET=... \
 *   npx tsx examples/receive-audio.ts --room my-room --output recording.pcm
 *
 * Play the recorded file:
 *   ffplay -f s16le -ar 16000 -ac 1 recording.pcm
 *   # or convert to WAV:
 *   ffmpeg -f s16le -ar 16000 -ac 1 -i recording.pcm recording.wav
 */

import * as fs from 'fs';
import {
  Room,
  RemoteAudioTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  setLogLevel,
  LogLevel,
} from '../src';

const args = process.argv.slice(2);
const roomName = args[args.indexOf('--room') + 1] || 'record-test';
const outputPath = args[args.indexOf('--output') + 1] || 'recording.pcm';

const url = process.env.DTELECOM_URL || 'wss://my.dtelecom.org';
const apiKey = process.env.DTELECOM_API_KEY;
const apiSecret = process.env.DTELECOM_API_SECRET;

if (!apiKey || !apiSecret) {
  console.error('Set DTELECOM_API_KEY and DTELECOM_API_SECRET environment variables');
  process.exit(1);
}

async function generateToken(roomName: string, identity: string): Promise<string> {
  const { AccessToken } = await import('@dtelecom/server-sdk-js');
  const token = new AccessToken(apiKey, apiSecret, { identity });
  token.addGrant({ roomJoin: true, room: roomName, canSubscribe: true });
  return token.toJwt();
}

async function main() {
  setLogLevel(LogLevel.INFO);

  console.log(`Recording audio from room: ${roomName}`);
  console.log(`Output file: ${outputPath}`);

  const token = await generateToken(roomName, 'recorder-bot');
  const room = new Room();
  const outputStream = fs.createWriteStream(outputPath);
  let totalSamples = 0;

  await room.connect(url, token);
  console.log(`Connected as ${room.localParticipant.identity}`);

  room.on('trackSubscribed', async (
    remoteTrack: RemoteAudioTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    console.log(`Recording audio from ${participant.identity}...`);

    const stream = remoteTrack.createStream(16000, 1);

    for await (const frame of stream) {
      // Write PCM16 data to file
      const buffer = frame.toBuffer();
      outputStream.write(buffer);
      totalSamples += frame.samplesPerChannel;

      // Log progress every second
      if (totalSamples % 16000 < frame.samplesPerChannel) {
        const seconds = Math.floor(totalSamples / 16000);
        process.stdout.write(`\rRecorded: ${seconds}s`);
      }
    }
  });

  room.on('participantConnected', (p) => console.log(`Participant joined: ${p.identity}`));
  room.on('disconnected', (reason) => {
    outputStream.end();
    const duration = (totalSamples / 16000).toFixed(1);
    console.log(`\nRecording complete: ${duration}s saved to ${outputPath}`);
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\nStopping recording...');
    outputStream.end();
    await room.disconnect();
    const duration = (totalSamples / 16000).toFixed(1);
    console.log(`Recorded ${duration}s to ${outputPath}`);
    process.exit(0);
  });

  console.log('Waiting for audio... Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
