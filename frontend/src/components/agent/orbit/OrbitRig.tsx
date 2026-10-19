import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ttsAdapter } from "../../../services/ttsAdapter";
import {
  COLORS, EyeShape, HandShape, MouthShape, NUMERIC_KEYS, OrbitPose, PoseNumbers, applyEmotion, poseFor,
} from "./poses";
import { createLipSync, motionLayers } from "./rigMotion";
import { createBlinker, createIdlePersonality } from "./rigPersonality";

/**
 * Orbit — layered, articulated SVG rig (head, face screen, eyes with pupils and lids,
 * mouth, ear pods, antenna, neck, torso, cape, chest core, two-segment arms with
 * mitten hands and fingers, hover feet). Drawn from the Orbit design sheet.
 *
 * Joints spring toward the pose for the current *real* state. Timers only drive idle
 * personality (blink, breathing, hover); mouth movement follows actual TTS playback.
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

// Proportions follow the design sheet: big wide head, small rounded body, stubby limbs.
const SHOULDER_L = { x: 67, y: 168 };
const SHOULDER_R = { x: 133, y: 168 };
const UPPER = 14;
const FORE = 13;
const NECK = { x: 100, y: 142 };
const EYE_L = { x: 79, y: 88 };
const EYE_R = { x: 121, y: 88 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (d: number) => (d * Math.PI) / 180;
/** Arm direction for an SVG rotation of the downward vector. */
const dir = (deg: number) => ({ x: -Math.sin(rad(deg)), y: Math.cos(rad(deg)) });

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

/** Mouth openness and vowel roundness, from real speech playback events. */
function useLipSync() {
  const lip = useMemo(() => createLipSync((fn) => ttsAdapter.subscribe(fn as any)), []);
  useEffect(() => lip.dispose, [lip]);
  return lip;
}

/** States where Orbit is calm and may show idle personality (glances, tilts, being petted). */
const PERSONALITY_STATES = new Set(["idle", "waiting", "needs_input", "curious"]);

// ---------------------------------------------------------------------------
// Drawing helpers (3D look from layered gradients: base shading, rim light,
// specular highlights and glow halos; no SVG blur filters, to stay cheap on CPU)
// ---------------------------------------------------------------------------

type Paint = { shell: string; rim: string; limb: string; glowCyan: string; sole: string };

const Hand: React.FC<{ shape: HandShape; paint: Paint }> = ({ shape, paint }) => {
  const edge = { stroke: COLORS.shellEdge, strokeWidth: 0.9 };
  const ball = (r: number) => (
    <g>
      <circle r={r} fill={paint.limb} {...edge} />
      <ellipse cx={-r * 0.32} cy={-r * 0.36} rx={r * 0.42} ry={r * 0.3} fill="#FFFFFF" opacity={0.85} />
    </g>
  );
  switch (shape) {
    case "point":
      return (
        <g>
          <rect x={-2} y={3} width={4} height={11} rx={2} fill={paint.limb} {...edge} />
          {ball(6.6)}
          <circle cx={-5.4} cy={-0.5} r={2.7} fill={paint.limb} {...edge} />
        </g>
      );
    case "open":
      return (
        <g>
          {[-30, 0, 30].map((a) => (
            <rect key={a} x={-1.8} y={3.5} width={3.6} height={7.5} rx={1.8} fill={paint.limb} {...edge} transform={`rotate(${a})`} />
          ))}
          {ball(7)}
          <circle cx={-6.2} cy={-1.6} r={2.6} fill={paint.limb} {...edge} />
        </g>
      );
    case "fist":
      return ball(6.8);
    default:
      return (
        <g>
          {ball(8.4)}
          <circle cx={-6.4} cy={-1.2} r={3.2} fill={paint.limb} {...edge} />
        </g>
      );
  }
};

const Arm: React.FC<{
  shoulder: { x: number; y: number }; angle: number; elbow: number; hand: HandShape; paint: Paint;
}> = ({ shoulder, angle, elbow, hand, paint }) => (
  <g transform={`translate(${shoulder.x} ${shoulder.y}) rotate(${angle})`}>
    <rect x={-7.5} y={-5} width={15} height={UPPER + 7} rx={7.5} fill={paint.limb} stroke={COLORS.shellEdge} strokeWidth={0.9} />
    <g transform={`translate(0 ${UPPER}) rotate(${elbow})`}>
      <rect x={-7} y={-3} width={14} height={FORE + 3} rx={7} fill={paint.limb} stroke={COLORS.shellEdge} strokeWidth={0.9} />
      <g transform={`translate(0 ${FORE + 3})`}>
        <Hand shape={hand} paint={paint} />
      </g>
    </g>
  </g>
);

