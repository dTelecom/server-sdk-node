/**
 * Participant classes — LocalParticipant and RemoteParticipant.
 *
 * Manages participant state, track publications, and data messaging.
 */

import { TypedEmitter } from './utils/events';
import { createLogger } from './utils/logger';
import { RTCEngine } from './engine';
import {
  LocalAudioTrack,
  RemoteAudioTrack,
  TrackPublication,
  LocalTrackPublication,
  RemoteTrackPublication,
  TrackPublishOptions,
} from './track';
import {
  ParticipantInfo,
  ParticipantInfo_State,
  TrackInfo,
  TrackType,
  TrackSource,
  DataPacket,
  DataPacket_Kind,
  UserPacket,
} from './proto/models';
import { TrackPublishedResponse } from './proto/signal';
import { MediaStreamTrack } from 'werift';

const log = createLogger('Participant');

// ─── Base Participant ───────────────────────────────────────────────────────

export interface ParticipantEvents {
  [key: string]: (...args: any[]) => void;
  trackPublished: (publication: TrackPublication) => void;
  trackUnpublished: (publication: TrackPublication) => void;
  metadataChanged: (metadata: string) => void;
}

export abstract class Participant extends TypedEmitter<ParticipantEvents> {
  sid: string;
  identity: string;
  name: string;
  metadata: string;
  state: ParticipantInfo_State;

  protected _trackPublications = new Map<string, TrackPublication>();

  constructor(sid: string, identity: string, name: string = '', metadata: string = '') {
    super();
    this.sid = sid;
    this.identity = identity;
    this.name = name;
    this.metadata = metadata;
    this.state = ParticipantInfo_State.JOINING;
  }

  get trackPublications(): Map<string, TrackPublication> {
    return this._trackPublications;
  }

  /** Update participant info from server */
  updateInfo(info: ParticipantInfo): void {
    const metadataChanged = this.metadata !== info.metadata;
    this.sid = info.sid;
    this.identity = info.identity;
    this.name = info.name;
    this.metadata = info.metadata;
    this.state = info.state;

    if (metadataChanged) {
      this.emit('metadataChanged', info.metadata);
    }
  }
}

// ─── Local Participant ──────────────────────────────────────────────────────

export interface DataPublishOptions {
  /** Data packet kind (default: RELIABLE) */
  kind?: DataPacket_Kind;
  /** Destination participant SIDs (empty = broadcast to all) */
  destinationSids?: string[];
  /** Topic for the data message */
  topic?: string;
}

export class LocalParticipant extends Participant {
  private engine: RTCEngine;
  private publishedTracks = new Map<string, LocalAudioTrack>();

  constructor(engine: RTCEngine, sid: string, identity: string, name: string = '', metadata: string = '') {
    super(sid, identity, name, metadata);
    this.engine = engine;
  }

  /**
   * Publish an audio track to the room.
   *
   * Flow:
   * 1. Send AddTrackRequest to server
   * 2. Wait for TrackPublishedResponse (server assigns SID)
   * 3. Add transceiver to publisher PeerConnection
   * 4. Negotiate SDP
   */
  async publishTrack(track: LocalAudioTrack, options?: TrackPublishOptions): Promise<LocalTrackPublication> {
    const name = options?.name ?? track.name;
    const source = options?.source ?? TrackSource.MICROPHONE;
    const disableDtx = options?.disableDtx ?? false;

    log.info(`Publishing track "${name}" (cid=${track.cid})`);

    // Step 1: Request track publication from server
    const response = await this.engine.requestPublishTrack(
      track.cid,
      name,
      TrackType.AUDIO,
      source,
      { disableDtx },
    );

    if (!response.track) {
      throw new Error('Server did not return track info');
    }

    // Step 2: Set server-assigned SID
    track.sid = response.track.sid;
    log.debug(`Track published: cid=${track.cid}, sid=${track.sid}`);

    // Step 3: Add transceiver to publisher PC with the media track
    const transceiver = await this.engine.addTransceiver(track.mediaTrack);

    // Step 4: Negotiate (waits for SDP answer)
    await this.engine.negotiate();

    // Step 5: Wait for publisher ICE+DTLS to connect before wiring audio
    await this.engine.waitForPublisherConnected();

    // Step 6: Wire audio source to transceiver (only after media path is ready)
    track.setTransceiver(transceiver);

    // Create publication
    const publication = new LocalTrackPublication(response.track, track);
    this._trackPublications.set(response.track.sid, publication);
    this.publishedTracks.set(track.cid, track);

    this.emit('trackPublished', publication);
    return publication;
  }

  /**
   * Unpublish an audio track from the room.
   */
  async unpublishTrack(track: LocalAudioTrack): Promise<void> {
    log.info(`Unpublishing track "${track.name}" (sid=${track.sid})`);

    track.stop();
    this._trackPublications.delete(track.sid);
    this.publishedTracks.delete(track.cid);

    // Re-negotiate to remove the track
    await this.engine.negotiate();

    this.emit('trackUnpublished', new TrackPublication({
      sid: track.sid,
      name: track.name,
      type: TrackType.AUDIO,
      source: TrackSource.MICROPHONE,
      muted: false,
      width: 0,
      height: 0,
      simulcast: false,
      disableDtx: false,
      layers: [],
      mimeType: 'audio/opus',
      mid: '',
    }));
  }

