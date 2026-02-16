/**
 * Signaling protocol types for dTelecom RTC.
 * Matches livekit_rtc.proto from github.com/dtelecom/protocol.
 *
 * These types define the WebSocket signaling messages between
 * client and SFU (Selective Forwarding Unit).
 */

import * as _m0 from 'protobufjs/minimal';
import {
  Room,
  Codec,
  ParticipantInfo,
  TrackInfo,
  TrackType,
  TrackSource,
  ICEServer,
  ClientInfo,
  SpeakerInfo,
  DataPacket_Kind,
  DisconnectReason,
} from './models';

// ─── Enums ──────────────────────────────────────────────────────────────────

export enum SignalTarget {
  PUBLISHER = 0,
  SUBSCRIBER = 1,
}

export enum StreamState {
  ACTIVE = 0,
  PAUSED = 1,
}

export enum CandidateProtocol {
  UDP = 0,
  TCP = 1,
  TLS = 2,
}

// ─── Session Description ────────────────────────────────────────────────────

export interface SessionDescription {
  /** SDP offer/answer string */
  type: string;
  sdp: string;
}

// ─── Signal Request (client → server) ───────────────────────────────────────

export interface SignalRequest {
  offer?: SessionDescription;
  answer?: SessionDescription;
  trickle?: TrickleRequest;
  addTrack?: AddTrackRequest;
  mute?: MuteTrackRequest;
  subscription?: UpdateSubscription;
  trackSetting?: UpdateTrackSettings;
  leave?: LeaveRequest;
  updateLayers?: UpdateVideoLayers;
  subscriptionPermission?: SubscriptionPermission;
  syncState?: SyncState;
  simulate?: SimulateScenario;
  ping?: number;
  pingReq?: { timestamp: number; rtt: number };
}

// ─── Signal Response (server → client) ──────────────────────────────────────

export interface SignalResponse {
  join?: JoinResponse;
  offer?: SessionDescription;
  answer?: SessionDescription;
  trickle?: TrickleRequest;
  update?: ParticipantUpdate;
  trackPublished?: TrackPublishedResponse;
  leave?: LeaveRequest;
  mute?: MuteTrackRequest;
  speakersChanged?: SpeakersChanged;
  roomUpdate?: RoomUpdate;
  connectionQuality?: ConnectionQualityUpdate;
  streamStateUpdate?: StreamStateUpdate;
  subscribedQualityUpdate?: SubscribedQualityUpdate;
  subscriptionPermissionUpdate?: SubscriptionPermissionUpdate;
  refreshToken?: string;
  trackUnpublished?: TrackUnpublishedResponse;
  pong?: number;
  pongResp?: { lastPingTimestamp: number; timestamp: number };
}

// ─── Sub-messages ───────────────────────────────────────────────────────────

export interface TrickleRequest {
  candidateInit: string;
  target: SignalTarget;
}

export interface AddTrackRequest {
  cid: string;
  name: string;
  type: TrackType;
  width: number;
  height: number;
  muted: boolean;
  disableDtx: boolean;
  source: TrackSource;
  layers: SimulcastCodec[];
  sid: string;
}

export interface SimulcastCodec {
  codec: string;
  cid: string;
  enableSimulcastLayers: boolean;
}

export interface MuteTrackRequest {
  sid: string;
  muted: boolean;
}

export interface UpdateSubscription {
  trackSids: string[];
  subscribe: boolean;
  participantTracks: ParticipantTrackInfo[];
}

export interface ParticipantTrackInfo {
  participantSid: string;
  trackSids: string[];
}

export interface UpdateTrackSettings {
  trackSids: string[];
  disabled: boolean;
  quality: number;
  width: number;
  height: number;
  fps: number;
}

export interface LeaveRequest {
  canReconnect: boolean;
  reason: DisconnectReason;
}

export interface UpdateVideoLayers {
  trackSid: string;
  layers: VideoLayerInfo[];
}

export interface VideoLayerInfo {
  quality: number;
  width: number;
  height: number;
  bitrate: number;
  ssrc: number;
}

