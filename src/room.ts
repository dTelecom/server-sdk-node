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
import { rankedUrls, SessionEnded, TransportError } from './connection';
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

/**
 * Unpack the SFU-assigned stream ID.
 * The SFU packs "participantSid|trackSid" into the msid stream ID attribute.
 * Same logic as Go SDK's unpackStreamID (room.go).
 */
export function unpackStreamId(packed: string): { participantSid: string; trackSid: string } {
  const pipeIndex = packed.indexOf('|');
  if (pipeIndex >= 0) {
    return {
      participantSid: packed.substring(0, pipeIndex),
      trackSid: packed.substring(pipeIndex + 1),
    };
  }
  return { participantSid: packed, trackSid: '' };
}

// ─── Room Options ───────────────────────────────────────────────────────────

export interface RoomOptions {
  /** Auto-subscribe to all published tracks (default: true) */
  autoSubscribe?: boolean;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
  /** Signaling URLs supplied by the token issuer in preferred order. */
  fallbackUrls?: string[];
}

interface RoomSession {
  token: string;
  primary: string;
  serving: string;
  urls: string[];
  options: RoomOptions;
  controller: AbortController;
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
  private session?: RoomSession;
  private activeSpeakers: Array<LocalParticipant | RemoteParticipant> = [];
  private roomInfo: RoomInfo | null = null;
  /** Identity-prefixed logger for debugging multi-Room scenarios */
  private log = log;

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
    if (this.session) throw new Error('Room already connecting or connected');
    const session: RoomSession = {
      primary: url,
      serving: url,
      token,
      urls: rankedUrls(url, options.fallbackUrls),
      options,
      controller: new AbortController(),
    };
    this.session = session;
    try {
      await this.joinRanked(session, false);
    } catch (error) {
      if (this.session === session) this.session = undefined;
      throw error;
    }
  }

  /** Replace the credential and optional ranked endpoints used on a future full reconnect. */
  updateConnectionToken(token: string, fallbackUrls?: string[]): void {
    if (!this.session) return;
    this.session.token = token;
    if (fallbackUrls) {
      this.session.primary = fallbackUrls[0] ?? this.session.primary;
      this.session.urls = rankedUrls(this.session.primary, fallbackUrls);
    }
  }

  private async joinRanked(session: RoomSession, restoring: boolean): Promise<void> {
    const attempted = new Set<string>();
    let endpoint = session.urls.includes(session.serving) ? session.serving : session.urls[0];
    while (true) {
      attempted.add(endpoint);
      const signal = session.controller.signal;
      signal.throwIfAborted();
      const engine = this.engine;
      this.earlyParticipantUpdates = [];
      this.pendingTracks = [];
      this.setupEngineHandlers();
      this.setupSignalHandlers();

      let fail!: (error: Error) => void;
      const interrupted = new Promise<never>((_, reject) => { fail = reject; });
      const onAbort = () => fail(new SessionEnded('client_initiated'));
      const onLoss = (reason?: string, transport?: boolean) =>
        fail(transport ? new TransportError(reason) : new SessionEnded(reason));
      engine.on('disconnected', onLoss);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const join = await Promise.race([engine.connect(endpoint, session.token, session.options), interrupted]);
        signal.throwIfAborted();
        this.handleJoinResponse(join, restoring);
        const early = this.earlyParticipantUpdates;
        this.earlyParticipantUpdates = null;
        for (const update of early ?? []) this.handleParticipantUpdate(update);
        this.flushPendingTracks();
        if (restoring && join.participant) {
          await Promise.race([this.localParticipant.restore(engine), interrupted]);
        }
        signal.throwIfAborted();
        session.serving = endpoint;
        this._isConnected = true;
        this.log = log;
        return;
      } catch (error) {
        await this.releaseEngine(engine);
        if (signal.aborted || !(error instanceof TransportError)) throw error;
        // A token extension can replace the list while a previous attempt is in flight.
        const next = session.urls.find(url => !attempted.has(url));
        if (!next) throw error;
        endpoint = next;
      } finally {
        signal.removeEventListener('abort', onAbort);
        engine.off('disconnected', onLoss);
      }
    }
  }

  private async recover(session: RoomSession, reason?: string): Promise<void> {
    this._isConnected = false;
    const priorEngine = this.engine;
    this.localParticipant.detachTransport();
    this.emit('reconnecting');
    try {
      await this.releaseEngine(priorEngine);
      await this.joinRanked(session, true);
      this.emit('reconnected');
    } catch (error) {
      if (this.session !== session) return;
      this.session = undefined;
      this.emit('disconnected', error instanceof SessionEnded ? error.message : reason);
    }
  }

  private async releaseEngine(engine: RTCEngine): Promise<void> {
    if (this.engine !== engine) return;
    this.engine = new RTCEngine();
    engine.removeAllListeners();
    for (const participant of this.remoteParticipants.values()) {
      participant.destroy();
      this.emit('participantDisconnected', participant);
    }
    this.remoteParticipants.clear();
    this.activeSpeakers = [];
    this.pendingTracks = [];
    this.earlyParticipantUpdates = [];
    engine.signal.removeAllListeners();
    await engine.disconnect();
  }

  /** Disconnect, including during the initial join or an automatic full restart. */
  async disconnect(): Promise<void> {
    if (!this.session && !this._isConnected) return;
    const session = this.session;
    this.session = undefined;
    this._isConnected = false;
    session?.controller.abort(new SessionEnded('client_initiated'));
    await this.releaseEngine(this.engine);
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

  private handleJoinResponse(join: JoinResponse, restoring = false): void {
    // Room info
    if (join.room) {
      this.roomInfo = join.room;
      this.name = join.room.name;
      this.sid = join.room.sid;
      this.metadata = join.room.metadata;
    }

    // Local participant
    if (join.participant && restoring) this.localParticipant.updateInfo(join.participant);
    if (join.participant && !restoring) {
      this.localParticipant = new LocalParticipant(
        this.engine,
        join.participant.sid,
        join.participant.identity,
        join.participant.name,
        join.participant.metadata,
      );
      this.localParticipant.permissions = join.participant.permission;
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
    this.engine.on('disconnected', (reason, transportFailure) => {
      if (!this._isConnected) return;
      const session = this.session;
      if (transportFailure && session && session.urls.length > 1) {
        void this.recover(session, reason);
        return;
      }
      this._isConnected = false;
      this.session = undefined;
      void this.releaseEngine(this.engine);
      this.emit('disconnected', reason);
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
    // Participant updates (join, leave, track changes). Before the join response is applied the
    // local participant is unknown, so updates are kept for connect() to replay.
    this.engine.signal.on('participantUpdate', (update) => {
      if (this.earlyParticipantUpdates) {
        this.earlyParticipantUpdates.push(update);
        return;
      }
      this.handleParticipantUpdate(update);
    });

    // Speakers changed
    this.engine.signal.on('speakersChanged', (changed) => {
      // Momentary state; the next change after the join carries the current speakers.
      if (this.earlyParticipantUpdates) return;
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
      this.updateConnectionToken(token);
    });
  }

  private handleParticipantUpdate(update: ParticipantUpdate): void {
    const me = this.localParticipant?.identity ?? '?';
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
          log.info(`[${me}] Participant disconnected: ${participant.identity}`);
          this.emit('participantDisconnected', participant);
        }
      } else {
        // Participant joined or updated
        const { participant, isNew } = this.getOrCreateParticipant(info);

        if (isNew) {
          log.info(`[${me}] Participant connected: ${participant.identity}`);
          this.emit('participantConnected', participant);
        }
      }
    }

    // Try to match any pending tracks that arrived before participant info
    if (this.pendingTracks.length > 0) {
      this.flushPendingTracks();
    }
  }

  /** Participant updates received during connect(), before the join response was applied */
  private earlyParticipantUpdates: ParticipantUpdate[] | null = [];

  /** Pending tracks waiting for participant/publication info to arrive */
  private pendingTracks: Array<{ mediaTrack: any; participantSid: string; trackSid: string }> = [];

  private handleRemoteTrack(mediaTrack: any, transceiver: any): void {
    const mediaKind = mediaTrack?.kind;
    const me = this.localParticipant?.identity ?? '?';

    // Only handle audio tracks (video not supported in this SDK)
    if (mediaKind !== 'audio') {
      log.debug(`[${me}] Skipping ${mediaKind} track (audio-only SDK)`);
      return;
    }

    // SFU packs "participantSid|trackSid" into the msid stream ID
    // (same as Go SDK's track.StreamID() — see room.go unpackStreamID)
    const streamId = transceiver.receiver?.remoteStreamId ?? '';
    const { participantSid, trackSid } = unpackStreamId(streamId);

    log.debug(`[${me}] handleRemoteTrack: streamId="${streamId}", participantSid="${participantSid}", trackSid="${trackSid}"`);

    if (!participantSid || !trackSid) {
      log.warn(`[${me}] Cannot match track: missing IDs in streamId "${streamId}"`);
      return;
    }

    if (!this.matchTrackToParticipant(mediaTrack, participantSid, trackSid)) {
      log.debug(`[${me}] Queuing unmatched track (participantSid=${participantSid}, trackSid=${trackSid})`);
      this.pendingTracks.push({ mediaTrack, participantSid, trackSid });
    }
  }

  /**
   * Match a media track to the correct participant and publication using
   * the SFU-provided participant SID and track SID. No heuristics needed.
   */
  private matchTrackToParticipant(mediaTrack: any, participantSid: string, trackSid: string): boolean {
    const me = this.localParticipant?.identity ?? '?';

    const participant = this.remoteParticipants.get(participantSid);
    if (!participant) return false;

    const pub = participant.trackPublications.get(trackSid);
    if (!pub) return false;

    if (pub.track) {
      participant.removeTrack(trackSid);
    }

    log.info(`[${me}] Track matched: ${participant.identity}/${pub.name} (trackSid=${trackSid})`);
    participant.addSubscribedTrack(mediaTrack, trackSid, pub.name);
    return true;
  }

  /** Try to match any pending tracks after participant updates arrive */
  private flushPendingTracks(): void {
    const remaining: typeof this.pendingTracks = [];
    for (const pending of this.pendingTracks) {
      if (!this.matchTrackToParticipant(pending.mediaTrack, pending.participantSid, pending.trackSid)) {
        remaining.push(pending);
      }
    }
    if (this.pendingTracks.length !== remaining.length) {
      log.debug(`Matched ${this.pendingTracks.length - remaining.length} pending tracks`);
    }
    this.pendingTracks = remaining;
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

  private getOrCreateParticipant(info: ParticipantInfo): { participant: RemoteParticipant; isNew: boolean } {
    let participant = this.remoteParticipants.get(info.sid);
    if (participant) {
      participant.updateInfo(info);
      return { participant, isNew: false };
    }

    // SID not found — check if same identity exists under an old SID
    for (const [oldSid, existing] of this.remoteParticipants) {
      if (existing.identity === info.identity) {
        // Re-index under the new SID
        this.remoteParticipants.delete(oldSid);
        existing.updateInfo(info);
        this.remoteParticipants.set(info.sid, existing);
        return { participant: existing, isNew: false };
      }
    }

    // Truly new participant
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
    return { participant, isNew: true };
  }
}
