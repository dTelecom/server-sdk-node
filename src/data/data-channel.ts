/**
 * Data channel utilities for sending/receiving protobuf-encoded
 * DataPacket messages over WebRTC data channels.
 */

import { DataPacket, DataPacket_Kind, UserPacket } from '../proto/models';
import { createLogger } from '../utils/logger';

const log = createLogger('DataChannel');

/**
 * Encode a user data message into a DataPacket for transmission.
 */
export function encodeDataPacket(
  participantSid: string,
  payload: Uint8Array,
  kind: DataPacket_Kind = DataPacket_Kind.RELIABLE,
  options?: { destinationSids?: string[]; topic?: string },
): Uint8Array {
  const packet: DataPacket = {
    kind,
    user: {
      participantSid,
      payload,
      destinationSids: options?.destinationSids ?? [],
      topic: options?.topic,
    },
  };

  return DataPacket.encode(packet).finish();
}

/**
 * Decode a DataPacket received from a data channel.
 */
export function decodeDataPacket(data: Uint8Array): DataPacket {
  return DataPacket.decode(data);
}

/**
 * Helper to create a text message DataPacket.
 */
export function createTextMessage(
  participantSid: string,
  text: string,
  options?: { destinationSids?: string[]; topic?: string },
): Uint8Array {
  const payload = new TextEncoder().encode(text);
  return encodeDataPacket(participantSid, payload, DataPacket_Kind.RELIABLE, options);
}
