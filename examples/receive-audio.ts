/**
 * Receive Audio Example
 *
 * Joins a dTelecom room, subscribes to audio, and saves PCM16 to a file.
 *
 * Usage:
 *   DTELECOM_CLOUD_URL=https://cloud.dtelecom.org \
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
import { parseArgs } from 'node:util';
import { CloudClient } from '@dtelecom/server-sdk-js';
import {
  Room,
  RemoteAudioTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  setLogLevel,
  LogLevel,
} from '@dtelecom/server-sdk-node';

const { values: { room: roomName, output: outputPath } } = parseArgs({
  options: {
    room: { type: 'string', default: 'audio-demo' },
    output: { type: 'string', default: 'recording.pcm' },
  },
});

async function main() {
  setLogLevel(LogLevel.INFO);

  console.log(`Recording audio from room: ${roomName}`);
  console.log(`Output file: ${outputPath}`);

  const { token, wsUrl } = await new CloudClient().createToken({
    room: roomName, identity: 'recorder-bot', ttl: '10m', grants: { canPublish: false },
  });
  const room = new Room();
  const outputStream = fs.createWriteStream(outputPath);
  let totalSamples = 0;

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

  await room.connect(wsUrl, token);
  console.log(`Connected as ${room.localParticipant.identity}`);

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
