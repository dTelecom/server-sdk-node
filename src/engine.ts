/**
 * RTCEngine — manages dual PeerConnections (publisher + subscriber)
 * for communication with the dTelecom SFU.
 *
 * Publisher PC: sends local audio + data channels
 * Subscriber PC: receives remote audio + data channels
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCDataChannel,
  MediaStreamTrack,
  RTCRtpTransceiver,
} from 'werift';
import { TypedEmitter } from './utils/events';
import { createLogger } from './utils/logger';
import { SignalClient } from './signal';
import {
  SignalTarget,
  SessionDescription,
  JoinResponse,
  TrackPublishedResponse,
  AddTrackRequest,
} from './proto/signal';
import { TrackType, TrackSource, ICEServer } from './proto/models';

const log = createLogger('RTCEngine');

export interface EngineEvents {
  [key: string]: (...args: any[]) => void;
  connected: () => void;
  disconnected: (reason?: string) => void;
  remoteTrack: (track: MediaStreamTrack, transceiver: RTCRtpTransceiver) => void;
  dataMessage: (data: Uint8Array, kind: 'reliable' | 'lossy') => void;
  dataChannelReady: () => void;
  trackPublished: (response: TrackPublishedResponse) => void;
  subscriberOffer: (sd: SessionDescription) => void;
}

export interface EngineOptions {
  connectTimeout?: number;
  autoSubscribe?: boolean;
}

export class RTCEngine extends TypedEmitter<EngineEvents> {
  readonly signal: SignalClient;

  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;

  private reliableChannel: RTCDataChannel | null = null;
  private lossyChannel: RTCDataChannel | null = null;
  private subscriberReliableChannel: RTCDataChannel | null = null;
  private subscriberLossyChannel: RTCDataChannel | null = null;

  private subscriberPrimary = true;
  private _isConnected = false;
  private pendingCandidates: { candidate: RTCIceCandidate; target: SignalTarget }[] = [];
  private joinResponse: JoinResponse | null = null;

  private publishWaiters: Map<string, (response: TrackPublishedResponse) => void> = new Map();
  private _negotiateResolve: (() => void) | null = null;
  private _publisherConnectedResolve: (() => void) | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  get publisherPC(): RTCPeerConnection | null {
    return this.publisher;
  }

  get subscriberPC(): RTCPeerConnection | null {
    return this.subscriber;
  }

  get reliableDataChannel(): RTCDataChannel | null {
    return this.reliableChannel;
  }

  get lossyDataChannel(): RTCDataChannel | null {
    return this.lossyChannel;
  }

  constructor() {
    super();
    this.signal = new SignalClient();
  }

  async connect(url: string, token: string, options: EngineOptions = {}): Promise<JoinResponse> {
    const joinResponse = await this.signal.connect(url, token, {
      autoSubscribe: options.autoSubscribe ?? true,
      connectTimeout: options.connectTimeout ?? 10000,
    });
    this.joinResponse = joinResponse;
    this.subscriberPrimary = joinResponse.subscriberPrimary;

    log.info(`Joined room "${joinResponse.room?.name}", subscriber_primary=${this.subscriberPrimary}`);
    log.debug(`ICE servers: ${joinResponse.iceServers.length}, participants: ${joinResponse.otherParticipants.length}`);

    const iceServers = this.buildIceServers(joinResponse.iceServers);
    this.createPublisher(iceServers);
    this.createSubscriber(iceServers);
    this.setupSignalHandlers();
    this.createDataChannels();

    if (!this.subscriberPrimary) {
      await this.negotiate();
    }

    return joinResponse;
  }

  async addTransceiver(track: MediaStreamTrack): Promise<RTCRtpTransceiver> {
    if (!this.publisher) {
      throw new Error('Publisher PC not initialized');
    }
    const transceiver = this.publisher.addTransceiver(track, { direction: 'sendonly' });
    return transceiver;
  }

  async requestPublishTrack(
    cid: string,
    name: string,
    type: TrackType,
    source: TrackSource,
    options?: { disableDtx?: boolean; muted?: boolean },
  ): Promise<TrackPublishedResponse> {
    const request: AddTrackRequest = {
      cid,
      name,
      type,
      source,
      width: 0,
      height: 0,
      muted: options?.muted ?? false,
      disableDtx: options?.disableDtx ?? false,
      layers: [],
      sid: '',
    };

    return new Promise<TrackPublishedResponse>((resolve) => {
      this.publishWaiters.set(cid, resolve);
      this.signal.sendAddTrack(request);
    });
  }

  async negotiate(): Promise<void> {
    if (!this.publisher) {
      throw new Error('Publisher PC not initialized');
    }

    log.debug(`Publisher signaling state before negotiate: ${this.publisher.signalingState}`);
    const offer = await this.publisher.createOffer();
    await this.publisher.setLocalDescription(offer);

    // Create a promise that resolves when the answer is applied
    const answerPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for publisher answer'));
      }, 10000);
      this._negotiateResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    log.debug('Sending publisher offer');
    this.signal.sendOffer({
      type: offer.type,
      sdp: offer.sdp,
    });

    // Wait for the answer to be set on the publisher PC
    await answerPromise;
    log.debug('Negotiate complete (answer applied)');
  }

  /** Wait for publisher ICE to reach connected state (DTLS+SRTP ready). */
  async waitForPublisherConnected(timeoutMs: number = 10000): Promise<void> {
    if (!this.publisher) throw new Error('Publisher PC not initialized');

    const iceState = this.publisher.iceConnectionState;
    if (iceState === 'connected' || iceState === 'completed') {
      return; // Already connected
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Publisher ICE timed out (state: ${this.publisher?.iceConnectionState})`));
      }, timeoutMs);
      this._publisherConnectedResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  sendData(data: Uint8Array, kind: 'reliable' | 'lossy'): void {
    const channel = kind === 'reliable' ? this.reliableChannel : this.lossyChannel;
    if (!channel || channel.readyState !== 'open') {
      log.warn(`Data channel ${kind} not open`);
      return;
    }
    channel.send(Buffer.from(data));
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;

    try {
      this.signal.sendLeave();
    } catch {
      // ignore
    }

    this.reliableChannel?.close();
    this.lossyChannel?.close();
    this.publisher?.close();
    this.subscriber?.close();
    this.signal.close();

    this.publisher = null;
    this.subscriber = null;
    this.reliableChannel = null;
    this.lossyChannel = null;
    this.subscriberReliableChannel = null;
    this.subscriberLossyChannel = null;
    this.publishWaiters.clear();

    log.info('Disconnected');
    this.emit('disconnected', 'client_initiated');
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private buildIceServers(servers: ICEServer[]): { urls: string; username?: string; credential?: string }[] {
    const result: { urls: string; username?: string; credential?: string }[] = [];
    for (const s of servers) {
      for (const url of s.urls) {
        result.push({
          urls: url,
          username: s.username || undefined,
          credential: s.credential || undefined,
        });
      }
    }
    return result;
  }

  private createPublisher(iceServers: { urls: string; username?: string; credential?: string }[]): void {
    this.publisher = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
    });

    this.publisher.onIceCandidate.subscribe((candidate) => {
      if (candidate) {
        const init = JSON.stringify(candidate.toJSON());
        this.signal.sendIceCandidate(init, SignalTarget.PUBLISHER);
      }
    });

    this.publisher.iceConnectionStateChange.subscribe((state) => {
      log.debug(`Publisher ICE state: ${state}`);
      if (state === 'connected' || state === 'completed') {
        if (this._publisherConnectedResolve) {
          this._publisherConnectedResolve();
          this._publisherConnectedResolve = null;
        }
      }
    });

    log.debug('Publisher PC created');
  }

  private createSubscriber(iceServers: { urls: string; username?: string; credential?: string }[]): void {
    this.subscriber = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
    });

    this.subscriber.onIceCandidate.subscribe((candidate) => {
      if (candidate) {
        const init = JSON.stringify(candidate.toJSON());
        this.signal.sendIceCandidate(init, SignalTarget.SUBSCRIBER);
      }
    });

    // Remote track received on subscriber (fires after negotiation with actual track)
    this.subscriber.on('track', (event: any) => {
      const track = event.track as MediaStreamTrack;
      const transceiver = event.transceiver as RTCRtpTransceiver;
      log.debug(`Subscriber received track: mid=${transceiver?.mid}, kind=${track?.kind}`);
      if (track) {
        this.emit('remoteTrack', track, transceiver);
      }
    });

    // Data channels on subscriber (server creates them)
    this.subscriber.onDataChannel.subscribe((channel) => {
      log.debug(`Subscriber data channel: "${channel.label}"`);
      if (channel.label === '_reliable') {
        this.subscriberReliableChannel = channel;
        this.setupSubscriberDataChannel(channel, 'reliable');
      } else if (channel.label === '_lossy') {
        this.subscriberLossyChannel = channel;
        this.setupSubscriberDataChannel(channel, 'lossy');
      }
    });

    this.subscriber.iceConnectionStateChange.subscribe((state) => {
      log.debug(`Subscriber ICE state: ${state}`);
      if (state === 'connected') {
        if (!this._isConnected) {
          this._isConnected = true;
          this.emit('connected');
        }
      } else if (state === 'disconnected' || state === 'failed') {
        this._isConnected = false;
        this.emit('disconnected', `ICE ${state}`);
      }
    });

    log.debug('Subscriber PC created');
  }

  private createDataChannels(): void {
    if (!this.publisher) return;

    this.reliableChannel = this.publisher.createDataChannel('_reliable', {
      ordered: true,
    });

    this.lossyChannel = this.publisher.createDataChannel('_lossy', {
      ordered: true,
      maxRetransmits: 1,
    });

    let readyCount = 0;
    const checkReady = () => {
      readyCount++;
      if (readyCount >= 2) {
        log.debug('Publisher data channels ready');
        this.emit('dataChannelReady');
      }
    };

    this.reliableChannel.stateChanged.subscribe((state) => {
      if (state === 'open') {
        log.debug('Reliable data channel opened');
        checkReady();
      }
    });

    this.lossyChannel.stateChanged.subscribe((state) => {
      if (state === 'open') {
        log.debug('Lossy data channel opened');
        checkReady();
      }
    });

    log.debug('Data channels created on publisher');
  }

  private setupSubscriberDataChannel(channel: RTCDataChannel, kind: 'reliable' | 'lossy'): void {
    channel.onMessage.subscribe((event) => {
      let data: Uint8Array;
      if (event instanceof Buffer) {
        data = new Uint8Array(event);
      } else if (typeof event === 'string') {
        data = new TextEncoder().encode(event);
      } else {
        data = new Uint8Array(event as any);
      }
      this.emit('dataMessage', data, kind);
    });
  }

  private setupSignalHandlers(): void {
    this.signal.on('offer', async (sd) => {
      if (!this.subscriber) return;

      try {
        await this.subscriber.setRemoteDescription(
          new RTCSessionDescription(sd.sdp, sd.type as 'offer'),
        );

        const answer = await this.subscriber.createAnswer();
        await this.subscriber.setLocalDescription(answer);

        this.signal.sendAnswer({
          type: answer.type,
          sdp: answer.sdp,
        });
        log.debug('Sent subscriber answer');
      } catch (err) {
        log.error('Failed to handle subscriber offer', err);
      }
    });

    this.signal.on('answer', async (sd) => {
      if (!this.publisher) return;

      try {
        await this.publisher.setRemoteDescription(
          new RTCSessionDescription(sd.sdp, sd.type as 'answer'),
        );
        log.debug('Set publisher remote description');

        this.flushPendingCandidates(SignalTarget.PUBLISHER);

        // Resolve negotiate() promise
        if (this._negotiateResolve) {
          this._negotiateResolve();
          this._negotiateResolve = null;
        }
      } catch (err) {
        log.error('Failed to handle publisher answer', err);
      }
    });

    this.signal.on('trickle', async (trickle) => {
      try {
        const candidateInit = JSON.parse(trickle.candidateInit);
        const candidate = new RTCIceCandidate(candidateInit);
        const pc = trickle.target === SignalTarget.PUBLISHER ? this.publisher : this.subscriber;

        if (!pc) return;

        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          this.pendingCandidates.push({ candidate, target: trickle.target });
        }
      } catch (err) {
        log.error('Failed to add ICE candidate', err);
      }
    });

    this.signal.on('trackPublished', (response) => {
      const waiter = this.publishWaiters.get(response.cid);
      if (waiter) {
        this.publishWaiters.delete(response.cid);
        waiter(response);
      }
      this.emit('trackPublished', response);
    });

    this.signal.on('leave', () => {
      this.disconnect();
    });

    this.signal.on('close', (reason) => {
      if (this._isConnected) {
        this._isConnected = false;
        this.emit('disconnected', reason);
      }
    });
  }

  private flushPendingCandidates(target: SignalTarget): void {
    const pc = target === SignalTarget.PUBLISHER ? this.publisher : this.subscriber;
    if (!pc) return;

    const toFlush = this.pendingCandidates.filter((c) => c.target === target);
    this.pendingCandidates = this.pendingCandidates.filter((c) => c.target !== target);

    for (const { candidate } of toFlush) {
      pc.addIceCandidate(candidate).catch((err: any) => {
        log.error('Failed to flush ICE candidate', err);
      });
    }
  }
}
