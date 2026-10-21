# Orbit Remote: progress log

- 2026-10-21: Explored. Desktop Orbit = SVG rig (OrbitRig), voice = browser SpeechRecognition (useVoiceLifecycle),
  lips follow ttsAdapter events (start/boundary/end), live events = Reverb private `workspace.{id}` + polling,
  Reverb accepts client events from channel members, Vite listens on 0.0.0.0 and proxies /api, Echo connects to
  the page's own host on :8080. Phones need HTTPS for the microphone (secure context) -> R7.
- R1 DONE: migration 2026_10_21_000001 (applied to the dev DB; additive), models OrbitRemoteSession (Prunable, daily
  model:prune) / OrbitRemoteCommand, OrbitRemoteService, AuthenticateOrbitRemoteDevice, OrbitRemoteController
  (desktop) + OrbitRemoteDeviceController (phone), OrbitRemoteSignal event, channel `orbit-remote.{publicId}`,
  logout ends the phone paired with that token, config orbit.remote_public_url (ORBIT_REMOTE_PUBLIC_URL).
  tests/Feature/OrbitRemoteTest.php 15/15 (166 assertions).
- R2 DONE: services/orbitRemoteProtocol.ts (+7 tests): face-state mapping (phone "watches"), gaze, bounded state,
  status line, pairing link (public URL / same host / Wi-Fi address instead of localhost), code in #fragment, throttle.
- R3 DONE: OrbitRig props framing="head", gaze (direction), speechSource (lip-sync from relayed speech).
- R4 DONE: services/orbitPresence.ts (FloatingMascot publishes visible state + element), context/OrbitRemoteContext.tsx
  (instance per tab, restore/attach, channel, commands -> ack (server decides late/duplicate) -> handleVoiceTranscript,
  stop -> interruptTask, state whisper + snapshot + heartbeat, gaze 80 ms, speech relay, phone listening -> web Orbit).
  stageText moved to services/orbitBehavior.ts. Server: ack returns duplicate/too_old.
- R5 DONE: components/remote/{QrCode,PhoneOrbitMock,OrbitRemoteModal,OrbitRemoteCard,PhoneListeningPill,RemoteNavButton};
  dashboard card, navbar button, Orbit panel button. Deps: qrcode-generator, @vitejs/plugin-basic-ssl (dev).
- R6 DONE: pages/OrbitRemotePage.tsx (routed outside the portal providers in App.tsx), hooks/useOrbitRemoteLink.ts
  (socket + polling fallback + heartbeat, speech bus, listening whisper), services/orbitRemoteDevice.ts (device-token
  client, single-flight claim). useVoiceLifecycle gained measureLevel (off on the phone). index.html viewport-fit.
- R7 DONE: echo.ts reverbOptions (https page + http Reverb -> same origin), vite.config.ts (dev:https on 5174 with
  basic-ssl, /app WebSocket proxy), README + API_CONTRACT + SECURITY_MODEL sections.
- R8 (in progress): tsc clean; npm test 73/73; lint 141 (139 before; the 2 left follow existing patterns);
  OrbitRemoteTest 15/15. Two-device probe: 16/16 checks passed before the stack went down (pairing, QR -> Wi-Fi
  address, QR decodes, phone face, live link, validation, password refusal, request relay, mirrored states, eyes).
  Bug found and fixed: double claim under React StrictMode (single-flight claim).
