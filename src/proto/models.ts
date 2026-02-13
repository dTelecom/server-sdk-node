/**
 * Core protocol model types for dTelecom.
 * Manually defined to match github.com/dtelecom/protocol (dtelecom-db branch).
 * These mirror the types in livekit_models.proto.
 */

import * as _m0 from 'protobufjs/minimal';

// ─── Enums ──────────────────────────────────────────────────────────────────

export enum TrackType {
  AUDIO = 0,
  VIDEO = 1,
  DATA = 2,
}

export enum TrackSource {
  UNKNOWN = 0,
  CAMERA = 1,
  MICROPHONE = 2,
  SCREEN_SHARE = 3,
  SCREEN_SHARE_AUDIO = 4,
}

export enum VideoQuality {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  OFF = 3,
}

export enum ParticipantInfo_State {
  JOINING = 0,
  JOINED = 1,
  ACTIVE = 2,
  DISCONNECTED = 3,
}

export enum DataPacket_Kind {
  RELIABLE = 0,
  LOSSY = 1,
}

export enum ConnectionQuality {
  POOR = 0,
  GOOD = 1,
  EXCELLENT = 2,
}

export enum DisconnectReason {
  UNKNOWN_REASON = 0,
  CLIENT_INITIATED = 1,
  DUPLICATE_IDENTITY = 2,
  SERVER_SHUTDOWN = 3,
  PARTICIPANT_REMOVED = 4,
  ROOM_DELETED = 5,
  STATE_MISMATCH = 6,
  JOIN_FAILURE = 7,
}

// ─── Messages ───────────────────────────────────────────────────────────────

export interface Room {
  sid: string;
  name: string;
  emptyTimeout: number;
  maxParticipants: number;
  creationTime: number;
  turnPassword: string;
  enabledCodecs: Codec[];
  metadata: string;
  numParticipants: number;
  activeRecording: boolean;
}

export interface Codec {
  mime: string;
  fmtpLine: string;
}

export interface ParticipantPermission {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  hidden: boolean;
  recorder: boolean;
}

export interface ParticipantInfo {
  sid: string;
  identity: string;
  state: ParticipantInfo_State;
  tracks: TrackInfo[];
  metadata: string;
  joinedAt: number;
  name: string;
  version: number;
  permission?: ParticipantPermission;
  region: string;
  isPublisher: boolean;
}

export interface TrackInfo {
  sid: string;
  type: TrackType;
  name: string;
  muted: boolean;
  width: number;
  height: number;
  simulcast: boolean;
  disableDtx: boolean;
  source: TrackSource;
  layers: VideoLayer[];
  mimeType: string;
  mid: string;
}

export interface VideoLayer {
  quality: VideoQuality;
  width: number;
  height: number;
  bitrate: number;
  ssrc: number;
}

export interface DataPacket {
  kind: DataPacket_Kind;
  user?: UserPacket;
  speaker?: ActiveSpeakerUpdate;
}

export interface UserPacket {
  participantSid: string;
  payload: Uint8Array;
  destinationSids: string[];
  topic?: string;
}

export interface ActiveSpeakerUpdate {
  speakers: SpeakerInfo[];
}

export interface SpeakerInfo {
  sid: string;
  level: number;
  active: boolean;
}

export interface ParticipantTracks {
  participantSid: string;
  trackSids: string[];
}

export interface ICEServer {
  urls: string[];
  username: string;
  credential: string;
}

export interface ClientInfo {
  sdk: ClientInfo_SDK;
  version: string;
  protocol: number;
  os: string;
  osVersion: string;
  deviceModel: string;
  browser: string;
  browserVersion: string;
  address: string;
  network: string;
}

export enum ClientInfo_SDK {
  UNKNOWN = 0,
  JS = 1,
  SWIFT = 2,
  ANDROID = 3,
  FLUTTER = 4,
  GO = 5,
  UNITY = 6,
  REACT_NATIVE = 7,
  RUST = 8,
  PYTHON = 9,
  CPP = 10,
  NODE = 11,
}

// ─── Encode / Decode helpers ────────────────────────────────────────────────

export const DataPacket = {
  encode(message: DataPacket, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.kind !== 0) {
      writer.uint32(8).int32(message.kind);
    }
    if (message.user !== undefined) {
      UserPacket.encode(message.user, writer.uint32(18).fork()).ldelim();
    }
    if (message.speaker !== undefined) {
      ActiveSpeakerUpdate.encode(message.speaker, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): DataPacket {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: DataPacket = { kind: 0 };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.kind = reader.int32() as DataPacket_Kind;
          break;
        case 2:
          message.user = UserPacket.decode(reader, reader.uint32());
          break;
        case 3:
          message.speaker = ActiveSpeakerUpdate.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
};

export const UserPacket = {
  encode(message: UserPacket, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.participantSid !== '') {
      writer.uint32(10).string(message.participantSid);
    }
    if (message.payload.length !== 0) {
      writer.uint32(18).bytes(message.payload);
    }
    for (const v of message.destinationSids) {
      writer.uint32(26).string(v);
    }
    if (message.topic !== undefined) {
      writer.uint32(34).string(message.topic);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): UserPacket {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: UserPacket = {
      participantSid: '',
      payload: new Uint8Array(),
      destinationSids: [],
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.participantSid = reader.string();
          break;
        case 2:
          message.payload = reader.bytes() as Uint8Array;
          break;
        case 3:
          message.destinationSids.push(reader.string());
          break;
        case 4:
          message.topic = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
};

export const ActiveSpeakerUpdate = {
  encode(message: ActiveSpeakerUpdate, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.speakers) {
      SpeakerInfo.encode(v, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ActiveSpeakerUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: ActiveSpeakerUpdate = { speakers: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.speakers.push(SpeakerInfo.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
};

export const SpeakerInfo = {
  encode(message: SpeakerInfo, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.sid !== '') {
      writer.uint32(10).string(message.sid);
    }
    if (message.level !== 0) {
      writer.uint32(21).float(message.level);
    }
    if (message.active) {
      writer.uint32(24).bool(message.active);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SpeakerInfo {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: SpeakerInfo = { sid: '', level: 0, active: false };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sid = reader.string();
          break;
        case 2:
          message.level = reader.float();
          break;
        case 3:
          message.active = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
};
