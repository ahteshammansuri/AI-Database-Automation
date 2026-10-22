# Orbit Remote: control Orbit from a phone (2026-10-21)

## Goal
A QR code on the dashboard (and in the Orbit panel) pairs a phone with the open DataAuto tab. The phone shows only
Orbit's face (head, eyes, face screen, lips). Hold the face and speak: when released, the request is sent to the
computer, and the web Orbit carries it out exactly as if it had been spoken there. The phone face mirrors the web
Orbit live: thinking, speaking (lips follow the real speech), listening, success/error. While the web Orbit flies
around the page, the phone Orbit's eyes follow it.

## Architecture
- **Pairing (Laravel)**: `orbit_remote_sessions` (owner, public id, sha256 of a single-use pairing code valid 3 min,
  sha256 of the phone's device token, labels, status pending/active/ended, desktop instance, last seen, latest
  desktop state snapshot, absolute expiry 12 h, idle expiry 2 h). `orbit_remote_commands` (say/stop, status).
- **Phone auth**: the QR holds `/orbit/remote#code=...` (fragment: never sent in requests or logs). The phone claims
  it once and gets a device token that only works on `/api/orbit-remote/device/*` (not a Sanctum token).
- **Phone -> computer**: `POST /device/commands` (validated, rate limited, secrets refused, audited) -> live event
  `orbit.remote_command` on the user's workspace channel (Reverb, with the existing polling fallback) -> the tab
  that owns the session (instance id) runs `handleVoiceTranscript()`: the normal Orbit pipeline, page context,
  confirmations and secure fields stay on the computer. The tab acks; the phone sees "received".
- **Computer -> phone**: private channel `orbit-remote.{publicId}` (desktop authorised as the user, phone through
  its own auth endpoint for that one channel). Client events: `client-state` (face state, status, caption, task,
  page), `client-gaze` (web Orbit position, normalised, ~12/s while moving), `client-speech` (real TTS start /
  word boundary / end, for lip sync). Phone -> computer client events: `client-listening` (web Orbit shows
  "listening to your phone" with the live words, secrets redacted). Throttled state snapshots go to the server too
  (initial load + polling fallback when the socket is down + computer online indicator).
- **Server signals** (`OrbitRemoteSignal`, broadcast now): paired, command status, ended.

## Security
Single-use 3-minute pairing code (hashed), device token hashed, scoped and revocable; one remote per user; ends on
disconnect from either side, on sign-out, after 2 h idle or 12 h; ownership checks on every desktop endpoint and
channel; rate limits (claim per IP, commands and state per session); passwords/API keys are never sent from the
phone (refused on phone and server; the secure field stays on the computer); confirmations stay on the computer;
audit log entries for pairing created / paired / ended / commands.

## Phases
| # | Step | Status |
|---|------|--------|
| R1 | Backend: migrations, models, service, device middleware, controllers, routes, channel auth, signal event, sign-out hook, audit, rate limits + feature tests | DONE |
| R2 | Shared protocol module (face-state map, gaze, pairing URL, secret check) + unit tests | DONE |
| R3 | OrbitRig: head framing, gaze override, external speech source | DONE |
| R4 | Desktop host: presence store in FloatingMascot, session/instance, channel, commands, state/gaze/speech relay, phone listening on web Orbit | DONE (browser check in R8) |
| R5 | Desktop UI: QR modal (countdown, refresh, LAN address, HTTPS note, connected state, disconnect), dashboard card, Orbit panel button | DONE (browser check in R8) |
| R6 | Phone page `/orbit/remote`: claim, face, hold-to-talk, type, stop, status/captions, offline/expired states, wake lock, haptics | DONE |
| R7 | Dev HTTPS for phone microphones (`npm run dev:https`) + Reverb over the same origin; docs | DONE |
| R8 | Verify: tsc, lint, unit tests, Laravel tests, two-browser end-to-end (desktop + emulated phone), screenshots | DONE |
