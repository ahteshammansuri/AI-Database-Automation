# Progress — Orbit character redesign

## 2026-10-19
- Cause of the click problem: AgentOperationalHUD is fixed at bottom 96 px; docked Orbit is 152 px tall
  at a 24 px margin (z-70, pointer events on), so it covered the panel's bottom 80 px incl. "New conversation".
- Look: the face screen was a wide pill (104x74, rx 36) and each eye a dark ball with a cyan lens iris and
  ring, which reads as goggles. Reference: big rounded TV screen, eyes = glowing cyan ring + dark centre +
  white catchlights, short cyan brows, D-shaped smile, lavender blush.
- C2/C3: OrbitRig redrawn (squircle TV screen set into the shell, ring eyes with dark pupil + catchlights and
  squash blink, eyebrows (browY/browTilt/browAsym pose numbers), D-shaped smile/grin, lavender blush, ear discs
  that glow with the mic level, seamless tube arms, egg body, scarf knot, emblem with the Y mark). New eye
  shape "wink" (oops/warning). All articulation, gaze, gestures and frame-rate caps kept.
- C4: lipSync.ts (import-free): syllable timeline from the spoken text (vowel shapes, m/b/p closures,
  pauses at punctuation, Devanagari aksharas), re-anchored on every real word boundary; head nod and brow
  lift on stressed syllables and questions. Found and fixed: the rig subscribed to speech in useMemo and
  unsubscribed in an effect cleanup, so under React StrictMode (dev) the mouth never received speech events.
- C1: panel bottom = dock margin + Orbit height + 10 px (dockClearance), max height fits under the top bar.
  Real browser at 1280x800, 1280x640, 390x844: no overlap, all 7 visible panel buttons hit-testable,
  "New conversation" clicked, no exceptions.
- C5: Orbit glances at the panel for 2.2 s when it opens; "New conversation" is easier to see.
- C6: real app (StrictMode) with a realistic speech event stream: mouth opened/closed 20 times over one
  sentence, closed at "Hello!" and "step by step." pauses, label "Orbit (speaking)" then idle. Movement sync
  re-verified after moving lastPlacement into an effect (lint): at each page change Orbit was beside the
  link and still for 300 ms; captions 8.4 s / 7.5 s. Frontend 57/57, tsc clean, lint: no new warnings
  (useMascotTravel 2 -> 0). QA users 74 and 75 deleted; temporary preview page removed.
- C7: README Orbit section (character, speaking, panel) and the Orbit test instructions (the old
  scripts/verify_orbit_mascot.py no longer exists).
