/**
 * @dtelecom/server-sdk-node
 *
 * Node.js RTC SDK for dTelecom — WebRTC participant for AI bots.
 *
 * Key classes:
 * - Room: Connect to a dTelecom room
 * - AudioSource: Feed PCM16 audio to publish
 * - AudioStream: Receive decoded PCM16 audio
 * - AudioFrame: PCM16 audio container
 * - LocalAudioTrack: Local audio track for publishing
 */

// ─── Room ───────────────────────────────────────────────────────────────────
export { Room } from './room';
export type { RoomOptions, RoomEvents } from './room';

// ─── Participants ───────────────────────────────────────────────────────────
export {
  Participant,
  LocalParticipant,
  RemoteParticipant,
} from './participant';
export type { DataPublishOptions, ParticipantEvents, RemoteParticipantEvents } from './participant';

// ─── Tracks ─────────────────────────────────────────────────────────────────
export {
  LocalAudioTrack,
  RemoteAudioTrack,
  TrackPublication,
  LocalTrackPublication,
  RemoteTrackPublication,
} from './track';
export type { TrackPublishOptions } from './track';

// ─── Audio ──────────────────────────────────────────────────────────────────
export { AudioFrame } from './audio/audio-frame';
export { AudioSource } from './audio/audio-source';
export { AudioStream } from './audio/audio-stream';
export { resample, downsample, upsample } from './audio/resampler';

// ─── Data ───────────────────────────────────────────────────────────────────
export {
  encodeDataPacket,
  decodeDataPacket,
  createTextMessage,
} from './data/data-channel';

// ─── Proto types (for advanced usage) ───────────────────────────────────────
export {
  TrackType,
  TrackSource,
  DataPacket_Kind,
  ParticipantInfo_State,
  ConnectionQuality,
  DisconnectReason,
} from './proto/models';
export type {
  Room as RoomInfo,
  ParticipantInfo,
  TrackInfo,
  DataPacket,
  UserPacket,
  ICEServer,
  SpeakerInfo,
} from './proto/models';

// ─── Utils ──────────────────────────────────────────────────────────────────
export { setLogLevel, LogLevel } from './utils/logger';
export type { Logger } from './utils/logger';
