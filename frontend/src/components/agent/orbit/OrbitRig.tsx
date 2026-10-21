import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ttsAdapter } from "../../../services/ttsAdapter";
import {
  COLORS, EyeShape, HandShape, MouthShape, NUMERIC_KEYS, OrbitPose, PoseNumbers, applyEmotion, poseFor,
} from "./poses";
import { createLipSync, motionLayers } from "./rigMotion";
import { createBlinker, createIdlePersonality, createSaccades } from "./rigPersonality";

/**
 * Orbit — layered, articulated SVG rig drawn after the character sheet: a round glossy head with a
 * big black screen face (glowing ring eyes with catchlights, eyebrows, a soft D-shaped smile, blush),
 * ear discs, antenna, purple scarf and cape, chest emblem, stubby tube arms with mitten hands and
 * hovering feet with glowing soles.
 *
 * Joints spring toward the pose for the current *real* state. Timers only drive idle personality
 * (blink, breathing, hover); the mouth follows actual speech playback (see lipSync.ts).
 */

export interface OrbitRigProps {
  state: string;
  width: number;
  emotion?: string | null;
  /** Viewport point to look at (the element Orbit is working on). */
  lookAt?: { x: number; y: number } | null;
  /** Which side the active target is on; the rig mirrors so gestures point at it. */
  facing?: "left" | "right";
  /** Real microphone level 0..1 while listening. */
  audioLevel?: number;
  /** Follow the pointer with the eyes while idle. */
  followPointer?: boolean;
  reducedMotion?: boolean;
  label?: string;
}

// Chibi proportions from the sheet: a big round head, a small rounded body, stubby limbs.
const SHOULDER_L = { x: 69, y: 163 };
const SHOULDER_R = { x: 131, y: 163 };
const UPPER = 9;
const FORE = 8;
const NECK = { x: 100, y: 142 };
const EYE_L = { x: 77, y: 89 };
const EYE_R = { x: 123, y: 89 };
const EYE_R0 = 13.6;
const MOUTH = { x: 100, y: 110 };

const INK = "#7FE9FF"; // face light (eyes, brows, mouth)
const INK_GLOW = "#22D3EE";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (d: number) => (d * Math.PI) / 180;
/** Arm direction for an SVG rotation of the downward vector. */
const dir = (deg: number) => ({ x: -Math.sin(rad(deg)), y: Math.cos(rad(deg)) });

/** Superellipse ("squircle"): the TV-style face screen, rounder than a rounded rectangle. */
function squircle(cx: number, cy: number, hw: number, hh: number, n = 3.1, steps = 96): string {
  let d = "";
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = cx + hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = cy + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}
const SCREEN = squircle(100, 92, 50, 35.5);
const SCREEN_GROOVE = squircle(100, 92.5, 52.8, 38.4);

function pickNumbers(p: OrbitPose): PoseNumbers {
  const out = {} as PoseNumbers;
  NUMERIC_KEYS.forEach((k) => (out[k] = p[k]));
  return out;
}

/** States with only gentle idle motion render at a lower frame rate to save CPU. */
const CALM_STATES = new Set(["idle", "resting", "offline", "paused", "waiting", "needs_input", "needs_confirmation", "cancelled"]);

/**
 * Springs pose numbers toward their targets. Frame-rate capped (30 fps while active,
 * 15 fps while calm) and fully idle when nothing moves (reduced motion), because the
 * portal runs on modest CPU-only machines next to a local LLM.
 */
function useAnimatedRig(target: OrbitPose, reduced: boolean, calm: boolean) {
  const current = useRef<PoseNumbers>(pickNumbers(target));
  const targetRef = useRef<OrbitPose>(target);
  targetRef.current = target;
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const [frame, setFrame] = useState(0);
  const t0 = useRef(performance.now());

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const minGap = calmRef.current ? 66 : 33;
      if (now - lastPaint < minGap) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = reduced ? 1 : 1 - Math.exp(-dt * 9);
      const tgt = targetRef.current;
      const cur = current.current;
      let moving = false;
      NUMERIC_KEYS.forEach((key) => {
        const diff = tgt[key] - cur[key];
        if (Math.abs(diff) > 0.001) moving = true;
        cur[key] = cur[key] + diff * k;
      });
      // Repaint while springing, and for idle motion only when motion is allowed.
      if (moving || !reduced) {
        lastPaint = now;
        setFrame((f) => (f + 1) % 1_000_000);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return { cur: current.current, time: (performance.now() - t0.current) / 1000, frame };
}

/**
 * Mouth shape from real speech playback. The speech subscription lives in an effect (not in
 * useMemo), so React StrictMode's mount/unmount/mount cycle cannot leave it disconnected.
 */
function useLipSync() {
  const [relay] = useState(() => {
    const box: { sink: ((e: any) => void) | null } = { sink: null };
    const lip = createLipSync((fn) => {
      box.sink = fn;
      return () => {
        box.sink = null;
      };
    });
    return { lip, push: (e: unknown) => box.sink?.(e) };
  });
  useEffect(() => ttsAdapter.subscribe(relay.push as any), [relay]);
  return relay.lip;
}

/** States where Orbit is calm and may show idle personality (glances, tilts, being petted). */
const PERSONALITY_STATES = new Set(["idle", "waiting", "needs_input", "curious"]);

// ---------------------------------------------------------------------------
// Drawing helpers (3D look from layered gradients: base shading, rim light,
// specular highlights and glow halos; no SVG blur filters, to stay cheap on CPU)
// ---------------------------------------------------------------------------

type Paint = { shell: string; rim: string; limb: string; sole: string };

/** A glowing face stroke: soft wide halo under a crisp line (no blur filter). */
const GlowLine: React.FC<{ d: string; width?: number }> = ({ d, width = 2.6 }) => (
  <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} stroke={INK_GLOW} strokeOpacity={0.28} strokeWidth={width + 4.5} />
    <path d={d} stroke={INK} strokeWidth={width} />
  </g>
);

