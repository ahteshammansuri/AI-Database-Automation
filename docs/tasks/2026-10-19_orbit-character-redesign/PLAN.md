# Orbit character redesign and panel overlap — 2026-10-19

Request: the open Orbit panel's "New conversation" could not be clicked because docked Orbit covered the
panel's bottom; Orbit's head looked like it wore goggles; make Orbit look like the reference sheet
(cute, compact, round glossy head, big black face screen, glowing ring eyes, eyebrows, smile, blush,
scarf + cape, chest emblem) with natural, cute smiling and speaking.

Resume: read PROGRESS.md, then continue from the first item that is not DONE.

| # | Item | Status | Verification |
|---|------|--------|--------------|
| C1 | Panel sits above docked Orbit (clearance from MASCOT_BOX + dock margin); fits the viewport; Orbit glances at the open panel | DONE | real browser: elementFromPoint at "New conversation" is the button |
| C2 | Redraw the SVG rig after the reference: round head, TV-style face screen (no visor), ring eyes with catchlights (no lens iris), brows, D smile, lavender blush, ear discs, antenna, scarf + cape, emblem, body, arms, feet | DONE | preview sheet screenshots vs reference |
| C3 | Expressions per state like the sheet (idle, listening, thinking, working, success, oops, excited) incl. eyebrows | DONE | preview sheet |
| C4 | Natural speaking: syllable-paced mouth shapes from real TTS word boundaries, smile between phrases | DONE | unit test of the lip-sync envelope |
| C5 | Cute behaviour polish (blink squash, happy squint, glance at panel, gentle landing) | DONE | preview + real browser |
| C6 | Tests, tsc, lint; real-browser check at header (64 px) and dock (100 px) sizes | DONE | outputs |
| C7 | Docs (README Orbit section, PROGRESS) | DONE | — |
