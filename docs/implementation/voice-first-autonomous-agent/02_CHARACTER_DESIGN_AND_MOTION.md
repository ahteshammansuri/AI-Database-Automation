# Character Design & Motion Specification: "Aura Core"

## 1. Character Visual Identity
- **Name**: Aura Core
- **Concept**: A small, cute, premium floating AI entity consisting of:
  - An inner luminous chromatic core sphere with dynamic radial gradients.
  - Expressive digital LED eyes/face that blink, react, smile, contemplate, and focus.
  - Two counter-rotating elliptical rings with orbital satellite particles.
  - A soft ambient particle halo that pulses according to character state and voice amplitude.
  - A subtle trailing particle wake when travelling across the portal.
- **Footprint**:
  - Idle Dock: 60px diameter (52-72px boundary).
  - Floating position: `fixed bottom-6 right-6` with responsive insets for mobile (`bottom-4 right-4`).
  - Z-Index: 50 (above regular layout, below modals).
  - Elevation & Shadow: Ambient glow + soft drop-shadow (`0 10px 25px -5px rgba(99, 102, 241, 0.4)`).

## 2. The 17 Distinct Character States

| State | Core Color | Ring Physics | Eye / Face Expression | Ambient Halo / Glow |
|---|---|---|---|---|
| `idle` | Indigo (#6366f1) | Gentle slow counter-rotation (8s, -12s) | Soft open eyes, gentle natural blinking | Soft 35% indigo glow, breathing pulse (2.8s) |
| `activation` | Cyan/Sky (#06b6d4) | Quick spin acceleration | Wide alert eyes, bright greeting flare | Instant bloom ring flare |
| `listening` | Vibrant Cyan (#0891b2) | Responsive to mic input volume | Focused listening gaze, audio wave bars | Deep cyan glow pulsing with volume (1.2s) |
| `transcribing` | Sky Blue (#0ea5e9) | Rapid inner ring rotation (2.5s) | Shifting scan gaze (left to right) | Sky blue staccato pulses |
| `understanding` | Deep Violet (#8b5cf6) | Smooth elliptical orbits, tight tilt | Squinting thoughtful eyes | Violet contemplative halo |
| `planning` | Royal Blue (#3b82f6) | Concentric circular alignment | Organizing sequence gaze | Blue structured pulse |
| `moving` | Electric Cyan/Indigo | Aerodynamic trail tilt along velocity vector | Focused looking forward at target destination | Stretched trailing velocity particles |
| `interacting` | Emerald / Cyan | Calm hover beside target element | Looking down/towards the active form or table | Local spotlight glow over the target field |
| `waiting_for_user` | Warm Amber (#f59e0b) | Slow expectant hover | Questioning tilt, soft blinking | Warm amber inviting halo |
| `needs_confirmation` | Amber/Rose (#f97316) | Pulsing dual rings with warning rhythm | Serious alert eyes, waiting on user consent | Amber/Orange warning strobe |
| `executing` | Radiant Cobalt (#2563eb) | Synchronous double rotation (1.5s) | Energetic industrious gaze | High-intensity blue operational aura |
| `success` | Vibrant Emerald (#10b981) | Harmonious wide orbit expansion | Curved happy crescent eyes (^.^) | Radiant green celebration bloom |
| `warning` | Honey Gold (#d97706) | Off-axis wobble | Concerned expression, gentle pulse | Honey orange cautious glow |
| `error` | Coral Red (#ef4444) | Stalled outer ring, gentle recovery orbit | Sad / apologetic soft eyes | Coral red non-alarming glow |
| `paused` | Muted Slate (#64748b) | Static suspended rings | Sleeping / resting half-closed eyes | Low-intensity slate resting halo |
| `cancelled` | Rose / Slate (#e11d48) | Settle down to dock | Neutral acknowledgement | Rose fading ring settle |
| `offline` | Dim Charcoal (#475569) | Dormant motionless rings | Closed asleep eyes | Faint passive outline |

## 3. Motion Engineering & Accessibility
- **Library**: Framer Motion (already in project dependencies).
- **Physics**: Spring transitions (`damping: 24`, `stiffness: 260`) for snappy, organic movement.
- **Performance**:
  - SVG vector rendering with hardware-accelerated transforms (`transform: translate3d`).
  - No continuous heavy blur recalculations or infinite canvas repaints.
  - Zero performance degradation; targeted at 60 FPS.
- **Accessibility & Reduced Motion**:
  - Listens to `useReducedMotion()` from Framer Motion.
  - When reduced motion is preferred: orbital spinning stops, travelling transitions become instant fades, and particle effects are minimized.

## 4. Dock-to-Target Travelling Behavior
- When an operation requires visual navigation:
  1. The application routes to the target page via React Router.
  2. The mascot locates the registered target anchor element (e.g. `#connection-form-anchor`, `#schema-explorer-anchor`, `#automation-builder-anchor`).
  3. Mascot state transitions to `moving`.
  4. Framer Motion animates the mascot's fixed viewport coordinates from the bottom-right dock directly to the side of the anchor element (`targetX = rect.left - 70`, `targetY = rect.top + 20`).
  5. Mascot transitions to `interacting` or `executing`, and a luminous ripple highlights the target section.
  6. Upon completion, the mascot glides smoothly back to its bottom-right dock and enters `success` or `idle`.