const Hand: React.FC<{ shape: HandShape; paint: Paint }> = ({ shape, paint }) => {
  const edge = { stroke: COLORS.shellEdge, strokeWidth: 0.8 };
  const ball = (r: number, cy = 0) => (
    <g>
      <circle cy={cy} r={r} fill={paint.limb} {...edge} />
      <ellipse cx={-r * 0.3} cy={cy - r * 0.34} rx={r * 0.42} ry={r * 0.3} fill="#FFFFFF" opacity={0.9} />
    </g>
  );
  switch (shape) {
    case "point":
      return (
        <g>
          <rect x={-2.1} y={4} width={4.2} height={10} rx={2.1} fill={paint.limb} {...edge} />
          {ball(6.4, 2)}
          <circle cx={-5} cy={1.5} r={2.4} fill={paint.limb} {...edge} />
        </g>
      );
    case "open":
      return (
        <g>
          {[-28, 0, 28].map((a) => (
            <rect key={a} x={-1.9} y={4} width={3.8} height={6.5} rx={1.9} fill={paint.limb} {...edge} transform={`rotate(${a})`} />
          ))}
          {ball(6.8, 2)}
          <circle cx={-6} cy={0.6} r={2.4} fill={paint.limb} {...edge} />
        </g>
      );
    case "fist":
      return ball(6.6, 2);
    default:
      return ball(8, 2.5);
  }
};

/** A soft, seamless tube arm (shoulder → elbow → wrist) with a mitten hand. */
const Arm: React.FC<{
  shoulder: { x: number; y: number }; angle: number; elbow: number; hand: HandShape; paint: Paint;
}> = ({ shoulder, angle, elbow, hand, paint }) => {
  const a = dir(angle);
  const b = dir(angle + elbow);
  const e = { x: shoulder.x + a.x * UPPER, y: shoulder.y + a.y * UPPER };
  const w = { x: e.x + b.x * FORE, y: e.y + b.y * FORE };
  const d = `M${shoulder.x} ${shoulder.y} L${e.x.toFixed(2)} ${e.y.toFixed(2)} L${w.x.toFixed(2)} ${w.y.toFixed(2)}`;
  const tube = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      <path d={d} {...tube} stroke={COLORS.shellEdge} strokeWidth={16.6} />
      <path d={d} {...tube} stroke="#E6EBF7" strokeWidth={14.8} />
      <path d={d} {...tube} stroke="#FFFFFF" strokeWidth={8} opacity={0.92} transform="translate(-1.4 -1.3)" />
      <g transform={`translate(${w.x} ${w.y}) rotate(${angle + elbow})`}>
        <Hand shape={hand} paint={paint} />
      </g>
    </g>
  );
};

/** Screen eye: a glowing cyan ring with a dark pupil and white catchlights; blinks by squashing. */
function Eye({ cx, cy, shape, scale, lid, lookX, lookY, pupil, uid, time = 0, phase = 0 }: {
  cx: number; cy: number; shape: EyeShape; scale: number; lid: number; lookX: number; lookY: number; pupil: number; uid: string;
  /** Seconds, for the gentle catchlight pulse and sparkle (0 = still). */
  time?: number;
  phase?: number;
}) {
  const base = EYE_R0 * scale;
  if (shape === "happy") {
    return <GlowLine d={`M${cx - base * 0.8} ${cy + base * 0.3} Q${cx} ${cy - base * 0.95} ${cx + base * 0.8} ${cy + base * 0.3}`} width={3.6} />;
  }
  if (shape === "closed") {
    return <GlowLine d={`M${cx - base * 0.78} ${cy} Q${cx} ${cy + base * 0.6} ${cx + base * 0.78} ${cy}`} width={3.2} />;
  }
  const R = base * (shape === "wide" ? 1.1 : shape === "focused" ? 0.93 : 1);
  const open = (shape === "squint" ? 0.5 : shape === "focused" ? 0.88 : 1) * (1 - clamp(lid, 0, 1) * 0.94);
  if (open < 0.18) {
    // Mid-blink: a soft closed line rather than a flat slit.
    return <GlowLine d={`M${cx - R * 0.8} ${cy + 1} Q${cx} ${cy + 3.6} ${cx + R * 0.8} ${cy + 1}`} width={3} />;
  }
  const px = cx + lookX * R * 0.22;
  const py = cy + lookY * R * 0.2 + (shape === "sad" ? R * 0.12 : 0);
  return (
    <g transform={`translate(${cx} ${cy}) scale(1 ${open.toFixed(3)}) translate(${-cx} ${-cy})`}>
      <circle cx={cx} cy={cy} r={R * 1.8} fill={`url(#eyeglow-${uid})`} />
      <circle cx={cx} cy={cy} r={R} fill={`url(#eyein-${uid})`} />
      <circle cx={px} cy={py} r={R * 0.56 * pupil} fill="#02040B" />
      <circle cx={cx} cy={cy} r={R - 1.5} fill="none" stroke={INK} strokeWidth={3} />
      {open > 0.4 && (
        <g fill="#FFFFFF">
          <circle cx={px + R * 0.27} cy={py - R * 0.3} r={R * 0.27 * pupil * (1 + 0.05 * Math.sin(time * 2.4 + phase))} />
          <circle cx={px - R * 0.3} cy={py + R * 0.3} r={R * 0.12} opacity={0.9} />
          {time > 0 && (
            <path
              transform={`translate(${(cx - R * 0.78).toFixed(2)} ${(cy - R * 0.72).toFixed(2)}) scale(${(0.5 + 0.5 * Math.max(0, Math.sin(time * 1.7 + phase))).toFixed(3)})`}
              d="M0 -2.6 L0.6 -0.6 L2.6 0 L0.6 0.6 L0 2.6 L-0.6 0.6 L-2.6 0 L-0.6 -0.6 Z"
              opacity={0.85}
            />
          )}
        </g>
      )}
    </g>
  );
}