export interface SubscriptionPermission {
  allParticipants: boolean;
  trackPermissions: TrackPermission[];
}

export interface TrackPermission {
  participantSid: string;
  allTracks: boolean;
  trackSids: string[];
}

export interface SyncState {
  answer?: SessionDescription;
  subscription?: UpdateSubscription;
  publishTracks: TrackPublishedResponse[];
  dataChannels: DataChannelInfo[];
}

export interface DataChannelInfo {
  label: string;
  id: number;
  target: SignalTarget;
}

export interface SimulateScenario {
  speakerUpdate?: number;
  nodeFailure?: boolean;
  migration?: boolean;
  serverLeave?: boolean;
  switchCandidateProtocol?: CandidateProtocol;
}

// ─── Response sub-messages ──────────────────────────────────────────────────

export interface JoinResponse {
  room?: Room;
  participant?: ParticipantInfo;
  otherParticipants: ParticipantInfo[];
  serverVersion: string;
  iceServers: ICEServer[];
  subscriberPrimary: boolean;
  alternativeUrl: string;
  clientConfiguration?: ClientConfiguration;
  serverRegion: string;
  pingTimeout: number;
  pingInterval: number;
}

export interface ClientConfiguration {
  video?: VideoConfiguration;
  screen?: VideoConfiguration;
  resumeConnection: number;
  disabledCodecs?: DisabledCodecs;
  forceRelay: number;
}

export interface VideoConfiguration {
  hardwareEncoder: number;
}

export interface DisabledCodecs {
  codecs: CodecInfo[];
}

export interface CodecInfo {
  mime: string;
  fmtpLine: string;
}

export interface ParticipantUpdate {
  participants: ParticipantInfo[];
}

export interface TrackPublishedResponse {
  cid: string;
  track?: TrackInfo;
}

export interface TrackUnpublishedResponse {
  trackSid: string;
}

export interface SpeakersChanged {
  speakers: SpeakerInfo[];
}

export interface RoomUpdate {
  room?: Room;
}

export interface ConnectionQualityInfo {
  participantSid: string;
  quality: number;
  score: number;
}

export interface ConnectionQualityUpdate {
  updates: ConnectionQualityInfo[];
}

export interface StreamStateInfo {
  participantSid: string;
  trackSid: string;
  state: StreamState;
}

export interface StreamStateUpdate {
  streamStates: StreamStateInfo[];
}

export interface SubscribedQualityUpdate {
  trackSid: string;
  subscribedQualities: SubscribedQuality[];
  subscribedCodecs: SubscribedCodec[];
}

export interface SubscribedQuality {
  quality: number;
  enabled: boolean;
}

export interface SubscribedCodec {
  codec: string;
  qualities: SubscribedQuality[];
}

export interface SubscriptionPermissionUpdate {
  participantSid: string;
  trackSid: string;
  allowed: boolean;
}

// ─── Encode / Decode ────────────────────────────────────────────────────────

// Helper to write a nested message
function writeMessage(writer: _m0.Writer, fieldNumber: number, encodeFn: (w: _m0.Writer) => _m0.Writer): void {
  encodeFn(writer.uint32((fieldNumber << 3) | 2).fork()).ldelim();
}

function writeString(writer: _m0.Writer, fieldNumber: number, value: string): void {
  if (value !== '') {
    writer.uint32((fieldNumber << 3) | 2).string(value);
  }
}

function writeInt32(writer: _m0.Writer, fieldNumber: number, value: number): void {
  if (value !== 0) {
    writer.uint32((fieldNumber << 3) | 0).int32(value);
  }
}

function writeUint32(writer: _m0.Writer, fieldNumber: number, value: number): void {
  if (value !== 0) {
    writer.uint32((fieldNumber << 3) | 0).uint32(value);
  }
}

function writeBool(writer: _m0.Writer, fieldNumber: number, value: boolean): void {
  if (value) {
    writer.uint32((fieldNumber << 3) | 0).bool(value);
  }
}

