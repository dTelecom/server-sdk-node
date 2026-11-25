import assert from 'node:assert/strict';
import { AudioFrame, AudioSource, Room } from '@dtelecom/server-sdk-node';

assert.ok(new Room());
const source = new AudioSource(16000, 1);
let packet;
source.onEncodedFrame = encoded => { packet = encoded; };
try {
  await source.captureFrame(AudioFrame.create(16000, 1, 320));
  assert.ok(packet?.length > 0, 'Expected an encoded Opus packet');
} finally {
  source.destroy();
}
