# Changelog

## 0.3.2 (2026-11-17)

- `publishTrack()` rejects at once with "Participant lacks canPublish" when the token does not allow publishing. The node drops such a request without an answer, so the call used to wait.

## 0.3.1 (2026-11-16)

- `disconnected` reports why the node ended the session: `participant_removed` (`RoomService.RemoveParticipant`, which dTelecom Cloud uses a minute after an unextended token expires), `duplicate_identity`, `room_deleted`, `server_shutdown`; `server_initiated` when the node gives no reason. Before, a leave from the node was reported as `client_initiated`. Leaving with `room.disconnect()` is still `client_initiated`.

## 0.3.0 (2026-11-16)

Breaking: requires Node.js 22 or later (werift 0.27 does).

- `npm install @dtelecom/server-sdk-node` works in a fresh project again. Since 0.2.1 the package ran `patch-package` after install, which it did not depend on, so the install failed with "patch-package: command not found".
- werift 0.22.8 → 0.27.0. werift now keeps checking that the connection is alive when single replies are lost (RFC 7675), which our werift patch was meant to do; the patch is gone. That patch never applied in installed copies of the SDK.
- ICE candidates from the node arrive with an empty `sdpMid`; the SDK drops it so werift 0.27 matches them by line index (werift 0.22 did this itself). Without it no candidate is added and the connection never forms.
- Opus encoding uses opusscript only; `@discordjs/opus` is no longer a dependency. Its 0.9.0 has no prebuilt binary for Node 20 or later, so installs without a C++ toolchain were already on opusscript, which encodes a 20 ms frame in about 0.1 ms. DTX is on.
- `publishData()` works before any track is published: the first call sets up the publisher connection, whose offer carries the data channels, and waits for the channel to open (15 s by default, `timeoutMs` per call). Before, a bot that had not published a track lost its messages without an error.
- `publishData()` now rejects instead of dropping the message silently: when the participant lacks `canPublishData`, when the channel is closed, or when it does not open in time. `LocalParticipant.permissions` holds what the token allows, as the node reports it.
- Publisher negotiations run one at a time, so a data channel negotiation and a track publish cannot overlap.

Earlier versions are described in their commit messages.