// ─── SessionDescription encode/decode ───────────────────────────────────────

export const SessionDescription = {
  encode(message: SessionDescription, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writeString(writer, 1, message.type);
    writeString(writer, 2, message.sdp);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SessionDescription {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: SessionDescription = { type: '', sdp: '' };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.type = reader.string(); break;
        case 2: message.sdp = reader.string(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── TrickleRequest encode/decode ───────────────────────────────────────────

export const TrickleRequest = {
  encode(message: TrickleRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writeString(writer, 1, message.candidateInit);
    writeInt32(writer, 2, message.target);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): TrickleRequest {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: TrickleRequest = { candidateInit: '', target: 0 };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.candidateInit = reader.string(); break;
        case 2: message.target = reader.int32() as SignalTarget; break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── AddTrackRequest encode/decode ──────────────────────────────────────────

export const AddTrackRequest = {
  encode(message: AddTrackRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writeString(writer, 1, message.cid);
    writeString(writer, 2, message.name);
    writeInt32(writer, 3, message.type);
    writeUint32(writer, 4, message.width);
    writeUint32(writer, 5, message.height);
    writeBool(writer, 6, message.muted);
    writeBool(writer, 7, message.disableDtx);
    writeInt32(writer, 8, message.source);
    writeString(writer, 10, message.sid);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): AddTrackRequest {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: AddTrackRequest = {
      cid: '', name: '', type: 0, width: 0, height: 0,
      muted: false, disableDtx: false, source: 0, layers: [], sid: '',
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.cid = reader.string(); break;
        case 2: message.name = reader.string(); break;
        case 3: message.type = reader.int32() as TrackType; break;
        case 4: message.width = reader.uint32(); break;
        case 5: message.height = reader.uint32(); break;
        case 6: message.muted = reader.bool(); break;
        case 7: message.disableDtx = reader.bool(); break;
        case 8: message.source = reader.int32() as TrackSource; break;
        case 10: message.sid = reader.string(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── MuteTrackRequest encode/decode ─────────────────────────────────────────

export const MuteTrackRequest = {
  encode(message: MuteTrackRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writeString(writer, 1, message.sid);
    writeBool(writer, 2, message.muted);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): MuteTrackRequest {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MuteTrackRequest = { sid: '', muted: false };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.sid = reader.string(); break;
        case 2: message.muted = reader.bool(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── LeaveRequest encode/decode ─────────────────────────────────────────────

export const LeaveRequest = {
  encode(message: LeaveRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    writeBool(writer, 1, message.canReconnect);
    writeInt32(writer, 2, message.reason);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): LeaveRequest {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: LeaveRequest = { canReconnect: false, reason: 0 };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.canReconnect = reader.bool(); break;
        case 2: message.reason = reader.int32() as DisconnectReason; break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── UpdateSubscription encode/decode ───────────────────────────────────────

export const UpdateSubscription = {
  encode(message: UpdateSubscription, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.trackSids) {
      writeString(writer, 1, v);
    }
    writeBool(writer, 2, message.subscribe);
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): UpdateSubscription {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: UpdateSubscription = { trackSids: [], subscribe: false, participantTracks: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.trackSids.push(reader.string()); break;
        case 2: message.subscribe = reader.bool(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── JoinResponse decode ────────────────────────────────────────────────────

const Room_decode = (reader: _m0.Reader, length: number): Room => {
  const end = reader.pos + length;
  const msg: Room = {
    sid: '', name: '', emptyTimeout: 0, maxParticipants: 0,
    creationTime: 0, turnPassword: '', enabledCodecs: [],
    metadata: '', numParticipants: 0, activeRecording: false,
  };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1: msg.sid = reader.string(); break;
      case 2: msg.name = reader.string(); break;
      case 3: msg.emptyTimeout = reader.uint32(); break;
      case 4: msg.maxParticipants = reader.uint32(); break;
      case 5: msg.creationTime = reader.int64() as unknown as number; break;
      case 6: msg.turnPassword = reader.string(); break;
      case 7: {
        const codec: Codec = { mime: '', fmtpLine: '' };
        const cEnd = reader.pos + reader.uint32();
        while (reader.pos < cEnd) {
          const cTag = reader.uint32();
          switch (cTag >>> 3) {
            case 1: codec.mime = reader.string(); break;
            case 2: codec.fmtpLine = reader.string(); break;
            default: reader.skipType(cTag & 7); break;
          }
        }
        msg.enabledCodecs.push(codec);
        break;
      }
      case 8: msg.metadata = reader.string(); break;
      case 9: msg.numParticipants = reader.uint32(); break;
      case 10: msg.activeRecording = reader.bool(); break;
      default: reader.skipType(tag & 7); break;
    }
  }
  return msg;
};

const ICEServer_decode = (reader: _m0.Reader, length: number): ICEServer => {
  const end = reader.pos + length;
  const msg: ICEServer = { urls: [], username: '', credential: '' };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1: msg.urls.push(reader.string()); break;
      case 2: msg.username = reader.string(); break;
      case 3: msg.credential = reader.string(); break;
      default: reader.skipType(tag & 7); break;
    }
  }
  return msg;
};

const TrackInfo_decode = (reader: _m0.Reader, length: number): TrackInfo => {
  const end = reader.pos + length;
  const msg: TrackInfo = {
    sid: '', type: 0, name: '', muted: false, width: 0, height: 0,
    simulcast: false, disableDtx: false, source: 0, layers: [],
    mimeType: '', mid: '',
  };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1: msg.sid = reader.string(); break;
      case 2: msg.type = reader.int32() as TrackType; break;
      case 3: msg.name = reader.string(); break;
      case 4: msg.muted = reader.bool(); break;
      case 5: msg.width = reader.uint32(); break;
      case 6: msg.height = reader.uint32(); break;
      case 7: msg.simulcast = reader.bool(); break;
      case 8: msg.disableDtx = reader.bool(); break;
      case 9: msg.source = reader.int32() as TrackSource; break;
      case 11: msg.mimeType = reader.string(); break;
      case 12: msg.mid = reader.string(); break;
      default: reader.skipType(tag & 7); break;
    }
  }
  return msg;
};

const ParticipantInfo_decode = (reader: _m0.Reader, length: number): ParticipantInfo => {
  const end = reader.pos + length;
  const msg: ParticipantInfo = {
    sid: '', identity: '', state: 0, tracks: [], metadata: '',
    joinedAt: 0, name: '', version: 0, region: '', isPublisher: false,
  };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1: msg.sid = reader.string(); break;
      case 2: msg.identity = reader.string(); break;
      case 3: msg.state = reader.int32(); break;
      case 4: msg.tracks.push(TrackInfo_decode(reader, reader.uint32())); break;
      case 5: msg.metadata = reader.string(); break;
      case 6: msg.joinedAt = reader.int64() as unknown as number; break;
      case 7: msg.name = reader.string(); break;
      case 10: msg.version = reader.uint32(); break;
      case 11: {
        const pEnd = reader.pos + reader.uint32();
        const perm: import('./models').ParticipantPermission = {
          canSubscribe: false, canPublish: false,
          canPublishData: false, hidden: false, recorder: false,
        };
        while (reader.pos < pEnd) {
          const pTag = reader.uint32();
          switch (pTag >>> 3) {
            case 1: perm.canSubscribe = reader.bool(); break;
            case 2: perm.canPublish = reader.bool(); break;
            case 3: perm.canPublishData = reader.bool(); break;
            case 7: perm.hidden = reader.bool(); break;
            case 8: perm.recorder = reader.bool(); break;
            default: reader.skipType(pTag & 7); break;
          }
        }
        msg.permission = perm;
        break;
      }
      case 12: msg.region = reader.string(); break;
      case 13: msg.isPublisher = reader.bool(); break;
      default: reader.skipType(tag & 7); break;
    }
  }
  return msg;
};

const SpeakerInfo_decode = (reader: _m0.Reader, length: number): SpeakerInfo => {
  const end = reader.pos + length;
  const msg: SpeakerInfo = { sid: '', level: 0, active: false };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1: msg.sid = reader.string(); break;
      case 2: msg.level = reader.float(); break;
      case 3: msg.active = reader.bool(); break;
      default: reader.skipType(tag & 7); break;
    }
  }
  return msg;
};

export const JoinResponse = {
  decode(input: _m0.Reader | Uint8Array, length?: number): JoinResponse {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: JoinResponse = {
      otherParticipants: [], serverVersion: '', iceServers: [],
      subscriberPrimary: false, alternativeUrl: '', serverRegion: '',
      pingTimeout: 0, pingInterval: 0,
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.room = Room_decode(reader, reader.uint32()); break;
        case 2: message.participant = ParticipantInfo_decode(reader, reader.uint32()); break;
        case 3: message.otherParticipants.push(ParticipantInfo_decode(reader, reader.uint32())); break;
        case 4: message.serverVersion = reader.string(); break;
        case 5: message.iceServers.push(ICEServer_decode(reader, reader.uint32())); break;
        case 6: message.subscriberPrimary = reader.bool(); break;
        case 7: message.alternativeUrl = reader.string(); break;
        case 9: message.serverRegion = reader.string(); break;
        case 10: message.pingTimeout = reader.int32(); break;
        case 11: message.pingInterval = reader.int32(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const TrackPublishedResponse = {
  decode(input: _m0.Reader | Uint8Array, length?: number): TrackPublishedResponse {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: TrackPublishedResponse = { cid: '' };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.cid = reader.string(); break;
        case 2: message.track = TrackInfo_decode(reader, reader.uint32()); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const ParticipantUpdate = {
  decode(input: _m0.Reader | Uint8Array, length?: number): ParticipantUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: ParticipantUpdate = { participants: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.participants.push(ParticipantInfo_decode(reader, reader.uint32())); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const SpeakersChanged = {
  decode(input: _m0.Reader | Uint8Array, length?: number): SpeakersChanged {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: SpeakersChanged = { speakers: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.speakers.push(SpeakerInfo_decode(reader, reader.uint32())); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const RoomUpdate = {
  decode(input: _m0.Reader | Uint8Array, length?: number): RoomUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: RoomUpdate = {};
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.room = Room_decode(reader, reader.uint32()); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const TrackUnpublishedResponse = {
  decode(input: _m0.Reader | Uint8Array, length?: number): TrackUnpublishedResponse {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: TrackUnpublishedResponse = { trackSid: '' };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.trackSid = reader.string(); break;
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const ConnectionQualityUpdate = {
  decode(input: _m0.Reader | Uint8Array, length?: number): ConnectionQualityUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: ConnectionQualityUpdate = { updates: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          const cEnd = reader.pos + reader.uint32();
          const info: ConnectionQualityInfo = { participantSid: '', quality: 0, score: 0 };
          while (reader.pos < cEnd) {
            const cTag = reader.uint32();
            switch (cTag >>> 3) {
              case 1: info.participantSid = reader.string(); break;
              case 2: info.quality = reader.int32(); break;
              case 3: info.score = reader.float(); break;
              default: reader.skipType(cTag & 7); break;
            }
          }
          message.updates.push(info);
          break;
        }
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

export const StreamStateUpdate = {
  decode(input: _m0.Reader | Uint8Array, length?: number): StreamStateUpdate {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: StreamStateUpdate = { streamStates: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          const sEnd = reader.pos + reader.uint32();
          const info: StreamStateInfo = { participantSid: '', trackSid: '', state: 0 };
          while (reader.pos < sEnd) {
            const sTag = reader.uint32();
            switch (sTag >>> 3) {
              case 1: info.participantSid = reader.string(); break;
              case 2: info.trackSid = reader.string(); break;
              case 3: info.state = reader.int32(); break;
              default: reader.skipType(sTag & 7); break;
            }
          }
          message.streamStates.push(info);
          break;
        }
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};

// ─── SignalRequest encode ───────────────────────────────────────────────────

export const SignalRequest = {
  encode(message: SignalRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.offer !== undefined) {
      writeMessage(writer, 1, (w) => SessionDescription.encode(message.offer!, w));
    }
    if (message.answer !== undefined) {
      writeMessage(writer, 2, (w) => SessionDescription.encode(message.answer!, w));
    }
    if (message.trickle !== undefined) {
      writeMessage(writer, 3, (w) => TrickleRequest.encode(message.trickle!, w));
    }
    if (message.addTrack !== undefined) {
      writeMessage(writer, 4, (w) => AddTrackRequest.encode(message.addTrack!, w));
    }
    if (message.mute !== undefined) {
      writeMessage(writer, 5, (w) => MuteTrackRequest.encode(message.mute!, w));
    }
    if (message.subscription !== undefined) {
      writeMessage(writer, 6, (w) => UpdateSubscription.encode(message.subscription!, w));
    }
    if (message.leave !== undefined) {
      writeMessage(writer, 8, (w) => LeaveRequest.encode(message.leave!, w));
    }
    if (message.ping !== undefined) {
      writer.uint32(112).int64(message.ping);
    }
    if (message.pingReq !== undefined) {
      // field 16, wire type 2 (length-delimited): tag = (16 << 3) | 2 = 130
      const nested = writer.uint32(130).fork();
      nested.uint32(8).int64(message.pingReq.timestamp);   // field 1
      nested.uint32(16).int64(message.pingReq.rtt);         // field 2
      nested.ldelim();
    }
    return writer;
  },
};

// ─── SignalResponse decode ──────────────────────────────────────────────────

export const SignalResponse = {
  decode(input: _m0.Reader | Uint8Array, length?: number): SignalResponse {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: SignalResponse = {};
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.join = JoinResponse.decode(reader, reader.uint32()); break;
        case 2: message.answer = SessionDescription.decode(reader, reader.uint32()); break;
        case 3: message.offer = SessionDescription.decode(reader, reader.uint32()); break;
        case 4: message.trickle = TrickleRequest.decode(reader, reader.uint32()); break;
        case 5: message.update = ParticipantUpdate.decode(reader, reader.uint32()); break;
        case 6: message.trackPublished = TrackPublishedResponse.decode(reader, reader.uint32()); break;
        case 8: message.leave = LeaveRequest.decode(reader, reader.uint32()); break;
        case 9: message.mute = MuteTrackRequest.decode(reader, reader.uint32()); break;
        case 10: message.speakersChanged = SpeakersChanged.decode(reader, reader.uint32()); break;
        case 11: message.roomUpdate = RoomUpdate.decode(reader, reader.uint32()); break;
        case 12: message.connectionQuality = ConnectionQualityUpdate.decode(reader, reader.uint32()); break;
        case 13: message.streamStateUpdate = StreamStateUpdate.decode(reader, reader.uint32()); break;
        case 15: message.refreshToken = reader.string(); break;
        case 17: message.trackUnpublished = TrackUnpublishedResponse.decode(reader, reader.uint32()); break;
        case 18: message.pong = reader.int64() as unknown as number; break;
        case 20: {
          // pongResp: Pong message (field 20, length-delimited)
          const pongEnd = reader.pos + reader.uint32();
          const pongResp: { lastPingTimestamp: number; timestamp: number } = { lastPingTimestamp: 0, timestamp: 0 };
          while (reader.pos < pongEnd) {
            const pongTag = reader.uint32();
            switch (pongTag >>> 3) {
              case 1: pongResp.lastPingTimestamp = reader.int64() as unknown as number; break;
              case 2: pongResp.timestamp = reader.int64() as unknown as number; break;
              default: reader.skipType(pongTag & 7); break;
            }
          }
          message.pongResp = pongResp;
          break;
        }
        default: reader.skipType(tag & 7); break;
      }
    }
    return message;
  },
};