/** Big glowing ring eyes with a blue iris and white sparkles (design-sheet style). */
function Eye({ cx, cy, shape, scale, lid, lookX, lookY, pupil, uid }: {
  cx: number; cy: number; shape: EyeShape; scale: number; lid: number; lookX: number; lookY: number; pupil: number; uid: string;
}) {
  const glow = <circle cx={cx} cy={cy} r={19 * scale} fill={`url(#eyeglow-${uid})`} />;
  const arc = { stroke: COLORS.eye, strokeWidth: 3.6, strokeLinecap: "round" as const, fill: "none" };
  if (shape === "happy") {
    return (
      <g>
        {glow}
        <path d={`M${cx - 9} ${cy + 3} Q${cx} ${cy - 9} ${cx + 9} ${cy + 3}`} {...arc} />
      </g>
    );
  }
  if (shape === "closed") {
    return <path d={`M${cx - 8.5} ${cy + 1} Q${cx} ${cy + 5.5} ${cx + 8.5} ${cy + 1}`} {...arc} opacity={0.85} />;
  }

  const r = (shape === "wide" ? 14.5 : shape === "focused" ? 12 : 13.5) * scale;
  const ry = shape === "squint" ? r * 0.45 : r;
  const ix = cx + lookX * 3.2;
  const iy = cy + lookY * 2.6;
  const ir = (shape === "focused" ? 6.8 : 8) * pupil;
  const cover = clamp(lid, 0, 1) * (ry * 2 + 2);
  // The lid's lower edge is curved like a real eyelid, not a straight shutter.
  const lidTop = cy - ry - 3;
  const lidEdge = lidTop + cover;
  return (
    <g>
      {glow}
      <ellipse cx={cx} cy={cy} rx={r} ry={ry} fill={`url(#eyeball-${uid})`} />
      <ellipse cx={ix} cy={iy} rx={ir} ry={Math.min(ir, ry * 0.85)} fill={`url(#iris-${uid})`} />
      <ellipse cx={cx} cy={cy} rx={r} ry={ry} fill="none" stroke={COLORS.eye} strokeWidth={3} />
      {ry > 7 && (
        <g fill="#FFFFFF">
          <circle cx={ix - 3.4} cy={iy - 3.6} r={3.5} />
          <circle cx={ix + 3.2} cy={iy + 3} r={1.6} opacity={0.9} />
          <circle cx={ix + 3.6} cy={iy - 4.2} r={0.9} opacity={0.75} />
        </g>
      )}
      {shape === "sad" && (
        <path d={`M${cx - r - 2} ${cy - r - 2} L${cx + r + 2} ${cy - r - 2} L${cx - r - 2} ${cy - 2} Z`} fill={`url(#screen-${uid})`} />
      )}
      {cover > 0.5 && (
        <path
          d={`M${cx - r - 3} ${lidTop} H${cx + r + 3} V${lidEdge - 2} Q${cx} ${lidEdge + Math.min(5, cover * 0.35)} ${cx - r - 3} ${lidEdge - 2} Z`}
          fill="#0A1124"
        />
      )}
    </g>
  );
}

