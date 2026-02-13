/**
 * Room — the main entry point for connecting to a dTelecom room.
 *
 * Manages:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Participant management (join, leave, track subscribe)
 * - Event dispatch
 */

import { TypedEmitter } from './utils/events';
import { createLogger } from './utils/logger';
import { RTCEngine } from './engine';
import {
  LocalParticipant,
  RemoteParticipant,
  Participant,
  DataPublishOptions,
} from './participant';
import {
  RemoteAudioTrack,
  TrackPublication,
  RemoteTrackPublication,
} from './track';
import {
  Room as RoomInfo,
  ParticipantInfo,
  ParticipantInfo_State,
  TrackType,
  DataPacket,
  DataPacket_Kind,
  UserPacket,
  SpeakerInfo,
} from './proto/models';
import {
  JoinResponse,
  ParticipantUpdate,
  SpeakersChanged,
} from './proto/signal';

const log = createLogger('Room');

// ─── Room Options ───────────────────────────────────────────────────────────

export interface RoomOptions {
  /** Auto-subscribe to all published tracks (default: true) */
  autoSubscribe?: boolean;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
}

// ─── Room Events ────────────────────────────────────────────────────────────

export interface RoomEvents {
  [key: string]: (...args: any[]) => void;
  participantConnected: (participant: RemoteParticipant) => void;
  participantDisconnected: (participant: RemoteParticipant) => void;
  trackSubscribed: (track: RemoteAudioTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: RemoteAudioTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  trackPublished: (publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  trackUnpublished: (publication: RemoteTrackPublication, participant: RemoteParticipant) => void;
  activeSpeakersChanged: (speakers: Array<LocalParticipant | RemoteParticipant>) => void;
  dataReceived: (data: Uint8Array, participant: RemoteParticipant | undefined, kind: DataPacket_Kind, topic?: string) => void;
  disconnected: (reason?: string) => void;
  reconnecting: () => void;
  reconnected: () => void;
  roomMetadataChanged: (metadata: string) => void;
}

// ─── Room Class ─────────────────────────────────────────────────────────────

export class Room extends TypedEmitter<RoomEvents> {
  /** Local participant (this bot) */
  localParticipant!: LocalParticipant;

  /** Remote participants indexed by SID */
  readonly remoteParticipants = new Map<string, RemoteParticipant>();

  /** Room name */
  name: string = '';
  /** Room SID */
  sid: string = '';
  /** Room metadata */
  metadata: string = '';

  private engine: RTCEngine;
  private _isConnected = false;
  private activeSpeakers: Array<LocalParticipant | RemoteParticipant> = [];
  private roomInfo: RoomInfo | null = null;

  constructor() {
    super();
    this.engine = new RTCEngine();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to a dTelecom room.
   *
   * @param url WebSocket URL of the dTelecom server (e.g. "wss://my.dtelecom.org")
   * @param token JWT access token (from AccessToken in @dtelecom/server-sdk-js)
   * @param options Room connection options
   */
  async connect(url: string, token: string, options: RoomOptions = {}): Promise<void> {
    log.info('Connecting to room...');

    // Connect via engine (signal + WebRTC)
    const joinResponse = await this.engine.connect(url, token, {
      autoSubscribe: options.autoSubscribe ?? true,
      connectTimeout: options.connectTimeout ?? 10000,
    });

    // Initialize room state from JoinResponse
    this.handleJoinResponse(joinResponse);

    // Set up engine event handlers
    this.setupEngineHandlers();

    // Set up signal event handlers (for participant updates)
    this.setupSignalHandlers();

    this._isConnected = true;
    log.info(`Connected to room "${this.name}" as "${this.localParticipant.identity}"`);
  }

  /**
   * Disconnect from the room.
   */
  async disconnect(): Promise<void> {
    if (!this._isConnected) return;

    log.info('Disconnecting from room...');
    this._isConnected = false;

    // Clean up remote participants
    for (const [sid, participant] of this.remoteParticipants) {
      participant.destroy();
      this.remoteParticipants.delete(sid);
    }

    await this.engine.disconnect();
    this.emit('disconnected', 'client_initiated');
  }

  /** Get a remote participant by SID */
  getParticipant(sid: string): RemoteParticipant | undefined {
    return this.remoteParticipants.get(sid);
  }

  /** Get a remote participant by identity */
  getParticipantByIdentity(identity: string): RemoteParticipant | undefined {
    for (const p of this.remoteParticipants.values()) {
      if (p.identity === identity) return p;
    }
    return undefined;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private handleJoinResponse(join: JoinResponse): void {
    // Room info
    if (join.room) {
      this.roomInfo = join.room;
      this.name = join.room.name;
      this.sid = join.room.sid;
      this.metadata = join.room.metadata;
    }

    // Local participant
    if (join.participant) {
      this.localParticipant = new LocalParticipant(
        this.engine,
        join.participant.sid,
        join.participant.identity,
        join.participant.name,
        join.participant.metadata,
      );
    }

    // Other participants
    for (const info of join.otherParticipants) {
      this.getOrCreateParticipant(info);
    }
  }

  private setupEngineHandlers(): void {
    // WebRTC connected
    this.engine.on('connected', () => {
      log.info('WebRTC connection established');
    });

    // WebRTC disconnected
    this.engine.on('disconnected', (reason) => {
      if (this._isConnected) {
        this._isConnected = false;
        this.emit('disconnected', reason);
      }
    });

    // Remote track received on subscriber
    this.engine.on('remoteTrack', (mediaTrack, transceiver) => {
      this.handleRemoteTrack(mediaTrack, transceiver);
    });

    // Data message received
    this.engine.on('dataMessage', (data, kind) => {
      this.handleDataMessage(data, kind);
    });
  }

  private setupSignalHandlers(): void {
    // Participant updates (join, leave, track changes)
    this.engine.signal.on('participantUpdate', (update) => {
      this.handleParticipantUpdate(update);
    });

    // Speakers changed
    this.engine.signal.on('speakersChanged', (changed) => {
      this.handleSpeakersChanged(changed);
    });

    // Room metadata update
    this.engine.signal.on('roomUpdate', (update) => {
      if (update.room) {
        this.roomInfo = update.room;
        const oldMetadata = this.metadata;
        this.metadata = update.room.metadata;
        if (oldMetadata !== this.metadata) {
          this.emit('roomMetadataChanged', this.metadata);
        }
      }
    });

    // Token refresh
    this.engine.signal.on('tokenRefresh', (token) => {
      log.debug('Token refreshed');
    });
  }

  private handleParticipantUpdate(update: ParticipantUpdate): void {
    for (const info of update.participants) {
      // Skip local participant (match by SID or identity)
      if (info.sid === this.localParticipant.sid || info.identity === this.localParticipant.identity) {
        this.localParticipant.updateInfo(info);
        continue;
      }

      if (info.state === ParticipantInfo_State.DISCONNECTED) {
        // Participant left
        const participant = this.remoteParticipants.get(info.sid);
        if (participant) {
          participant.destroy();
          this.remoteParticipants.delete(info.sid);
          log.info(`Participant disconnected: ${participant.identity}`);
          this.emit('participantDisconnected', participant);
        }
      } else {
        // Participant joined or updated
        const isNew = !this.remoteParticipants.has(info.sid);
        const participant = this.getOrCreateParticipant(info);

        if (isNew) {
          log.info(`Participant connected: ${participant.identity}`);
          this.emit('participantConnected', participant);
        }
      }
    }
  }

  private handleRemoteTrack(mediaTrack: any, transceiver: any): void {
    const mid = transceiver.mid;
    const mediaKind = mediaTrack?.kind; // 'audio' or 'video'

    // Map werift track kind to proto TrackType
    const expectedType = mediaKind === 'audio' ? TrackType.AUDIO : TrackType.VIDEO;

    // Search participants for an unassigned publication matching the track kind
    for (const participant of this.remoteParticipants.values()) {
      for (const [sid, pub] of participant.trackPublications) {
        if (!pub.track && pub.kind === expectedType) {
          // Only handle audio tracks (video not supported in this SDK)
          if (mediaKind !== 'audio') {
            log.debug(`Skipping ${mediaKind} track ${sid} (audio-only SDK)`);
            return;
          }

          // addSubscribedTrack emits 'trackSubscribed' on participant,
          // which bubbles up to Room via the listener in getOrCreateParticipant
          participant.addSubscribedTrack(mediaTrack, sid, pub.name);
          return;
        }
      }
    }

    log.warn(`Received remote track (mid=${mid}, kind=${mediaKind}) but couldn't match to a participant`);
  }

  private handleDataMessage(data: Uint8Array, kind: 'reliable' | 'lossy'): void {
    try {
      const packet = DataPacket.decode(data);
      if (packet.user) {
        const participant = this.remoteParticipants.get(packet.user.participantSid);
        const packetKind = kind === 'reliable' ? DataPacket_Kind.RELIABLE : DataPacket_Kind.LOSSY;
        this.emit('dataReceived', packet.user.payload, participant, packetKind, packet.user.topic);
      }
    } catch (err) {
      log.error('Failed to decode data message', err);
    }
  }

  private handleSpeakersChanged(changed: SpeakersChanged): void {
    const speakers: Array<LocalParticipant | RemoteParticipant> = [];
    for (const speaker of changed.speakers) {
      if (speaker.sid === this.localParticipant.sid) {
        speakers.push(this.localParticipant);
      } else {
        const p = this.remoteParticipants.get(speaker.sid);
        if (p) speakers.push(p);
      }
    }
    this.activeSpeakers = speakers;
    this.emit('activeSpeakersChanged', speakers);
  }

  private getOrCreateParticipant(info: ParticipantInfo): RemoteParticipant {
    let participant = this.remoteParticipants.get(info.sid);
    if (participant) {
      participant.updateInfo(info);
    } else {
      participant = new RemoteParticipant(info);
      this.remoteParticipants.set(info.sid, participant);

      // Wire up participant events to room events
      participant.on('trackSubscribed', (track, pub) => {
        this.emit('trackSubscribed', track, pub, participant!);
      });
      participant.on('trackUnsubscribed', (track, pub) => {
        this.emit('trackUnsubscribed', track, pub, participant!);
      });
      participant.on('trackPublished', (pub) => {
        this.emit('trackPublished', pub as RemoteTrackPublication, participant!);
      });
      participant.on('trackUnpublished', (pub) => {
        this.emit('trackUnpublished', pub as RemoteTrackPublication, participant!);
      });
    }
    return participant;
  }
}
