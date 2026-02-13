import { describe, it, expect } from 'vitest';
import {
  SignalRequest,
  SignalResponse,
  SessionDescription,
  TrickleRequest,
  AddTrackRequest,
  MuteTrackRequest,
  LeaveRequest,
  SignalTarget,
} from '../src/proto/signal';
import { TrackType, TrackSource, DisconnectReason } from '../src/proto/models';

describe('proto signal encode/decode', () => {
  describe('SessionDescription', () => {
    it('should encode and decode', () => {
      const sd: SessionDescription = {
        type: 'offer',
        sdp: 'v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n',
      };

      const encoded = SessionDescription.encode(sd).finish();
      const decoded = SessionDescription.decode(encoded);

      expect(decoded.type).toBe('offer');
      expect(decoded.sdp).toBe(sd.sdp);
    });
  });

  describe('TrickleRequest', () => {
    it('should encode and decode', () => {
      const trickle: TrickleRequest = {
        candidateInit: '{"candidate":"candidate:1 1 UDP 2122252543 192.168.1.1 12345 typ host"}',
        target: SignalTarget.SUBSCRIBER,
      };

      const encoded = TrickleRequest.encode(trickle).finish();
      const decoded = TrickleRequest.decode(encoded);

      expect(decoded.candidateInit).toBe(trickle.candidateInit);
      expect(decoded.target).toBe(SignalTarget.SUBSCRIBER);
    });
  });

  describe('AddTrackRequest', () => {
    it('should encode and decode', () => {
      const req: AddTrackRequest = {
        cid: 'track-123',
        name: 'bot-audio',
        type: TrackType.AUDIO,
        width: 0,
        height: 0,
        muted: false,
        disableDtx: true,
        source: TrackSource.MICROPHONE,
        layers: [],
        sid: '',
      };

      const encoded = AddTrackRequest.encode(req).finish();
      const decoded = AddTrackRequest.decode(encoded);

      expect(decoded.cid).toBe('track-123');
      expect(decoded.name).toBe('bot-audio');
      expect(decoded.type).toBe(TrackType.AUDIO);
      expect(decoded.disableDtx).toBe(true);
      expect(decoded.source).toBe(TrackSource.MICROPHONE);
    });
  });

  describe('MuteTrackRequest', () => {
    it('should encode and decode', () => {
      const req: MuteTrackRequest = { sid: 'TR_abc123', muted: true };
      const encoded = MuteTrackRequest.encode(req).finish();
      const decoded = MuteTrackRequest.decode(encoded);

      expect(decoded.sid).toBe('TR_abc123');
      expect(decoded.muted).toBe(true);
    });
  });

  describe('LeaveRequest', () => {
    it('should encode and decode', () => {
      const req: LeaveRequest = {
        canReconnect: true,
        reason: DisconnectReason.CLIENT_INITIATED,
      };
      const encoded = LeaveRequest.encode(req).finish();
      const decoded = LeaveRequest.decode(encoded);

      expect(decoded.canReconnect).toBe(true);
      expect(decoded.reason).toBe(DisconnectReason.CLIENT_INITIATED);
    });
  });

  describe('SignalRequest', () => {
    it('should encode an offer request', () => {
      const request: import('../src/proto/signal').SignalRequest = {
        offer: { type: 'offer', sdp: 'v=0\r\n' },
      };

      const encoded = SignalRequest.encode(request).finish();
      expect(encoded.length).toBeGreaterThan(0);

      // Verify it can be decoded as a SignalResponse wouldn't match
      // (different field numbers), but the bytes should be valid protobuf
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it('should encode a trickle request', () => {
      const request: import('../src/proto/signal').SignalRequest = {
        trickle: {
          candidateInit: '{"candidate":"..."}',
          target: SignalTarget.PUBLISHER,
        },
      };

      const encoded = SignalRequest.encode(request).finish();
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode a leave request', () => {
      const request: import('../src/proto/signal').SignalRequest = {
        leave: {
          canReconnect: false,
          reason: DisconnectReason.CLIENT_INITIATED,
        },
      };

      const encoded = SignalRequest.encode(request).finish();
      expect(encoded.length).toBeGreaterThan(0);
    });
  });
});