function Mouth({ shape, open, round = 0.5 }: { shape: MouthShape; open: number; round?: number }) {
  const c = COLORS.eye;
  const s = { stroke: c, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  switch (shape) {
    case "grin":
      return <path d="M91 104 Q100 117 109 104 Q100 108 91 104 Z" fill={c} stroke={c} strokeWidth={1.5} strokeLinejoin="round" />;
    case "open":
      return <ellipse cx={100} cy={108} rx={5} ry={4} fill={c} />;
    case "talk": {
      // Wider for "ee" sounds, rounder for "oo"; small upturned corners keep it friendly.
      const rx = 3.6 + open * 1.4 + (1 - round) * 1.6;
      const ry = 1.2 + open * (3.6 + round * 1.4);
      return (
        <g>
          <ellipse cx={100} cy={108} rx={rx} ry={ry} fill={c} />
          {open > 0.45 && <ellipse cx={100} cy={108 + ry * 0.45} rx={rx * 0.55} ry={ry * 0.35} fill="#FF8FB8" opacity={0.55} />}
          <path d={`M${100 - rx - 1.6} ${107} q1 1.4 2 1.2 M${100 + rx + 1.6} ${107} q-1 1.4 -2 1.2`} stroke={c} strokeWidth={1.6} strokeLinecap="round" fill="none" />
        </g>
      );
    }
    case "o":
      return <circle cx={100} cy={108} r={3.2} {...s} />;
    case "flat":
      return <path d="M94 108 L106 108" {...s} />;
    case "frown":
      return <path d="M93 111 Q100 103 107 111" {...s} />;
    case "wavy":
      return <path d="M91 109 q3 -3 6 0 q3 3 6 0 q3 -3 6 0" {...s} />;
    default:
      return <path d="M93 105 Q100 112.5 107 105" {...s} />;
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
  const lip = useLipSync();
  const live = !reducedMotion;

  // Being "petted": the pointer resting on Orbit while it is calm makes it happy (personality only).
  const now = performance.now();
  let petted = false;
  if (live && PERSONALITY_STATES.has(state) && pointer.current && svgRef.current && now - pointer.current.at < 4000) {
    const r = svgRef.current.getBoundingClientRect();
    petted = pointer.current.x >= r.left && pointer.current.x <= r.right && pointer.current.y >= r.top && pointer.current.y <= r.bottom;
  }
  const pose = useMemo(() => {
    const base = applyEmotion(poseFor(state), state === "speaking" ? emotion : null);
    return petted ? { ...base, eyes: "happy" as EyeShape, mouth: "grin" as MouthShape, blush: true } : base;
  }, [state, emotion, petted]);
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
  const pointerFresh = !!pointer.current && now - pointer.current.at < 2500;
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

  // Idle personality: glances and curious head tilts, only when calm and not looking at anything.
  const beat = personality.sample(now, live && PERSONALITY_STATES.has(state) && !lookAt && !pointerFresh);
  lookX = clamp(lookX + beat.lookX, -1, 1);
  lookY = clamp(lookY + beat.lookY, -1, 1);
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

  const lid = Math.max(cur.lid, blinker.lid(now, live && ["open", "wide", "focused", "sad"].includes(pose.eyes)));
  const talking = pose.mouth === "talk";
  const lipLevel = lip.sample(time, talking);
  const mouthOpen = talking ? lipLevel : cur.mouthOpen;
  const mouthRound = talking ? lip.round(time) : 0.5;
  const pupil = pose.eyes === "wide" || state === "listening" || petted ? 1.12 : 1;
  const listeningGlow = state === "listening" ? clamp(audioLevel, 0, 1) : 0;
  const glow = clamp(cur.glow + listeningGlow * 0.4 + (live ? Math.sin(time * 3) * 0.06 : 0), 0, 1);
  const core = pose.core;
  const flutter = cur.capeFlutter * (live ? 0.6 + 0.4 * Math.sin(time * (2 + cur.capeFlutter * 6)) : 1);
  const feetY = 214 - cur.feetTuck * 7;
  const shadowScale = clamp(1 - (bodyY < 0 ? -bodyY / 40 : 0) - cur.feetTuck * 0.25, 0.4, 1.1);

  // Right-hand tip (for click ripples), via forward kinematics.
  const e = dir(cur.rShoulder);
  const f = dir(cur.rShoulder + rElbow);
  const reach = FORE + 3 + (pose.rHand === "point" ? 14 : 7);
  const tip = { x: SHOULDER_R.x + e.x * UPPER + f.x * reach, y: SHOULDER_R.y + e.y * UPPER + f.y * reach };

  const paint: Paint = {
    shell: `url(#shell-${uid})`,
    rim: `url(#rim-${uid})`,
    limb: `url(#limb-${uid})`,
    glowCyan: `url(#glowcyan-${uid})`,
    sole: `url(#sole-${uid})`,
  };
  const height = Math.round(width * 1.2);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox="0 0 200 240"
      role="img"
      aria-label={label ?? `Orbit (${state.replace(/_/g, " ")})`}
      style={{ overflow: "visible", display: "block" }}
    >
      <defs>
        {/* Glossy white shell: lit from the upper left, cool shade toward the lower right */}
        <radialGradient id={`shell-${uid}`} cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#F6F8FE" />
          <stop offset="0.8" stopColor="#DCE3F4" />
          <stop offset="1" stopColor="#C2CBE6" />
        </radialGradient>
        {/* Blue rim light on the shadow side */}
        <radialGradient id={`rim-${uid}`} cx="0.32" cy="0.28" r="0.82">
          <stop offset="0.78" stopColor="#8FB4FF" stopOpacity="0" />
          <stop offset="1" stopColor="#7AA2FF" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id={`limb-${uid}`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#E7ECF8" />
          <stop offset="1" stopColor="#C8D0E8" />
        </radialGradient>
        <radialGradient id={`screen-${uid}`} cx="0.5" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#1C2A52" />
          <stop offset="0.55" stopColor="#0B1430" />
          <stop offset="1" stopColor="#050915" />
        </radialGradient>
        <linearGradient id={`screenshine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`eyeball-${uid}`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#0E2A66" />
          <stop offset="1" stopColor="#06122E" />
        </radialGradient>
        <radialGradient id={`iris-${uid}`} cx="0.45" cy="0.4" r="0.65">
          <stop offset="0" stopColor="#7DEBFF" />
          <stop offset="0.55" stopColor="#22C1F0" />
          <stop offset="1" stopColor="#1D6FE0" />
        </radialGradient>
        <radialGradient id={`eyeglow-${uid}`}>
          <stop offset="0.45" stopColor="#38BDF8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`blush-${uid}`}>
          <stop offset="0" stopColor="#FF8FB8" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FF8FB8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`glowcyan-${uid}`}>
          <stop offset="0" stopColor="#A5F3FC" stopOpacity="0.95" />
          <stop offset="0.4" stopColor="#38BDF8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`core-${uid}`}>
          <stop offset="0" stopColor={core} stopOpacity="0.95" />
          <stop offset="1" stopColor={core} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`orb-${uid}`} cx="0.38" cy="0.32" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.35" stopColor={core} />
          <stop offset="1" stopColor="#2563EB" />
        </radialGradient>
        <linearGradient id={`cape-${uid}`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#8F80FA" />
          <stop offset="0.55" stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#4334B8" />
        </linearGradient>
        <linearGradient id={`capefold-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2E2490" stopOpacity="0.45" />
          <stop offset="1" stopColor="#2E2490" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`badge-${uid}`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#9C8CFF" />
          <stop offset="0.6" stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#3F33B8" />
        </radialGradient>
        <radialGradient id={`sole-${uid}`}>
          <stop offset="0" stopColor="#E0F7FF" stopOpacity="1" />
          <stop offset="0.35" stopColor="#38BDF8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`shadow-${uid}`}>
          <stop offset="0" stopColor="#1E293B" stopOpacity="0.35" />
          <stop offset="1" stopColor="#1E293B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`ao-${uid}`}>
          <stop offset="0" stopColor="#5B6B99" stopOpacity="0.45" />
          <stop offset="1" stopColor="#5B6B99" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Hover contact shadow */}
      <ellipse cx={100} cy={233} rx={40 * shadowScale} ry={6.5 * shadowScale} fill={`url(#shadow-${uid})`} />

      <g transform={mirrored ? "translate(200 0) scale(-1 1)" : undefined}>
        {pose.extras.includes("trail") && (
          <g strokeLinecap="round">
            {[[40, 150, 12, 0.7], [44, 172, 18, 0.5], [46, 194, 24, 0.35]].map(([x, y, l, o], i) => (
              <path key={i} d={`M${x} ${y} L${x - l - 16} ${y + 4}`} stroke={COLORS.cyan} strokeWidth={4} opacity={o} />
            ))}
          </g>
        )}

        <g transform={`translate(0 ${bodyY}) rotate(${bodyRot} 100 180) translate(100 214) scale(${squashX} ${squashY}) translate(-100 -214)`}>
          {/* Cape tail flowing behind (drawn first) */}
          <path
            d={`M118 150 C${142 + flutter * 6} ${158 - flutter * 4} ${158 + flutter * 14} ${180 - flutter * 6} ${168 + flutter * 18} ${204 - flutter * 8}
               C${156 + flutter * 10} ${208 - flutter * 2} ${140} ${206} 124 200 Z`}
            fill={`url(#cape-${uid})`}
          />
          <path
            d={`M126 158 C${146 + flutter * 6} ${168} ${154 + flutter * 10} ${186 - flutter * 4} ${162 + flutter * 14} ${200 - flutter * 6}`}
            stroke="#2E2490" strokeOpacity={0.35} strokeWidth={2} fill="none"
          />

          {/* Hover feet with glowing soles */}
          {[86, 114].map((x, i) => {
            // Hovering feet dangle and sway out of phase; flying feet tuck in and trail behind.
            const dangle = live ? Math.sin(time * 2.1 + i * 1.3) * 4 * (1 - cur.feetTuck) : 0;
            const trail = cur.feetTuck * 14;
            return (
            <g key={x} transform={`rotate(${cur.feetTuck * (i ? -18 : 18) + dangle + trail} ${x} ${feetY - 6})`}>
              <ellipse cx={x} cy={feetY + 12} rx={13 + cur.thruster * 3} ry={5 + cur.thruster * 5} fill={paint.sole}
                opacity={0.45 + cur.thruster * 0.55} />
              <path d={`M${x - 10} ${feetY + 2} Q${x - 10} ${feetY - 9} ${x} ${feetY - 9} Q${x + 10} ${feetY - 9} ${x + 10} ${feetY + 2}
                        Q${x + 10} ${feetY + 7} ${x} ${feetY + 7} Q${x - 10} ${feetY + 7} ${x - 10} ${feetY + 2} Z`}
                fill={paint.limb} stroke={COLORS.shellEdge} strokeWidth={0.9} />
              <ellipse cx={x} cy={feetY + 6} rx={8} ry={2.2} fill="#7DE3FF" opacity={0.6 + cur.thruster * 0.4} />
              <ellipse cx={x - 3} cy={feetY - 4} rx={4} ry={2.2} fill="#FFFFFF" opacity={0.8} />
            </g>
            );
          })}

          {/* Body: small glossy bean */}
          <g transform={`translate(100 182) scale(1 ${breathe}) translate(-100 -182)`}>
            <path d="M62 180 C62 153 81 146 100 146 C119 146 138 153 138 180 C138 203 121 213 100 213 C79 213 62 203 62 180 Z"
              fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1} />
            <path d="M68 178 C68 154 84 148 100 148 C116 148 132 154 132 178 C132 200 118 210 100 210 C82 210 68 200 68 178 Z"
              fill={paint.rim} />
            <ellipse cx={82} cy={166} rx={11} ry={6} fill="#FFFFFF" opacity={0.8} transform="rotate(-25 82 166)" />
            {/* Ambient occlusion under the head */}
            <ellipse cx={100} cy={153} rx={30} ry={7} fill={`url(#ao-${uid})`} opacity={0.6} />

            {/* Chest badge with glowing emblem */}
            <circle cx={100} cy={185} r={17} fill={`url(#core-${uid})`} opacity={0.35 + glow * 0.45} />
            <circle cx={100} cy={185} r={11.5} fill={`url(#badge-${uid})`} stroke="#B7AEFF" strokeWidth={1.4} />
            <path d="M92.5 180 L107.5 180 L100 192 Z" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinejoin="round"
              opacity={0.75 + glow * 0.25} />
            <path d="M96 182.3 L104 182.3 L100 188.6 Z" fill={core} opacity={0.6 + glow * 0.4} />
            <ellipse cx={96.5} cy={179.5} rx={4} ry={2} fill="#FFFFFF" opacity={0.45} />
          </g>

          {/* Scarf collar wrapping the neck */}
          <path d="M66 150 Q100 170 134 150 Q137 158 130 163 Q100 179 70 163 Q63 158 66 150 Z" fill={`url(#cape-${uid})`} />
          <path d="M70 156 Q100 172 130 156" stroke="#B7AEFF" strokeOpacity={0.55} strokeWidth={1.4} fill="none" />
          <path d="M66 150 Q78 160 92 166 L80 168 Q68 162 66 150 Z" fill={`url(#capefold-${uid})`} />

          {/* Arms */}
          <Arm shoulder={SHOULDER_L} angle={cur.lShoulder} elbow={lElbow} hand={pose.lHand} paint={paint} />
          <Arm shoulder={SHOULDER_R} angle={cur.rShoulder} elbow={rElbow} hand={pose.rHand} paint={paint} />

          {pose.extras.includes("keyboard") && (
            <g>
              <rect x={66} y={203} width={68} height={13} rx={4} fill={COLORS.cyan} opacity={0.2} stroke={COLORS.cyan} strokeWidth={1.2} />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect key={i} x={71} y={207} width={8} height={2.6} rx={1.2} fill={COLORS.cyan}
                  transform={`translate(${i * 10} 0)`} opacity={live ? 0.4 + 0.6 * Math.abs(Math.sin(time * 9 + i)) : 0.7} />
              ))}
            </g>
          )}
          {pose.extras.includes("tablet") && (
            <g>
              <rect x={74} y={190} width={52} height={28} rx={5} fill="#1E293B" stroke={COLORS.cyan} strokeWidth={1.4} opacity={0.95} />
              <path d="M80 198 H118 M80 204 H108 M80 210 H114" stroke={COLORS.cyan} strokeWidth={1.6} opacity={0.85} />
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
              <ellipse cx={100} cy={176} rx={64} ry={14} transform={`rotate(${live ? (time * 40) % 360 : 0} 100 176)`} />
              <ellipse cx={100} cy={176} rx={58} ry={10} transform={`rotate(${live ? (-time * 55) % 360 : 30} 100 176)`} />
            </g>
          )}

          {/* Head (pivots at the neck) */}
          <g transform={`rotate(${headRot} ${NECK.x} ${NECK.y}) translate(0 ${cur.headY})`}>
            {/* Antenna */}
            <g transform={`rotate(${cur.antennaRot + beat.antenna + (live ? Math.sin(time * 2.6) * 2 : 0)} 100 34)`}>
              <path d="M100 34 L100 16" stroke="#D3DAEC" strokeWidth={3.4} strokeLinecap="round" />
              <circle cx={100} cy={11} r={15} fill={`url(#core-${uid})`} opacity={0.35 + glow * 0.5} />
              <circle cx={100} cy={11} r={6.8} fill={`url(#orb-${uid})`} />
              <circle cx={97.8} cy={8.8} r={2} fill="#FFFFFF" opacity={0.95} />
            </g>

            {/* Ear pods (headphone style) */}
            {[34, 166].map((x, i) => (
              <g key={x}>
                <ellipse cx={x} cy={90} rx={14} ry={17} fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1} />
                <ellipse cx={x} cy={90} rx={14} ry={17} fill={paint.rim} />
                <ellipse cx={x + (i ? 2 : -2)} cy={90} rx={8} ry={10.5} fill="#E9ECFF" stroke="#B7AEFF" strokeWidth={2} />
                <ellipse cx={x + (i ? 2 : -2)} cy={90} rx={4.2} ry={6} fill={core} opacity={0.35 + glow * 0.45} />
              </g>
            ))}

            {/* Helmet: big, wide and glossy */}
            <ellipse cx={100} cy={88} rx={64} ry={58} fill={paint.shell} stroke={COLORS.shellEdge} strokeWidth={1.2} />
            <ellipse cx={100} cy={88} rx={64} ry={58} fill={paint.rim} />
            <ellipse cx={72} cy={46} rx={20} ry={9} fill="#FFFFFF" opacity={0.9} transform="rotate(-24 72 46)" />
            <ellipse cx={128} cy={41} rx={5} ry={2.6} fill="#FFFFFF" opacity={0.7} transform="rotate(18 128 41)" />

            {/* Face screen */}
            <rect x={48} y={56} width={104} height={74} rx={36} fill="#0A1124" />
            <rect x={51} y={59} width={98} height={68} rx={33} fill={`url(#screen-${uid})`} stroke="#33437A" strokeWidth={1.4} />
            <rect x={51} y={59} width={98} height={68} rx={33} fill="none" stroke="#38BDF8" strokeOpacity={0.18} strokeWidth={4} />
            <path d="M64 70 Q84 61 110 62" stroke={`url(#screenshine-${uid})`} strokeWidth={5} strokeLinecap="round" fill="none" />

            {/* Face (shifts slightly with gaze to suggest a head turn) */}
            <g transform={`translate(${lookX * 4} ${lookY * 2.5})`}>
              <Eye cx={EYE_L.x} cy={EYE_L.y} shape={pose.eyes} scale={cur.eyeScale} lid={lid} lookX={lookX} lookY={lookY} pupil={pupil} uid={uid} />
              <Eye cx={EYE_R.x} cy={EYE_R.y} shape={pose.eyes} scale={cur.eyeScale} lid={lid} lookX={lookX} lookY={lookY} pupil={pupil} uid={uid} />
              <g opacity={pose.blush ? 1 : 0.55}>
                <ellipse cx={63} cy={106} rx={9} ry={5} fill={`url(#blush-${uid})`} />
                <ellipse cx={137} cy={106} rx={9} ry={5} fill={`url(#blush-${uid})`} />
              </g>
              <Mouth shape={pose.mouth} open={mouthOpen} round={mouthRound} />
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
