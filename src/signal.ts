/**
 * SignalClient — WebSocket connection to dTelecom SFU.
 *
 * Handles binary protobuf signaling: SignalRequest (client→server)
 * and SignalResponse (server→client).
 */

import WebSocket from 'ws';
import { TypedEmitter } from './utils/events';
import { createLogger } from './utils/logger';
import {
  SignalRequest,
  SignalResponse,
  SignalTarget,
  JoinResponse,
  SessionDescription,
  TrickleRequest,
  AddTrackRequest,
  MuteTrackRequest,
  UpdateSubscription,
  LeaveRequest,
  TrackPublishedResponse,
  ParticipantUpdate,
  SpeakersChanged,
  RoomUpdate,
  ConnectionQualityUpdate,
  StreamStateUpdate,
  TrackUnpublishedResponse,
} from './proto/signal';
import { DisconnectReason } from './proto/models';

const log = createLogger('SignalClient');

const PROTOCOL_VERSION = 8;
const SDK_NAME = 'node';
const SDK_VERSION = '0.1.0';

export interface SignalOptions {
  /** Auto-subscribe to all tracks (default: true) */
  autoSubscribe?: boolean;
  /** WebSocket connection timeout in ms (default: 10000) */
  connectTimeout?: number;
}

export interface SignalEvents {
  [key: string]: (...args: any[]) => void;
  join: (response: JoinResponse) => void;
  offer: (sd: SessionDescription) => void;
  answer: (sd: SessionDescription) => void;
  trickle: (request: TrickleRequest) => void;
  participantUpdate: (update: ParticipantUpdate) => void;
  trackPublished: (response: TrackPublishedResponse) => void;
  trackUnpublished: (response: TrackUnpublishedResponse) => void;
  speakersChanged: (update: SpeakersChanged) => void;
  roomUpdate: (update: RoomUpdate) => void;
  connectionQuality: (update: ConnectionQualityUpdate) => void;
  streamStateUpdate: (update: StreamStateUpdate) => void;
  leave: (request: LeaveRequest) => void;
  tokenRefresh: (token: string) => void;
  close: (reason: string) => void;
  error: (error: Error) => void;
}