/** Short glowing eyebrow; `side` -1 = screen-left, 1 = screen-right; tilt > 0 lifts the inner ends. */
const Brow: React.FC<{ cx: number; y: number; tilt: number; side: -1 | 1 }> = ({ cx, y, tilt, side }) => (
  <g transform={`translate(${cx} ${y.toFixed(2)}) rotate(${(side * tilt).toFixed(2)})`}>
    <GlowLine d="M-5.6 1.4 Q0 -2.2 5.6 1.4" width={2.4} />
  </g>
);

/** D-shaped mouth: top edge (corners lifted, sagging or bulging) and a round lower lip. */
function mouthPath(w: number, depth: number, lift: number, bulge: number): string {
  const { x, y } = MOUTH;
  const l = x - w / 2;
  const r = x + w / 2;
  const top = y - lift;
  return `M${l.toFixed(2)} ${top.toFixed(2)} C${(l + w * 0.3).toFixed(2)} ${(top - bulge).toFixed(2)} ${(r - w * 0.3).toFixed(2)} ${(top - bulge).toFixed(2)} ${r.toFixed(2)} ${top.toFixed(2)}`
    + ` C${r.toFixed(2)} ${(y + depth * 0.8).toFixed(2)} ${(x + w * 0.28).toFixed(2)} ${(y + depth).toFixed(2)} ${x} ${(y + depth).toFixed(2)}`
    + ` C${(x - w * 0.28).toFixed(2)} ${(y + depth).toFixed(2)} ${l.toFixed(2)} ${(y + depth * 0.8).toFixed(2)} ${l.toFixed(2)} ${top.toFixed(2)} Z`;
}

