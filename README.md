# @dtelecom/server-sdk-node

Node.js RTC SDK for dTelecom — join rooms as a WebRTC participant for AI bots.

**Documentation:** [docs.dtelecom.org](https://docs.dtelecom.org), see [Server-side media](https://docs.dtelecom.org/guides/server-side-media/) for bots in dTelecom Cloud rooms. The bot joins with a token from your backend (`@dtelecom/server-sdk-js` `createToken`), like any participant.

## Features

- **WebRTC participant** — join dTelecom rooms as a bot
- **Audio receive** — subscribe to remote audio as PCM16 streams (16kHz for STT)
- **Audio send** — publish PCM16 audio as Opus (from TTS or any source)
- **Data channels** — send/receive messages via reliable or lossy channels
- **Pure TypeScript WebRTC** — uses [werift](https://github.com/shinyoshiaki/werift-webrtc) (no native WebRTC deps)
- **Opus codec** — [opusscript](https://github.com/abalabahaha/opusscript) (libopus compiled to WASM; nothing to build at install)

## Quick start with an echo bot

Use Node.js 22 or later and a dTelecom Cloud project with WebRTC balance. In a new directory, install the RTC participant and the SDK that issues its token.

```bash
npm install @dtelecom/server-sdk-node @dtelecom/server-sdk-js
```

Create a local `.env` file and fill in your Cloud project credentials. Keep this file on the backend.

```dotenv
DTELECOM_CLOUD_URL=https://cloud.dtelecom.org
DTELECOM_API_KEY=
DTELECOM_API_SECRET=
```

Save this as `echo.mjs`. Cloud chooses the node and returns its signaling URL with the participant token.

```js
import { CloudClient } from '@dtelecom/server-sdk-js';
import { Room, AudioSource, LocalAudioTrack } from '@dtelecom/server-sdk-node';

const { token, wsUrl, fallbackUrls } = await new CloudClient().createToken({
  room: 'audio-demo', identity: 'echo-bot', ttl: '10m',
});
const room = new Room();
const source = new AudioSource(16000, 1);
room.on('trackSubscribed', async (remoteTrack) => {
  for await (const frame of remoteTrack.createStream(16000, 1)) {
    await source.captureFrame(frame);
  }
});
await room.connect(wsUrl, token, { fallbackUrls });
await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('echo', source));
console.log('Echo bot is listening in audio-demo');
process.once('SIGINT', async () => {
  await room.disconnect();
  process.exit(0);
});
```

Run `node --env-file=.env echo.mjs`. Join `audio-demo` from your app using the same Cloud project and a different participant identity. Enable your microphone and audio playback, then speak using headphones to hear the echo. Press Ctrl+C to disconnect the bot. [Connect a browser participant](https://docs.dtelecom.org/quickstart/)

## Architecture

```
@dtelecom/server-sdk-node
├── SignalClient          WebSocket + protobuf to SFU
├── RTCEngine             2 PeerConnections (publisher + subscriber)
├── Room                  participant management, events
├── LocalParticipant      publish tracks + data
├── RemoteParticipant     subscribed tracks
├── AudioSource           PCM16 → Opus → RTP → publish
├── AudioStream           subscribe → RTP → Opus → PCM16
└── DataChannel           reliable + lossy messaging
```

## API

### Room

```typescript
const room = new Room();
await room.connect(url, token, { autoSubscribe: true });

room.on('participantConnected', (participant) => { });
room.on('trackSubscribed', (track, publication, participant) => { });
room.on('dataReceived', (data, participant, kind, topic) => { });
room.on('disconnected', (reason) => { }); // client_initiated, or the node's: participant_removed, duplicate_identity, room_deleted, ...

await room.disconnect();
```

Pass the ranked signaling URLs returned by your token issuer as `fallbackUrls`. The room tries the primary first, then each distinct alternative on a transport failure. With alternatives available, a lost connection emits `reconnecting`, retries the serving node and then the other ranked nodes, republishes local audio, and emits `reconnected`. Publishing data resumes on the new transport. A rejected grant, a server-requested removal or a call to `disconnect()` ends the session. When extending a Cloud token, pass its replacement token and candidates to `room.updateConnectionToken(token, fallbackUrls)` so that a later reconnect uses the new grant.

### Audio

```typescript
// Publish audio
const source = new AudioSource(16000, 1);
const track = LocalAudioTrack.createAudioTrack('bot-audio', source);
await room.localParticipant.publishTrack(track);

const frame = new AudioFrame(pcm16Data, 16000, 1, samplesPerChannel);
await source.captureFrame(frame);

// Receive audio
room.on('trackSubscribed', async (remoteTrack) => {
  const stream = remoteTrack.createStream(16000, 1);
  for await (const frame of stream) {
    // frame.data = Int16Array (PCM16, 16kHz, mono)
  }
});
```

`AudioStream` preserves silence across Opus DTX and lost-packet timestamp gaps.
After the first decoded packet, a stalled sender produces zero PCM with a 60 ms
jitter grace period, allowing downstream VAD/turn detection to observe elapsed
silence. Normal packets are emitted immediately. Silence already generated by
the timer is not inserted again when the next RTP packet arrives; accepted
resumed speech is preserved in full. Close the stream (or stop the remote track)
to stop its timer. The close log reports `timestamp_silence_ms` and
`stalled_silence_ms` for diagnosis. These counts include intentional sender
silence suppression and are not packet-loss measurements.

### Data Channels

```typescript
import { DataPacket_Kind } from '@dtelecom/server-sdk-node';

await room.localParticipant.publishData(
  new TextEncoder().encode('hello'),
  { kind: DataPacket_Kind.RELIABLE, topic: 'chat' }
);

room.on('dataReceived', (data, participant, kind, topic) => {
  console.log(new TextDecoder().decode(data));
});
```

## Examples

From a checkout of this repository, build the RTC SDK and install the Cloud SDK and TypeScript runner for the examples. Set up the backend `.env` described above.

```bash
npm ci
npm run build
npm install --no-save @dtelecom/server-sdk-js tsx
```

Run each example from the checkout root. The sender accepts raw little-endian PCM16 at 16 kHz, mono. Start a listener before the sender.

```bash
# Listen and echo incoming audio
node --env-file=.env --import tsx examples/echo-bot.ts --room audio-demo

# Record incoming audio to a raw PCM file
node --env-file=.env --import tsx examples/receive-audio.ts --room audio-demo --output recording.pcm

# Publish an input file as an audio track
node --env-file=.env --import tsx examples/send-audio.ts --room audio-demo --input hello.pcm
```

## Dependencies

| Package | Purpose | Native? |
|---|---|---|
| `werift` | WebRTC (ICE, DTLS, SRTP) | No (pure TS) |
| `opusscript` | Opus encode and decode | No (WASM) |
| `ws` | WebSocket client | No |
| `protobufjs` | Protobuf encode/decode | No |

## CI and live verification

`SDK checks` runs lint, tests and a build on Node 22.14.0 and 24.x. It installs the resulting npm tarball in an empty consumer project and checks the Opus encoder. To repeat the package check locally, run `npm ci && npm run build`, then `bash test-support/prepare-consumer.sh "$(mktemp -d)"`.

To run the hosted media test, dispatch **SDK checks** on `main`. Configure the `sdk-live-tests` GitHub environment with `DTELECOM_CLOUD_URL`, `DTELECOM_API_KEY` and `DTELECOM_API_SECRET` from a Cloud project with WebRTC balance. Chromium publishes a 640 Hz tone to a unique room. The test checks received RTP and the frequency of the decoded echo. The job disconnects the participants after the call.

## License

Apache-2.0