export class SignalClient extends TypedEmitter<SignalEvents> {
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private _isConnected = false;
  private joinResponse: JoinResponse | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to the dTelecom SFU signaling server.
   * Returns JoinResponse on successful connection.
   */
  async connect(url: string, token: string, options: SignalOptions = {}): Promise<JoinResponse> {
    const autoSubscribe = options.autoSubscribe ?? true;
    const connectTimeout = options.connectTimeout ?? 10000;

    // Build WebSocket URL
    const wsUrl = this.buildUrl(url, token, autoSubscribe);
    log.info(`Connecting to ${wsUrl.replace(/access_token=[^&]+/, 'access_token=***')}`);

    return new Promise<JoinResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error(`Signal connection timed out after ${connectTimeout}ms`));
      }, connectTimeout);

      try {
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        this.ws.binaryType = 'arraybuffer';
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      this.ws.on('open', () => {
        log.debug('WebSocket connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const bytes = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data as Buffer);

          const response = SignalResponse.decode(bytes);
          this.handleResponse(response);

          // First message should be JoinResponse
          if (response.join) {
            clearTimeout(timeout);
            this.joinResponse = response.join;
            this._isConnected = true;

            // Set up ping if configured
            if (response.join.pingInterval > 0) {
              this.startPing(response.join.pingInterval);
            }

            resolve(response.join);
          }
        } catch (err) {
          log.error('Failed to decode signal response', err);
        }
      });

      this.ws.on('error', (err) => {
        log.error('WebSocket error', err);
        clearTimeout(timeout);
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this._isConnected = false;
        this.stopPing();
        const reasonStr = reason?.toString() || `code ${code}`;
        log.info(`WebSocket closed: ${reasonStr}`);
        this.emit('close', reasonStr);

        // If we haven't joined yet, reject
        if (!this.joinResponse) {
          reject(new Error(`WebSocket closed before join: ${reasonStr}`));
        }
      });
    });
  }

  /** Send an SDP offer (publisher → server) */
  sendOffer(sd: SessionDescription): void {
    this.sendRequest({ offer: sd });
  }

  /** Send an SDP answer (subscriber → server) */
  sendAnswer(sd: SessionDescription): void {
    this.sendRequest({ answer: sd });
  }

  /** Send an ICE candidate */
  sendIceCandidate(candidate: string, target: SignalTarget): void {
    this.sendRequest({
      trickle: { candidateInit: candidate, target },
    });
  }

  /** Request to add (publish) a track */
  sendAddTrack(request: AddTrackRequest): void {
    this.sendRequest({ addTrack: request });
  }

  /** Mute/unmute a track */
  sendMuteTrack(trackSid: string, muted: boolean): void {
    this.sendRequest({ mute: { sid: trackSid, muted } });
  }

  /** Update track subscription */
  sendSubscription(update: UpdateSubscription): void {
    this.sendRequest({ subscription: update });
  }

  /** Send leave request */
  sendLeave(): void {
    this.sendRequest({
      leave: { canReconnect: false, reason: DisconnectReason.CLIENT_INITIATED },
    });
  }

  /** Close the WebSocket connection */
  close(): void {
    this.stopPing();
    this._isConnected = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private buildUrl(url: string, token: string, autoSubscribe: boolean): string {
    // Normalize URL: ensure wss:// and /rtc path
    let wsUrl = url;
    if (wsUrl.startsWith('http://')) {
      wsUrl = wsUrl.replace('http://', 'ws://');
    } else if (wsUrl.startsWith('https://')) {
      wsUrl = wsUrl.replace('https://', 'wss://');
    } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = `wss://${wsUrl}`;
    }

    if (!wsUrl.includes('/rtc')) {
      wsUrl = wsUrl.replace(/\/?$/, '/rtc');
    }

    const params = new URLSearchParams({
      protocol: String(PROTOCOL_VERSION),
      sdk: SDK_NAME,
      version: SDK_VERSION,
      auto_subscribe: autoSubscribe ? '1' : '0',
      access_token: token,
    });

    return `${wsUrl}?${params.toString()}`;
  }

  private sendRequest(request: SignalRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send: WebSocket not open');
      return;
    }

    try {
      const bytes = SignalRequest.encode(request).finish();
      this.ws.send(bytes);
    } catch (err) {
      log.error('Failed to encode signal request', err);
    }
  }

  private handleResponse(response: SignalResponse): void {
    // join is handled in the connect() promise
    if (response.offer) {
      log.debug(`Received OFFER from server (type=${response.offer.type})`);
      this.emit('offer', response.offer);
    }
    if (response.answer) {
      log.debug(`Received ANSWER from server (type=${response.answer.type})`);
      this.emit('answer', response.answer);
    }
    if (response.trickle) {
      this.emit('trickle', response.trickle);
    }
    if (response.update) {
      this.emit('participantUpdate', response.update);
    }
    if (response.trackPublished) {
      log.debug('Track published confirmed:', response.trackPublished.cid);
      this.emit('trackPublished', response.trackPublished);
    }
    if (response.trackUnpublished) {
      this.emit('trackUnpublished', response.trackUnpublished);
    }
    if (response.speakersChanged) {
      this.emit('speakersChanged', response.speakersChanged);
    }
    if (response.roomUpdate) {
      this.emit('roomUpdate', response.roomUpdate);
    }
    if (response.connectionQuality) {
      this.emit('connectionQuality', response.connectionQuality);
    }
    if (response.streamStateUpdate) {
      this.emit('streamStateUpdate', response.streamStateUpdate);
    }
    if (response.leave) {
      log.info('Server requested leave', response.leave.reason);
      this.emit('leave', response.leave);
    }
    if (response.refreshToken) {
      this.emit('tokenRefresh', response.refreshToken);
    }
    if (response.mute) {
      // Server-initiated mute — handled via participant update
    }
    if (response.pong !== undefined) {
      // Pong received — connection alive
    }
  }

  private startPing(intervalSec: number): void {
    this.stopPing();
    const intervalMs = intervalSec * 1000;
    this.pingInterval = setInterval(() => {
      this.sendRequest({ ping: Date.now() });
    }, intervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
