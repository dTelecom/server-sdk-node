# Changelog

## 0.2.7 (2026-11-16)

- `publishData()` works before any track is published: the first call sets up the publisher connection, whose offer carries the data channels, and waits for the channel to open (15 s by default, `timeoutMs` per call). Before, a bot that had not published a track lost its messages without an error.
- `publishData()` now rejects instead of dropping the message silently: when the participant lacks `canPublishData`, when the channel is closed, or when it does not open in time. `LocalParticipant.permissions` holds what the token allows, as the node reports it.
- Publisher negotiations run one at a time, so a data channel negotiation and a track publish cannot overlap.
- `@discordjs/opus` is an optional dependency: `npm install` no longer fails where it cannot be built; the SDK then encodes with `opusscript`. DTX is now enabled with `opusscript` too.

Earlier versions are described in their commit messages.
