import { describe, it, expect } from 'vitest';
import { OpusRtpPacketizer, OpusRtpDepacketizer, OPUS_TIMESTAMP_INCREMENT } from '../src/audio/rtp-opus';

describe('OpusRtpPacketizer', () => {
  it('should increment sequence number and timestamp', () => {
    const packetizer = new OpusRtpPacketizer(12345);

    const p1 = packetizer.nextPacketInfo();
    const p2 = packetizer.nextPacketInfo();
    const p3 = packetizer.nextPacketInfo();

    // Sequence numbers increment by 1
    expect(p2.sequenceNumber).toBe((p1.sequenceNumber + 1) & 0xFFFF);
    expect(p3.sequenceNumber).toBe((p2.sequenceNumber + 1) & 0xFFFF);

    // Timestamps increment by OPUS_TIMESTAMP_INCREMENT (960)
    expect((p2.timestamp - p1.timestamp) >>> 0).toBe(OPUS_TIMESTAMP_INCREMENT);
    expect((p3.timestamp - p2.timestamp) >>> 0).toBe(OPUS_TIMESTAMP_INCREMENT);

    // SSRC stays constant
    expect(p1.ssrc).toBe(12345);
    expect(p2.ssrc).toBe(12345);
  });

  it('should handle sequence number wraparound', () => {
    const packetizer = new OpusRtpPacketizer(1);
    // Force near wraparound
    for (let i = 0; i < 0xFFFE; i++) {
      packetizer.nextPacketInfo();
    }
    const p1 = packetizer.nextPacketInfo();
    const p2 = packetizer.nextPacketInfo();
    // After 0xFFFF comes 0
    expect(p2.sequenceNumber).toBe((p1.sequenceNumber + 1) & 0xFFFF);
  });
});

describe('OpusRtpDepacketizer', () => {
  it('should process sequential packets without loss', () => {
    const depacketizer = new OpusRtpDepacketizer();

    const r1 = depacketizer.processPacket(Buffer.from([1, 2, 3]), 100, 0);
    expect(r1.isFirst).toBe(true);
    expect(r1.lost).toBe(0);

    const r2 = depacketizer.processPacket(Buffer.from([4, 5, 6]), 101, 960);
    expect(r2.isFirst).toBe(false);
    expect(r2.lost).toBe(0);

    expect(depacketizer.totalLost).toBe(0);
  });

  it('should detect packet loss', () => {
    const depacketizer = new OpusRtpDepacketizer();

    depacketizer.processPacket(Buffer.from([1]), 100, 0);
    // Skip sequence 101, 102 → loss of 2
    const r2 = depacketizer.processPacket(Buffer.from([2]), 103, 2880);
    expect(r2.lost).toBe(2);
    expect(depacketizer.totalLost).toBe(2);
  });

  it('should return the opus payload', () => {
    const depacketizer = new OpusRtpDepacketizer();
    const payload = Buffer.from([0xFC, 0x01, 0x02, 0x03]);
    const result = depacketizer.processPacket(payload, 1, 0);
    expect(result.opusFrame).toEqual(payload);
  });

  it('should reset state', () => {
    const depacketizer = new OpusRtpDepacketizer();
    depacketizer.processPacket(Buffer.from([1]), 100, 0);
    depacketizer.processPacket(Buffer.from([2]), 105, 4800);

    depacketizer.reset();
    expect(depacketizer.totalLost).toBe(0);

    const result = depacketizer.processPacket(Buffer.from([3]), 200, 0);
    expect(result.isFirst).toBe(true);
  });
});
