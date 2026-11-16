import { describe, it, expect } from 'vitest';
import { RTCPeerConnection } from 'werift';
import { parseTrickleCandidate } from '../src/engine';

// What the node sends: pion fills sdpMid with "" next to sdpMLineIndex.
const fromNode = JSON.stringify({
  candidate: 'candidate:438254767 1 udp 2130706431 127.0.0.1 42603 typ host',
  sdpMid: '',
  sdpMLineIndex: 0,
  usernameFragment: null,
});

async function answererWithRemoteOffer() {
  const offerer = new RTCPeerConnection();
  offerer.createDataChannel('_reliable');
  await offerer.setLocalDescription(await offerer.createOffer());
  const answerer = new RTCPeerConnection();
  await answerer.setRemoteDescription(offerer.localDescription!);
  return { offerer, answerer };
}

describe('candidates trickled by the node', () => {
  it('drop the empty sdpMid and keep the line index', () => {
    const candidate = parseTrickleCandidate(fromNode);
    expect(candidate.sdpMid).toBeUndefined();
    expect(candidate.sdpMLineIndex).toBe(0);
  });

  it('are accepted by werift, which rejects them as sent', async () => {
    const { offerer, answerer } = await answererWithRemoteOffer();
    try {
      await expect(answerer.addIceCandidate(JSON.parse(fromNode))).rejects.toThrow('sdpMid was not found');
      await expect(answerer.addIceCandidate(parseTrickleCandidate(fromNode))).resolves.toBeUndefined();
    } finally {
      await offerer.close();
      await answerer.close();
    }
  });
});
