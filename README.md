# @dtelecom/server-sdk-node

Node.js RTC SDK for dTelecom — join rooms as a WebRTC participant for AI bots.

## Features

- **WebRTC participant** — join dTelecom rooms as a bot
- **Audio receive** — subscribe to remote audio as PCM16 streams (16kHz for STT)
- **Audio send** — publish PCM16 audio as Opus (from TTS or any source)
- **Data channels** — send/receive messages via reliable or lossy channels
- **Pure TypeScript WebRTC** — uses [werift](https://github.com/nicejs/werift-webrtc) (no native WebRTC deps)
- **Opus codec** — uses [@discordjs/opus](https://github.com/discordjs/opus) (native libopus bindings)

## Install

```bash
npm install @dtelecom/server-sdk-node @discordjs/opus
```

## Quick Start: Echo Bot

```typescript
import { Room, AudioSource, AudioStream, AudioFrame, LocalAudioTrack } from '@dtelecom/server-sdk-node';

const room = new Room();
await room.connect('wss://my.dtelecom.org', token);

// Create audio output
const source = new AudioSource(16000, 1);
const track = LocalAudioTrack.createAudioTrack('echo', source);
await room.localParticipant.publishTrack(track);

// Echo received audio back
room.on('trackSubscribed', async (remoteTrack, pub, participant) => {
  const stream = remoteTrack.createStream(16000, 1);
  for await (const frame of stream) {
    await source.captureFrame(frame); // echo back
  }
});
```

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
room.on('disconnected', (reason) => { });

await room.disconnect();
```

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

```bash
# Echo bot — echoes received audio back
npx tsx examples/echo-bot.ts --room test

# Record audio — saves remote audio to PCM file
npx tsx examples/receive-audio.ts --room test --output recording.pcm

# Play audio — sends PCM file into room
npx tsx examples/send-audio.ts --room test --input hello.pcm
```

## Dependencies

| Package | Purpose | Native? |
|---|---|---|
| `werift` | WebRTC (ICE, DTLS, SRTP) | No (pure TS) |
| `@discordjs/opus` | Opus encode/decode | Yes (libopus) |
| `ws` | WebSocket client | No |
| `protobufjs` | Protobuf encode/decode | No |

## License

Apache-2.0