function Mouth({ shape, open, round, uid }: { shape: MouthShape; open: number; round: number; uid: string }) {
  const { x, y } = MOUTH;
  const solid = (d: string, depth: number, w: number) => (
    <g>
      <path d={d} fill={INK_GLOW} fillOpacity={0.25} stroke={INK_GLOW} strokeOpacity={0.25} strokeWidth={4.5} strokeLinejoin="round" />
      <path d={d} fill={`url(#mouth-${uid})`} />
      {depth > 5 && <ellipse cx={x} cy={y + depth * 0.68} rx={w * 0.22} ry={depth * 0.18} fill="#1D4ED8" opacity={0.45} />}
    </g>
  );
  switch (shape) {
    case "smile":
      return solid(mouthPath(15, 6.5, 0.9, -1.5), 6.5, 15);
    case "grin":
      return solid(mouthPath(21, 10, 1.7, -2.2), 10, 21);
    case "open":
      return solid(mouthPath(9, 8, 0, 2.6), 8, 9);
    case "o":
      return (
        <g>
          <ellipse cx={x} cy={y + 2.5} rx={5.6} ry={6.2} fill={INK_GLOW} opacity={0.25} />
          <ellipse cx={x} cy={y + 2.5} rx={3.4} ry={4} fill={`url(#mouth-${uid})`} />
        </g>
      );
    case "flat":
      return <GlowLine d={`M${x - 6} ${y + 1} Q${x} ${y + 3.6} ${x + 6} ${y + 1}`} />;
    case "frown":
      return <GlowLine d={`M${x - 6} ${y + 4} Q${x} ${y - 2} ${x + 6} ${y + 4}`} />;
    case "wavy":
      return <GlowLine d={`M${x - 9} ${y + 2} q2.25 -2.5 4.5 0 q2.25 2.5 4.5 0 q2.25 -2.5 4.5 0 q2.25 2.5 4.5 0`} width={2.3} />;
    case "talk": {
      // Closed lips rest in a soft smile; vowels open it wide ("ah", "ee") or round ("oh", "oo").
      if (open < 0.08) return <GlowLine d={`M${x - 6} ${y + 0.6} Q${x} ${y + 4} ${x + 6} ${y + 0.6}`} />;
      const w = 10 + (1 - round) * 5 - round * 2 + open * 2;
      const depth = 1.8 + open * 8.5;
      return solid(mouthPath(w, depth, (1 - round) * 1.1, round * open * 4 - (1 - round) * 1.2), depth, w);
    }
    default:
      return solid(mouthPath(15, 6.5, 0.9, -1.5), 6.5, 15);
  }
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

export const OrbitRig: React.FC<OrbitRigProps> = ({
  state, width, emotion, lookAt, facing = "right", audioLevel = 0, followPointer = true, reducedMotion = false, label,
}) => {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);
  const stateSince = useRef({ state, at: performance.now(), from: state });
  if (stateSince.current.state !== state) stateSince.current = { state, at: performance.now(), from: stateSince.current.state };

  const blinker = useMemo(() => createBlinker(), []);
  const personality = useMemo(() => createIdlePersonality(), []);
  const saccades = useMemo(() => createSaccades(), []);
  const lip = useLipSync();
  const live = !reducedMotion;

  // Being "petted": the pointer resting on Orbit while it is calm makes it happy (personality only).
  const now = performance.now();
  let petted = false;
  if (live && PERSONALITY_STATES.has(state) && pointer.current && svgRef.current && now - pointer.current.at < 4000) {
    const r = svgRef.current.getBoundingClientRect();
    petted = pointer.current.x >= r.left && pointer.current.x <= r.right && pointer.current.y >= r.top && pointer.current.y <= r.bottom;
  }
  // Idle personality (glances, tilts, an occasional smile), only when calm and not looking at anything.
  const pointerFresh = !!pointer.current && now - pointer.current.at < 2500;
  const beat = personality.sample(now, live && PERSONALITY_STATES.has(state) && !lookAt && !pointerFresh);
  const smiling = beat.smile > 0.45;
  const pose = useMemo(() => {
    const base = applyEmotion(poseFor(state), state === "speaking" ? emotion : null);
    return petted || smiling ? { ...base, eyes: "happy" as EyeShape, mouth: "grin" as MouthShape, blush: true, browY: base.browY - 2 } : base;
  }, [state, emotion, petted, smiling]);
  const { cur, time } = useAnimatedRig(pose, reducedMotion, CALM_STATES.has(state) && !petted);

  useEffect(() => {
    if (!followPointer || reducedMotion) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, at: performance.now() };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [followPointer, reducedMotion]);

  const mirrored = facing === "left";
  const elapsed = (now - stateSince.current.at) / 1000;

  // ---- Gaze: real target first, pointer only when calm and recently moved -----------
  const gazePoint = lookAt ?? (["idle", "listening", "curious"].includes(state) && pointerFresh ? pointer.current : null);
  let gaze: { x: number; y: number } | null = null;
  if (gazePoint && svgRef.current) {
    const r = svgRef.current.getBoundingClientRect();
    const dx = (gazePoint.x - (r.left + r.width / 2)) / 260;
    const dy = (gazePoint.y - (r.top + r.height * 0.35)) / 260;
    gaze = { x: clamp(mirrored ? -dx : dx, -1, 1), y: clamp(dy, -1, 1) };
  }

  // ---- Procedural motion layers (shared with the 3D renderer) ----------------------
  const layers = motionLayers(pose, cur, time, elapsed, live, gaze);
  let { bodyY, headRot, lookX, lookY } = layers;
  const { bodyRot, lElbow, rElbow, breathe } = layers;

  // Glances, plus tiny micro-saccades while calm so the eyes never look frozen.
  const sacc = saccades.sample(now, live && CALM_STATES.has(state) && !lookAt);
  lookX = clamp(lookX + beat.lookX + sacc.x, -1, 1);
  lookY = clamp(lookY + beat.lookY + sacc.y, -1, 1);
  headRot += beat.headRot;
  if (petted && live) {
    headRot += Math.sin(time * 5) * 3; // happy wiggle
    bodyY -= Math.abs(Math.sin(time * 4)) * 1.5;
  }

  // Landing: a small squash when Orbit arrives after flying.
  const landing = live && stateSince.current.from === "moving" && state !== "moving" && elapsed < 0.6
    ? Math.exp(-elapsed * 7) * Math.cos(elapsed * 18) : 0;
  const squashY = 1 - landing * 0.07;
  const squashX = 1 + landing * 0.05;
  bodyY += landing * 2;

  const lid = Math.max(cur.lid, blinker.lid(now, live && ["open", "wide", "focused", "sad", "wink"].includes(pose.eyes)));
  const talking = pose.mouth === "talk";
  const lipLevel = lip.sample(time, talking);
  const mouthOpen = talking ? lipLevel : cur.mouthOpen;
  const mouthRound = talking ? lip.round(time) : 0.5;
  // Speaking emphasis: a tiny nod on each word's first syllable; brows lift on stressed words and questions.
  const emphasis = talking && live ? lip.beat() : 0;
  headRot += emphasis * 1.6;
  const browLift = emphasis * 1.3 + (talking && lip.asking() ? 1.4 : 0);
  const pupil = pose.eyes === "wide" || state === "listening" || petted ? 1.12 : 1;
  const listeningGlow = state === "listening" ? clamp(audioLevel, 0, 1) : 0;
  const glow = clamp(cur.glow + listeningGlow * 0.4 + (live ? Math.sin(time * 3) * 0.06 : 0), 0, 1);
  const core = pose.core;
  const flutter = cur.capeFlutter * (live ? 0.6 + 0.4 * Math.sin(time * (2 + cur.capeFlutter * 6)) : 1);
  const feetY = 205 - cur.feetTuck * 7;
  const shadowScale = clamp(1 - (bodyY < 0 ? -bodyY / 40 : 0) - cur.feetTuck * 0.25, 0.4, 1.1);
  // Ear discs light up with the real microphone level while listening.
  const earGlow = state === "listening" ? 0.45 + listeningGlow * 0.55 : 0.12;

  // Right-hand tip (for click ripples), via forward kinematics of the tube arm.
  const ua = dir(cur.rShoulder);
  const fa = dir(cur.rShoulder + rElbow);
  const reach = pose.rHand === "point" ? 15 : 8;
  const tip = { x: SHOULDER_R.x + ua.x * UPPER + fa.x * (FORE + reach), y: SHOULDER_R.y + ua.y * UPPER + fa.y * (FORE + reach) };

  const paint: Paint = {
    shell: `url(#shell-${uid})`,
    rim: `url(#rim-${uid})`,
    limb: `url(#limb-${uid})`,
    sole: `url(#sole-${uid})`,
  };
  const height = Math.round(width * 1.16);
  const browBase = EYE_L.y - EYE_R0 - 6.5 + cur.browY - browLift;
  const winkLeft = pose.eyes === "wink";

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox="0 0 200 232"
      role="img"
      aria-label={label ?? `Orbit (${state.replace(/_/g, " ")})`}
      style={{ overflow: "visible", display: "block" }}
    >
      <defs>
        {/* Glossy white shell: lit from the upper left, soft lavender shade toward the lower right */}
        <radialGradient id={`shell-${uid}`} cx="0.36" cy="0.28" r="0.8">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#F6F7FD" />
          <stop offset="0.8" stopColor="#E0E4F4" />
          <stop offset="1" stopColor="#C7CDE8" />
        </radialGradient>
        {/* Blue rim light on the shadow side */}
        <radialGradient id={`rim-${uid}`} cx="0.34" cy="0.28" r="0.84">
          <stop offset="0.8" stopColor="#8FB4FF" stopOpacity="0" />
          <stop offset="1" stopColor="#7C9DFF" stopOpacity="0.5" />
        </radialGradient>
        <radialGradient id={`limb-${uid}`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#E9EDF8" />
          <stop offset="1" stopColor="#CBD2EA" />
        </radialGradient>
        {/* Recessed edge around the screen (shadow from the shell above) */}
        <linearGradient id={`groove-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#BCC4DF" />
          <stop offset="1" stopColor="#E3E7F4" />
        </linearGradient>
        <radialGradient id={`screen-${uid}`} cx="0.5" cy="0.18" r="0.95">
          <stop offset="0" stopColor="#18244F" />
          <stop offset="0.45" stopColor="#0A1130" />
          <stop offset="1" stopColor="#03060F" />
        </radialGradient>
        {/* Diagonal glass sheen across the face screen */}
        <linearGradient id={`sheen-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.13" />
          <stop offset="0.28" stopColor="#FFFFFF" stopOpacity="0.04" />
          <stop offset="0.29" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`gloss-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`eyein-${uid}`}>
          <stop offset="0" stopColor="#050A1A" />
          <stop offset="0.55" stopColor="#08173D" />
          <stop offset="0.82" stopColor="#1442A8" />
          <stop offset="1" stopColor="#2F86F0" />
        </radialGradient>
        <radialGradient id={`eyeglow-${uid}`}>
          <stop offset="0.45" stopColor="#22D3EE" stopOpacity="0.4" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`mouth-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C2F6FF" />
          <stop offset="0.45" stopColor="#5BDDFB" />
          <stop offset="1" stopColor="#2B9BEF" />
        </linearGradient>
        <radialGradient id={`blush-${uid}`}>
          <stop offset="0" stopColor="#B79BFF" stopOpacity="0.9" />
          <stop offset="0.6" stopColor="#9F7BFF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#9F7BFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`core-${uid}`}>
          <stop offset="0" stopColor={core} stopOpacity="0.95" />
          <stop offset="1" stopColor={core} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`orb-${uid}`} cx="0.38" cy="0.32" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.35" stopColor={core === COLORS.cyan ? "#7DD3FC" : core} />
          <stop offset="1" stopColor="#2563EB" />
        </radialGradient>
        <radialGradient id={`earcap-${uid}`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#ECEAFB" />
          <stop offset="1" stopColor="#D3CFF2" />
        </radialGradient>
        <linearGradient id={`cape-${uid}`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#8D7EFB" />
          <stop offset="0.55" stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#4334B8" />
        </linearGradient>
        <linearGradient id={`scarf-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9C8FFF" />
          <stop offset="0.5" stopColor="#7262EC" />
          <stop offset="1" stopColor="#5446CF" />
        </linearGradient>
        <linearGradient id={`capefold-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2E2490" stopOpacity="0.45" />
          <stop offset="1" stopColor="#2E2490" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`badge-${uid}`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#A193FF" />
          <stop offset="0.6" stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#3F33B8" />
        </radialGradient>
        <radialGradient id={`sole-${uid}`}>
          <stop offset="0" stopColor="#E0F7FF" stopOpacity="1" />
          <stop offset="0.35" stopColor="#38BDF8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`shadow-${uid}`}>
          <stop offset="0" stopColor="#1E293B" stopOpacity="0.32" />
          <stop offset="1" stopColor="#1E293B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`ao-${uid}`}>
          <stop offset="0" stopColor="#5B6B99" stopOpacity="0.45" />
          <stop offset="1" stopColor="#5B6B99" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Hover contact shadow */}
      <ellipse cx={100} cy={226} rx={36 * shadowScale} ry={5.5 * shadowScale} fill={`url(#shadow-${uid})`} />

      <g transform={mirrored ? "translate(200 0) scale(-1 1)" : undefined}>
        {pose.extras.includes("trail") && (
          <g strokeLinecap="round">
            {[[40, 150, 12, 0.7], [44, 172, 18, 0.5], [46, 194, 24, 0.35]].map(([x, y, l, o], i) => (
              <path key={i} d={`M${x} ${y} L${x - l - 16} ${y + 4}`} stroke={COLORS.cyan} strokeWidth={4} opacity={o} />
            ))}
          </g>
        )}

        <g transform={`translate(0 ${bodyY}) rotate(${bodyRot} 100 176) translate(100 207) scale(${squashX} ${squashY}) translate(-100 -207)`}>
          {/* Cape: a small flap behind the left side and the main tail flowing out to the right */}
          <path
            d={`M84 152 C${70 - flutter * 4} ${166} ${58 - flutter * 6} ${179 + flutter * 2} ${54 - flutter * 8} ${194 - flutter * 4}
               C${64} ${198} ${74} ${194} 80 186 Z`}
            fill={`url(#cape-${uid})`} opacity={0.9}
          />
          <path
            d={`M116 150 C${142 + flutter * 6} ${158 - flutter * 4} ${158 + flutter * 14} ${180 - flutter * 6} ${168 + flutter * 18} ${200 - flutter * 8}
               C${156 + flutter * 10} ${204 - flutter * 2} ${140} ${201} 122 193 Z`}
            fill={`url(#cape-${uid})`}
          />
          <path
            d={`M126 158 C${146 + flutter * 6} ${168} ${154 + flutter * 10} ${186 - flutter * 4} ${161 + flutter * 14} ${195 - flutter * 6}`}
            stroke="#2E2490" strokeOpacity={0.3} strokeWidth={2} fill="none"
          />

          {/* Hover feet with glowing soles (drawn under the body, so they read as stubby legs) */}
          {[87, 113].map((x, i) => {
            // Hovering feet dangle and sway out of phase; flying feet tuck in and trail behind.
            const dangle = live ? Math.sin(time * 2.1 + i * 1.3) * 4 * (1 - cur.feetTuck) : 0;
            const trail = cur.feetTuck * 14;
            return (
              <g key={x} transform={`rotate(${cur.feetTuck * (i ? -18 : 18) + dangle + trail} ${x} ${feetY - 6})`}>
                <ellipse cx={x} cy={feetY + 11} rx={12 + cur.thruster * 3} ry={4.5 + cur.thruster * 4.5} fill={paint.sole}
                  opacity={0.45 + cur.thruster * 0.55} />
                <path d={`M${x - 10} ${feetY + 1} Q${x - 10} ${feetY - 10} ${x} ${feetY - 10} Q${x + 10} ${feetY - 10} ${x + 10} ${feetY + 1}
                          Q${x + 10} ${feetY + 7} ${x} ${feetY + 7} Q${x - 10} ${feetY + 7} ${x - 10} ${feetY + 1} Z`}
                  fill={paint.limb} stroke={COLORS.shellEdge} strokeWidth={0.9} />
                <ellipse cx={x} cy={feetY + 5.4} rx={7.5} ry={2} fill="#7DE3FF" opacity={0.6 + cur.thruster * 0.4} />
                <ellipse cx={x - 3} cy={feetY - 4} rx={3.6} ry={2} fill="#FFFFFF" opacity={0.85} />
              </g>
            );
          })}

          {/* Body: a small glossy egg */}
          <g transform={`translate(100 177) scale(1 ${breathe}) translate(-100 -177)`}>
            <path d="M100 143 C121 143 135 155 136 174 C137 195 121 207 100 207 C79 207 63 195 64 174 C65 155 79 143 100 143 Z"
              fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1} />
            <path d="M100 145 C119 145 132 156 133 174 C134 193 120 204 100 204 C80 204 66 193 67 174 C68 156 81 145 100 145 Z"
              fill={paint.rim} />
            <ellipse cx={82} cy={163} rx={9.5} ry={5} fill="#FFFFFF" opacity={0.85} transform="rotate(-30 82 163)" />
            {/* Soft contact shadow of the scarf on the body */}
            <ellipse cx={100} cy={160} rx={27} ry={5} fill={`url(#ao-${uid})`} opacity={0.5} />
            {/* Ambient occlusion under the head */}
            <ellipse cx={100} cy={152} rx={30} ry={7} fill={`url(#ao-${uid})`} opacity={0.6} />

            {/* Chest emblem: purple disc, white ring and the glowing triangle mark */}
            <circle cx={100} cy={181} r={16} fill={`url(#core-${uid})`} opacity={0.3 + glow * 0.45} />
            <circle cx={100} cy={181} r={11} fill={`url(#badge-${uid})`} />
            <circle cx={100} cy={181} r={10.1} fill="none" stroke="#FFFFFF" strokeOpacity={0.75 + glow * 0.2} strokeWidth={1.4} />
            <path d="M93.7 176.6 L106.3 176.6 L100 187.1 Z" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round"
              opacity={0.82 + glow * 0.18} />
            <path d="M94.1 176.8 L100 180 L105.9 176.8 M100 180 L100 186.7" stroke="#6C5CE7" strokeWidth={1.3} strokeLinecap="round" fill="none" />
            <ellipse cx={96.5} cy={175.4} rx={3.8} ry={1.7} fill="#FFFFFF" opacity={0.35} />
          </g>

          {/* Scarf wrapped around the neck, with a little knot */}
          <path d="M64 149 Q100 168 136 149 Q140 157 133 163 Q100 180 67 163 Q60 157 64 149 Z" fill={`url(#scarf-${uid})`} />
          <path d="M69 155 Q100 172 131 155" stroke="#C4BCFF" strokeOpacity={0.55} strokeWidth={1.4} fill="none" />
          <path d="M64 149 Q76 159 90 166 L79 168 Q67 162 64 149 Z" fill={`url(#capefold-${uid})`} />
          <path d={`M108 166 Q117 168 ${120 + flutter * 2} ${179 + flutter} Q113 181 106 173 Z`} fill={`url(#scarf-${uid})`} />

          {/* Arms */}
          <Arm shoulder={SHOULDER_L} angle={cur.lShoulder} elbow={lElbow} hand={pose.lHand} paint={paint} />
          <Arm shoulder={SHOULDER_R} angle={cur.rShoulder} elbow={rElbow} hand={pose.rHand} paint={paint} />

          {pose.extras.includes("keyboard") && (
            <g>
              <rect x={66} y={196} width={68} height={13} rx={4} fill={COLORS.cyan} opacity={0.2} stroke={COLORS.cyan} strokeWidth={1.2} />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect key={i} x={71} y={200} width={8} height={2.6} rx={1.2} fill={COLORS.cyan}
                  transform={`translate(${i * 10} 0)`} opacity={live ? 0.4 + 0.6 * Math.abs(Math.sin(time * 9 + i)) : 0.7} />
              ))}
            </g>
          )}
          {pose.extras.includes("tablet") && (
            <g>
              <rect x={72} y={183} width={56} height={30} rx={6} fill="#38BDF8" fillOpacity={0.18} stroke="#7DD3FC" strokeWidth={1.4} />
              <path d="M79 191 H121 M79 197 H110 M79 203 H116" stroke="#7DD3FC" strokeWidth={1.8} strokeLinecap="round" opacity={0.9} />
            </g>
          )}
          {pose.extras.includes("ripple") && live && (
            <g>
              {[0, 0.33, 0.66].map((o) => {
                const ph = (time * 1.6 + o) % 1;
                return <circle key={o} cx={tip.x} cy={tip.y} r={3 + ph * 15} fill="none" stroke={COLORS.cyan} strokeWidth={1.8} opacity={1 - ph} />;
              })}
            </g>
          )}
          {pose.extras.includes("stop_glow") && <circle cx={tip.x} cy={tip.y} r={15} fill={`url(#core-${uid})`} opacity={0.6} />}
          {pose.extras.includes("rings") && (
            <g fill="none" stroke={COLORS.violet} strokeWidth={1.6} opacity={0.7}>
              <ellipse cx={100} cy={172} rx={62} ry={13} transform={`rotate(${live ? (time * 40) % 360 : 0} 100 172)`} />
              <ellipse cx={100} cy={172} rx={56} ry={9} transform={`rotate(${live ? (-time * 55) % 360 : 30} 100 172)`} />
            </g>
          )}

          {/* Head (pivots at the neck) */}
          <g transform={`rotate(${headRot} ${NECK.x} ${NECK.y}) translate(0 ${cur.headY})`}>
            {/* Antenna */}
            <g transform={`rotate(${cur.antennaRot + beat.antenna + (live ? Math.sin(time * 2.6) * 2 : 0)} 100 32)`}>
              <path d="M100 33 L100 17" stroke="#C9CFE6" strokeWidth={3} strokeLinecap="round" />
              <circle cx={100} cy={12} r={13} fill={`url(#core-${uid})`} opacity={0.3 + glow * 0.45} />
              <circle cx={100} cy={12} r={6.2} fill={`url(#orb-${uid})`} />
              <circle cx={98} cy={10} r={1.9} fill="#FFFFFF" opacity={0.95} />
            </g>

            {/* Helmet: big, round and glossy */}
            <ellipse cx={100} cy={88} rx={66} ry={59} fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1.2} />
            <ellipse cx={100} cy={88} rx={66} ry={59} fill={paint.rim} />
            <ellipse cx={70} cy={44} rx={19} ry={8} fill="#FFFFFF" opacity={0.95} transform="rotate(-26 70 44)" />
            <ellipse cx={130} cy={39} rx={4.5} ry={2.2} fill="#FFFFFF" opacity={0.75} transform="rotate(18 130 39)" />
            <ellipse cx={100} cy={140} rx={40} ry={6} fill={`url(#ao-${uid})`} opacity={0.35} />
            {/* Rim highlight on the lit edge and a cool bounce light underneath */}
            <path d="M138 42 Q160 58 165 86" stroke="#FFFFFF" strokeOpacity={0.75} strokeWidth={2.2} strokeLinecap="round" fill="none" />
            <path d="M42 112 Q52 134 76 144" stroke="#A5B4FC" strokeOpacity={0.5} strokeWidth={2.2} strokeLinecap="round" fill="none" />

            {/* Ear discs (in front of the helmet edge) */}
            {[33, 167].map((x, i) => (
              <g key={x}>
                <ellipse cx={x + (i ? -1 : 1)} cy={92} rx={10} ry={15.5} fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1} />
                <ellipse cx={x + (i ? 0.6 : -0.6)} cy={92} rx={6.3} ry={11} fill={`url(#earcap-${uid})`} stroke="#C9C3F3" strokeWidth={1.5} />
                <ellipse cx={x + (i ? 0.6 : -0.6)} cy={92} rx={3.1} ry={6} fill={core} opacity={earGlow} />
              </g>
            ))}

            {/* Face screen: a big glossy black TV screen set into the shell */}
            <path d={SCREEN_GROOVE} fill={`url(#groove-${uid})`} />
            <path d={SCREEN} fill={`url(#screen-${uid})`} />
            <path d={SCREEN} fill={`url(#sheen-${uid})`} />
            <ellipse cx={100} cy={122} rx={36} ry={5} fill="#22D3EE" opacity={0.07} />
            <path d={SCREEN} fill="none" stroke="#000000" strokeOpacity={0.35} strokeWidth={1.2} />
            <path d="M60 72 Q68 61 86 59" stroke={`url(#gloss-${uid})`} strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.8} />

            {/* Face (shifts slightly with gaze to suggest a head turn) */}
            <g transform={`translate(${(lookX * 3.5).toFixed(2)} ${(lookY * 2.2).toFixed(2)})`}>
              <g>
                <ellipse cx={61.5} cy={104} rx={8} ry={4.6} fill={`url(#blush-${uid})`} opacity={pose.blush ? 1 : 0.7} />
                <ellipse cx={138.5} cy={104} rx={8} ry={4.6} fill={`url(#blush-${uid})`} opacity={pose.blush ? 1 : 0.7} />
              </g>
              <Eye cx={EYE_L.x} cy={EYE_L.y} shape={winkLeft ? "happy" : pose.eyes} scale={cur.eyeScale} lid={lid} lookX={lookX} lookY={lookY} pupil={pupil} uid={uid} time={live ? time : 0} phase={0} />
              <Eye cx={EYE_R.x} cy={EYE_R.y} shape={winkLeft ? "open" : pose.eyes} scale={cur.eyeScale} lid={lid} lookX={lookX} lookY={lookY} pupil={pupil} uid={uid} time={live ? time : 0} phase={1.9} />
              <Brow cx={EYE_L.x} y={browBase - cur.browAsym} tilt={cur.browTilt} side={-1} />
              <Brow cx={EYE_R.x} y={browBase + cur.browAsym * 0.4} tilt={cur.browTilt} side={1} />
              <Mouth shape={pose.mouth} open={mouthOpen} round={mouthRound} uid={uid} />
            </g>
          </g>

          {pose.extras.includes("thinking_dots") && (
            <g fill={COLORS.accent}>
              {[[156, 34, 2.6], [166, 22, 3.4], [178, 11, 4.4]].map(([x, y, r], i) => (
                <circle key={i} cx={x} cy={y} r={r} opacity={live ? 0.35 + 0.65 * Math.max(0, Math.sin(time * 3 - i)) : 0.8} />
              ))}
            </g>
          )}
          {pose.extras.includes("zz") && (
            <g fill={COLORS.accent} fontFamily="ui-sans-serif, system-ui" fontWeight={700}>
              <text x={156} y={34} fontSize={13} opacity={0.8}>z</text>
              <text x={167} y={21} fontSize={10} opacity={0.6}>z</text>
            </g>
          )}
          {pose.extras.includes("sparkles") && (
            <g fill="#8B9CFF">
              {[[26, 36], [174, 46], [22, 132], [178, 126]].map(([x, y], i) => {
                const sc = live ? 0.6 + 0.4 * Math.sin(time * 5 + i * 1.7) : 1;
                return <path key={i} transform={`translate(${x} ${y}) scale(${sc})`} d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2 Z" />;
              })}
            </g>
          )}
        </g>
      </g>
    </svg>
  );
};

export default OrbitRig;
