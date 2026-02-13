/**
 * Send Audio Example
 *
 * Joins a dTelecom room and plays a raw PCM16 file as audio.
 *
 * Usage:
 *   # First, create a PCM16 file from a WAV:
 *   ffmpeg -i hello.wav -f s16le -ar 16000 -ac 1 hello.pcm
 *
 *   DTELECOM_URL=wss://my.dtelecom.org \
 *   DTELECOM_API_KEY=... \
 *   DTELECOM_API_SECRET=... \
 *   npx tsx examples/send-audio.ts --room my-room --input hello.pcm
 */

import * as fs from 'fs';
import {
  Room,
  AudioSource,
  AudioFrame,
  LocalAudioTrack,
  setLogLevel,
  LogLevel,
} from '../src';

const args = process.argv.slice(2);
const roomName = args[args.indexOf('--room') + 1] || 'play-test';
const inputPath = args[args.indexOf('--input') + 1] || 'hello.pcm';

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
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true });
  return token.toJwt();
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  setLogLevel(LogLevel.INFO);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error('Create a PCM16 file with: ffmpeg -i input.wav -f s16le -ar 16000 -ac 1 output.pcm');
    process.exit(1);
  }

  console.log(`Playing ${inputPath} into room: ${roomName}`);

  const token = await generateToken(roomName, 'player-bot');
  const room = new Room();

  const source = new AudioSource(16000, 1);
  const track = LocalAudioTrack.createAudioTrack('player', source);

  await room.connect(url, token);
  console.log(`Connected as ${room.localParticipant.identity}`);

  await room.localParticipant.publishTrack(track);
  console.log('Audio track published');

  // Read the PCM file
  const fileBuffer = fs.readFileSync(inputPath);
  const pcmData = new Int16Array(
    fileBuffer.buffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength / 2,
  );

  const sampleRate = 16000;
  const frameDurationMs = 20;
  const samplesPerFrame = sampleRate * frameDurationMs / 1000; // 320

  const totalDuration = (pcmData.length / sampleRate).toFixed(1);
  console.log(`Playing ${totalDuration}s of audio...`);

  // Send audio in 20ms frames, paced in real-time
  for (let offset = 0; offset + samplesPerFrame <= pcmData.length; offset += samplesPerFrame) {
    const frameData = pcmData.subarray(offset, offset + samplesPerFrame);
    const frame = new AudioFrame(new Int16Array(frameData), sampleRate, 1, samplesPerFrame);
    await source.captureFrame(frame);

    // Pace at real-time (20ms per frame)
    await sleep(frameDurationMs);

    // Progress
    const elapsed = (offset / sampleRate).toFixed(1);
    process.stdout.write(`\rPlaying: ${elapsed}s / ${totalDuration}s`);
  }

  // Flush remaining samples
  source.flush();

  console.log('\nPlayback complete.');
  await room.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