  /**
   * Publish data to the room.
   *
   * @param data The data payload
   * @param options Delivery options (kind, destinations, topic)
   */
  async publishData(data: Uint8Array, options: DataPublishOptions = {}): Promise<void> {
    const kind = options.kind ?? DataPacket_Kind.RELIABLE;
    const destinationSids = options.destinationSids ?? [];
    const topic = options.topic;

    const packet: DataPacket = {
      kind,
      user: {
        participantSid: this.sid,
        payload: data,
        destinationSids,
        topic,
      },
    };

    const encoded = DataPacket.encode(packet).finish();
    const channelKind = kind === DataPacket_Kind.RELIABLE ? 'reliable' : 'lossy';
    this.engine.sendData(new Uint8Array(encoded), channelKind);
  }
}

// ─── Remote Participant ─────────────────────────────────────────────────────

export interface RemoteParticipantEvents {
  [key: string]: (...args: any[]) => void;
  trackPublished: (publication: TrackPublication) => void;
  trackUnpublished: (publication: TrackPublication) => void;
  metadataChanged: (metadata: string) => void;
  trackSubscribed: (track: RemoteAudioTrack, publication: RemoteTrackPublication) => void;
  trackUnsubscribed: (track: RemoteAudioTrack, publication: RemoteTrackPublication) => void;
}

export class RemoteParticipant extends TypedEmitter<RemoteParticipantEvents> {
  sid: string;
  identity: string;
  name: string;
  metadata: string;
  state: ParticipantInfo_State;

  private _trackPublications = new Map<string, RemoteTrackPublication>();
  private _audioTracks = new Map<string, RemoteAudioTrack>();

  constructor(info: ParticipantInfo) {
    super();
    this.sid = info.sid;
    this.identity = info.identity;
    this.name = info.name;
    this.metadata = info.metadata;
    this.state = info.state;

    // Initialize track publications from info
    for (const trackInfo of info.tracks) {
      const pub = new RemoteTrackPublication(trackInfo);
      this._trackPublications.set(trackInfo.sid, pub);
    }
  }

  get trackPublications(): Map<string, RemoteTrackPublication> {
    return this._trackPublications;
  }

  get audioTracks(): Map<string, RemoteAudioTrack> {
    return this._audioTracks;
  }

  /** Update participant info from server */
  updateInfo(info: ParticipantInfo): void {
    const metadataChanged = this.metadata !== info.metadata;
    this.sid = info.sid;
    this.identity = info.identity;
    this.name = info.name;
    this.metadata = info.metadata;
    this.state = info.state;

    // Update existing publications and add new ones
    const activeSids = new Set<string>();
    for (const trackInfo of info.tracks) {
      activeSids.add(trackInfo.sid);
      const existing = this._trackPublications.get(trackInfo.sid);
      if (existing) {
        existing.updateInfo(trackInfo);
      } else {
        const pub = new RemoteTrackPublication(trackInfo);
        this._trackPublications.set(trackInfo.sid, pub);
        this.emit('trackPublished', pub);
      }
    }

    // Remove publications that are no longer in the list
    for (const [sid, pub] of this._trackPublications) {
      if (!activeSids.has(sid)) {
        this._trackPublications.delete(sid);
        if (pub.track) {
          this.removeTrack(sid);
        }
        this.emit('trackUnpublished', pub);
      }
    }

    if (metadataChanged) {
      this.emit('metadataChanged', info.metadata);
    }
  }

  /**
   * Called when a remote media track is received on the subscriber PC.
   * Associates the media track with the correct publication.
   */
  addSubscribedTrack(
    mediaTrack: MediaStreamTrack,
    trackSid: string,
    trackName: string,
  ): RemoteAudioTrack | null {
    const publication = this._trackPublications.get(trackSid);
    if (!publication) {
      log.warn(`No publication found for track ${trackSid}`);
      // Create a temporary publication
      const tempPub = new RemoteTrackPublication({
        sid: trackSid,
        name: trackName,
        type: TrackType.AUDIO,
        source: TrackSource.MICROPHONE,
        muted: false,
        width: 0,
        height: 0,
        simulcast: false,
        disableDtx: false,
        layers: [],
        mimeType: 'audio/opus',
        mid: '',
      });
      this._trackPublications.set(trackSid, tempPub);
    }

    const pub = this._trackPublications.get(trackSid)!;
    const remoteTrack = new RemoteAudioTrack(trackSid, pub.name, mediaTrack);
    pub.setTrack(remoteTrack);
    this._audioTracks.set(trackSid, remoteTrack);

    log.debug(`Track subscribed: ${pub.name} (${trackSid}) from ${this.identity}`);
    this.emit('trackSubscribed', remoteTrack, pub);

    return remoteTrack;
  }

  /** Remove a subscribed track */
  removeTrack(trackSid: string): RemoteAudioTrack | null {
    const track = this._audioTracks.get(trackSid);
    if (!track) return null;

    track.stop();
    this._audioTracks.delete(trackSid);

    const pub = this._trackPublications.get(trackSid);
    if (pub) {
      pub.setTrack(null);
      this.emit('trackUnsubscribed', track, pub);
    }

    return track;
  }

  /** Clean up all tracks */
  destroy(): void {
    for (const [sid] of this._audioTracks) {
      this.removeTrack(sid);
    }
    this._trackPublications.clear();
  }
}
