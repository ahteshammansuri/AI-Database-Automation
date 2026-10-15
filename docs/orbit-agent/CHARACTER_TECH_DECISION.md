# Orbit Character — Technology Decision

> **Update (v4, user decision):** Orbit is now a **real-time 3D model** (Three.js, `three@0.180.0`, lazy-loaded):
> `frontend/src/components/agent/orbit3d/{buildOrbit.ts,faceTexture.ts,Orbit3D.tsx}`.
> - The procedural model matches the design sheet: clearcoat white shell, a curved glass face screen with a live canvas face, ear pods, an antenna orb, a fabric-sheen scarf and fluttering cape, a glowing badge, stubby arms with thumb/finger hand variants, and glowing hover soles.
> - It uses a studio environment, key, fill and rim lights, and a contact shadow.
> - It is driven by the same pose table and real-event states via the shared `orbit/rigMotion.ts`. The 3D model turns its head toward the target and mirrors to gesture at it.
> - The render loop is capped at 30 fps active / 15 fps calm, and pauses when hidden.
> - The SVG rig below remains for tiny avatars and as the fallback when WebGL is unavailable or the context is lost.

## Decision

Orbit is a **layered SVG rig animated in React**, with a small spring layer on `requestAnimationFrame`. It replaces the per-state PNG sprites (`frontend/public/mascot/*.png`) for the live character. The PNGs remain in the repo as marketing/reference art only.

- Rig: `frontend/src/components/agent/orbit/OrbitRig.tsx`
- Poses: `frontend/src/components/agent/orbit/poses.ts`
- Manifest (generated from the pose table): `frontend/public/orbit/manifest.json`
- Public component (unchanged API): `frontend/src/components/agent/OrbitMascotCharacter.tsx`

## Why

| Option | Verdict |
|---|---|
| Keep PNG sprites (+ overlays) | Rejected. One image per state cannot do independent eye direction, eyelids, lip sync, or arm/hand/finger gestures, and it cannot point at the actual target. |
| **SVG rig + springs** | **Chosen.** No new dependency, editable in code, crisp at 48–190 px, cheap (one small SVG per instance), and every joint can be driven by a real runtime event. |
| Rive state machine | Strong option for hand-authored animation, but it needs a `.riv` asset made in the Rive editor. That would be a second source of truth outside the repo, and nobody on this project can author or review it in code. |
| Lottie | Plays pre-baked timelines; it doesn't support per-frame gaze toward a live DOM target or speech-driven mouth movement. |
| Three.js / 3D | Too heavy for a corner companion; it adds a WebGL dependency and bundle cost for little readability gain at 64–100 px. |

Framer Motion (already a dependency) is still used to move Orbit around the page. Joint animation inside the SVG uses a dedicated RAF spring instead, because SVG `transform-origin` handling for joint pivots is unreliable across browsers when driven through CSS transforms. The rig sets explicit pivot points with SVG `rotate(angle cx cy)`.

## Identity preserved (from `references/character-design-sheet-*.png`)

- White glossy rounded helmet with a highlight, and a black rounded face screen.
- Cyan eyes (with white catch-light pupils) and a cyan mouth.
- Light ear pods with a coloured inner ring, and an antenna with a glowing orb.
- Purple cape and collar; chest shield emblem with a chevron "V" and a core light.
- Stubby arms with mitten hands (thumb plus three fingers when open, an index finger when pointing), and hover feet with thruster glow.
- Palette: `#FFFFFF`, `#F2F6FF`, `#6C5CE7`, `#00D4FF`, `#A29BFE`, `#1E1E2F`, `#0F172A`.

## 3D look (v3.1)

Rebuilt to match the design-sheet hero render, with no new dependency and no SVG blur filters (to stay cheap on CPU):

- **Proportions:** big, wide glossy head and a small chubby body.
- **Eyes:** large glowing ring eyes with a blue gradient iris and two white sparkles; rosy cheeks.
- **Head details:** headphone ear pods with a glowing core, and a glowing antenna orb.
- **Cape and badge:** purple scarf collar with a flowing tail; round glowing chest badge with the chevron emblem.
- **Feet:** glowing blue soles.

Depth comes from radial-gradient shading lit from the upper left, a blue rim light on the shadow side, specular highlights, ambient occlusion under the head, and gradient glow halos.

## Articulation

The springed joints are: body hover and lean, head tilt (pivot at the neck), gaze (eyes and face plate shift toward the target), eyelids, eye shape, mouth shape and openness, left/right shoulder and elbow, hand shape, foot tuck, thruster intensity, antenna sway, core/antenna glow, and cape flutter.

The rig mirrors horizontally (`facing`) so the gesturing arm always points at the target's side of the screen.

## What drives it (non-deception rules)

| Source | Drives |
|---|---|
| `agent.turn_stage` (server) | thinking / working / processing |
| `agent.task_updated` status (server) | waiting for input, confirmation, success (only on `SUCCEEDED`), error, paused, cancelled, offline (service error) |
| `orbitStage` travel/gesture events | Emitted only right before a real allowlisted UI action runs on a registered target |
| `ttsAdapter` start/boundary/end events | Speaking and mouth openness (real playback only) |
| Microphone recognition events | Listening; the input meter shows the real level or nothing |
| Timers | Allowed only for idle personality: blinking, breathing, hover bob, antenna sway, curious tilt |

The pose-preview studio in the HUD renders a separate preview character. It never changes the live Orbit.

## Reduced motion

With `prefers-reduced-motion`, joints snap to their pose and the hover, blink, wave, tap, ripple, ring and trail loops are off. Travel to a target becomes an instant reposition, with no spring flight.

## Not implemented (honest scope)

- **Dive and swim:** these idle playful behaviours are not implemented.
- **Walk cycle:** Orbit hovers and flies, which matches the design sheet's hover feet.
- **Phoneme-accurate visemes:** browser speech synthesis exposes only word boundaries, so the mouth opens on word boundaries. When a voice emits no boundary events, it articulates only while audio is actually playing.
