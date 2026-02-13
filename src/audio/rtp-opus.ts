/**
 * RTP packetizer and depacketizer for Opus audio.
 *
 * Opus in RTP follows RFC 7587:
 * - Payload type: dynamic (typically 111)
 * - Clock rate: 48000
 * - One Opus frame per RTP packet (no aggregation for 20ms frames)
 *
 * werift handles RTP framing and SRTP, but we need to:
 * - Set correct timestamps (increment by frame_size per packet)
 * - Set correct payload type
 * - Handle sequence numbers
 */

import { createLogger } from '../utils/logger';
import { OPUS_SAMPLE_RATE, OPUS_FRAME_SIZE } from './opus-encoder';

const log = createLogger('RTP-Opus');

/** Standard Opus RTP payload type */
export const OPUS_PAYLOAD_TYPE = 111;

/** RTP clock rate for Opus (always 48000) */
export const OPUS_CLOCK_RATE = OPUS_SAMPLE_RATE;

/** RTP timestamp increment per 20ms Opus frame */
export const OPUS_TIMESTAMP_INCREMENT = OPUS_FRAME_SIZE; // 960

/**
 * Tracks RTP sequence numbers and timestamps for an outgoing Opus stream.
 */
export class OpusRtpPacketizer {
  private sequenceNumber: number;
  private timestamp: number;
  private ssrc: number;
  readonly payloadType: number;

  constructor(ssrc: number = 0, payloadType: number = OPUS_PAYLOAD_TYPE) {
    // Start with random values per RFC 3550
    this.sequenceNumber = Math.floor(Math.random() * 0xFFFF);
    this.timestamp = Math.floor(Math.random() * 0xFFFFFFFF);
    this.ssrc = ssrc;
    this.payloadType = payloadType;
  }

  /**
   * Get the next RTP header values for an Opus frame.
   * Call this for each 20ms frame to get incrementing seq/ts.
   */
  nextPacketInfo(): { sequenceNumber: number; timestamp: number; ssrc: number } {
    const info = {
      sequenceNumber: this.sequenceNumber & 0xFFFF,
      timestamp: this.timestamp >>> 0,
      ssrc: this.ssrc,
    };

    this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF;
    this.timestamp = (this.timestamp + OPUS_TIMESTAMP_INCREMENT) >>> 0;

    return info;
  }

  /** Reset the packetizer state */
  reset(): void {
    this.sequenceNumber = Math.floor(Math.random() * 0xFFFF);
    this.timestamp = Math.floor(Math.random() * 0xFFFFFFFF);
  }
}

/**
 * Tracks and reorders incoming Opus RTP packets.
 * Detects packet loss and provides frames in order.
 */
export class OpusRtpDepacketizer {
  private lastSequenceNumber: number = -1;
  private lastTimestamp: number = -1;
  private lostPackets: number = 0;

  /**
   * Process an incoming RTP packet containing an Opus frame.
   * Returns the Opus payload and metadata.
   */
  processPacket(payload: Buffer, sequenceNumber: number, timestamp: number): {
    opusFrame: Buffer;
    lost: number;
    isFirst: boolean;
  } {
    let lost = 0;
    const isFirst = this.lastSequenceNumber === -1;

    if (!isFirst) {
      const expectedSeq = (this.lastSequenceNumber + 1) & 0xFFFF;
      if (sequenceNumber !== expectedSeq) {
        // Calculate lost packets (handle wraparound)
        if (sequenceNumber > this.lastSequenceNumber) {
          lost = sequenceNumber - this.lastSequenceNumber - 1;
        } else {
          lost = (0xFFFF - this.lastSequenceNumber) + sequenceNumber;
        }
        this.lostPackets += lost;
        if (lost > 0) {
          log.debug(`Lost ${lost} packets (seq ${this.lastSequenceNumber} → ${sequenceNumber})`);
        }
      }
    }

    this.lastSequenceNumber = sequenceNumber;
    this.lastTimestamp = timestamp;

    return {
      opusFrame: payload,
      lost,
      isFirst,
    };
  }

  /** Total packets lost since creation */
  get totalLost(): number {
    return this.lostPackets;
  }

  /** Reset depacketizer state */
  reset(): void {
    this.lastSequenceNumber = -1;
    this.lastTimestamp = -1;
    this.lostPackets = 0;
  }
}
