/**
 * Track classes — LocalAudioTrack, RemoteAudioTrack, TrackPublication.
 *
 * Tracks represent individual media streams within a room.
 */

import { MediaStreamTrack, RTCRtpTransceiver, RtpPacket, RtpHeader } from 'werift';
import { TypedEmitter } from './utils/events';
import { createLogger } from './utils/logger';
import { AudioSource } from './audio/audio-source';
import { AudioStream } from './audio/audio-stream';
import { TrackInfo, TrackType, TrackSource } from './proto/models';
import { OpusRtpPacketizer, OPUS_PAYLOAD_TYPE } from './audio/rtp-opus';

const log = createLogger('Track');

// ─── Track Publication ──────────────────────────────────────────────────────

export interface TrackPublicationEvents {
  [key: string]: (...args: any[]) => void;
  muted: () => void;
  unmuted: () => void;
}

export class TrackPublication extends TypedEmitter<TrackPublicationEvents> {
  sid: string;
  name: string;
  kind: TrackType;
  source: TrackSource;
  mimeType: string;
  muted: boolean;
  /** Media ID assigned by SFU — used to match WebRTC transceivers to publications */
  mid: string;

  constructor(info: TrackInfo) {
    super();
    this.sid = info.sid;
    this.name = info.name;
    this.kind = info.type;
    this.source = info.source;
    this.mimeType = info.mimeType;
    this.muted = info.muted;
    this.mid = info.mid;
  }

  updateInfo(info: TrackInfo): void {
    const wasMuted = this.muted;
    this.sid = info.sid;
    this.name = info.name;
    this.kind = info.type;
    this.source = info.source;
    this.mimeType = info.mimeType;
    this.muted = info.muted;
    this.mid = info.mid;

    if (wasMuted !== info.muted) {
      this.emit(info.muted ? 'muted' : 'unmuted');
    }
  }
}

export class LocalTrackPublication extends TrackPublication {
  track: LocalAudioTrack;

  constructor(info: TrackInfo, track: LocalAudioTrack) {
    super(info);
    this.track = track;
  }
}

export class RemoteTrackPublication extends TrackPublication {
  track: RemoteAudioTrack | null = null;

  setTrack(track: RemoteAudioTrack | null): void {
    this.track = track;
  }
}

// ─── Local Audio Track ──────────────────────────────────────────────────────

export interface TrackPublishOptions {
  /** Track name (default: auto-generated) */
  name?: string;
  /** Audio source type (default: MICROPHONE) */
  source?: TrackSource;
  /** Disable DTX (Discontinuous Transmission) */
  disableDtx?: boolean;
}

export class LocalAudioTrack {
  readonly name: string;
  readonly source: AudioSource;
  /** werift MediaStreamTrack used by the PeerConnection sender */
  readonly mediaTrack: MediaStreamTrack;
  private transceiver: RTCRtpTransceiver | null = null;
  private packetizer: OpusRtpPacketizer;
  private _cid: string;
  private _sid: string = '';

  private constructor(name: string, source: AudioSource) {
    this.name = name;
    this.source = source;
    this.mediaTrack = new MediaStreamTrack({ kind: 'audio' });
    this.packetizer = new OpusRtpPacketizer(0, OPUS_PAYLOAD_TYPE);
    this._cid = `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Create a local audio track from an AudioSource */
  static createAudioTrack(name: string, source: AudioSource): LocalAudioTrack {
    return new LocalAudioTrack(name, source);
  }

  /** Client-generated track ID (used before server assigns SID) */
  get cid(): string {
    return this._cid;
  }

  /** Server-assigned track SID */
  get sid(): string {
    return this._sid;
  }

  set sid(value: string) {
    this._sid = value;
  }

  /**
   * Set the RTP transceiver for sending audio.
   * Called internally by LocalParticipant after negotiation.
   */
  setTransceiver(transceiver: RTCRtpTransceiver): void {
    this.transceiver = transceiver;

    const sender = transceiver.sender as any;
    const dtlsState = sender?.dtlsTransport?.state;
    log.info(`setTransceiver: mid=${transceiver.mid}, codec=${sender?.codec?.name}, dtls=${dtlsState}`);

    // Wire up AudioSource → RTP, but only start sending once DTLS is connected
    const wireAudio = () => {
      let rtpWriteCount = 0;
      log.info(`Audio wired: dtls=${sender?.dtlsTransport?.state}, codec=${sender?.codec?.name}`);

      this.source.onEncodedFrame = (opusData: Buffer) => {
        if (this.mediaTrack.stopped) return;

        try {
          const info = this.packetizer.nextPacketInfo();
          const header = new RtpHeader();
          header.payloadType = OPUS_PAYLOAD_TYPE;
          header.sequenceNumber = info.sequenceNumber;
          header.timestamp = info.timestamp;
          header.ssrc = info.ssrc;
          header.marker = false;

          const packet = new RtpPacket(header, opusData);
          this.mediaTrack.writeRtp(packet);
          rtpWriteCount++;
          if (rtpWriteCount === 1) {
            log.info(`First RTP sent: dtls=${sender?.dtlsTransport?.state}`);
          }
        } catch (err) {
          log.error('Failed to send RTP via track', err);
        }
      };
    };

    if (dtlsState === 'connected') {
      wireAudio();
    } else {
      // Wait for DTLS to connect before sending any audio
      const dtls = sender?.dtlsTransport;
      if (dtls?.onStateChange) {
        const { unSubscribe } = dtls.onStateChange.subscribe((state: string) => {
          if (state === 'connected') {
            unSubscribe();
            wireAudio();
          }
        });
      } else {
        // Fallback: wire immediately if we can't subscribe to DTLS events
        log.warn('Cannot subscribe to DTLS state changes, wiring audio immediately');
        wireAudio();
      }
    }
  }

  /** Stop the track and release resources */
  stop(): void {
    this.source.flush();
    this.source.destroy();
    this.mediaTrack.stop();
    this.transceiver = null;
  }
}

// ─── Remote Audio Track ─────────────────────────────────────────────────────

export interface RemoteAudioTrackEvents {
  [key: string]: (...args: any[]) => void;
  audioFrame: () => void;
  ended: () => void;
}

export class RemoteAudioTrack extends TypedEmitter<RemoteAudioTrackEvents> {
  readonly sid: string;
  readonly name: string;
  readonly mediaTrack: MediaStreamTrack;
  private _streams: AudioStream[] = [];

  constructor(sid: string, name: string, mediaTrack: MediaStreamTrack) {
    super();
    this.sid = sid;
    this.name = name;
    this.mediaTrack = mediaTrack;
  }

  /**
   * Create an AudioStream to consume decoded PCM16 frames from this track.
   * @param sampleRate Desired output sample rate (default: 16000 for STT)
   * @param channels Desired channels (default: 1)
   */
  createStream(sampleRate: number = 16000, channels: number = 1): AudioStream {
    const stream = new AudioStream(this.mediaTrack, sampleRate, channels);
    this._streams.push(stream);
    return stream;
  }

  /** Close all streams and release resources */
  stop(): void {
    for (const stream of this._streams) {
      stream.close();
    }
    this._streams = [];
    this.emit('ended');
  }
}
