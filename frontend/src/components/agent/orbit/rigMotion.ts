/**
 * Renderer-independent motion for Orbit (shared by the 3D model). Springs joint values
 * toward the pose for the current real state and layers idle/gesture motion on top.
 * Timers here only drive idle personality and gesture rhythm; which pose is active always
 * comes from real runtime state.
 */
import { NUMERIC_KEYS, OrbitPose, PoseNumbers } from "./poses";

export function pickNumbers(p: OrbitPose): PoseNumbers {
  const out = {} as PoseNumbers;
  NUMERIC_KEYS.forEach((k) => (out[k] = p[k]));
  return out;
}

/** Critically-damped-ish approach of every joint value toward its target. Returns true while moving. */
export function stepSprings(cur: PoseNumbers, target: OrbitPose, dt: number, reduced: boolean): boolean {
  const k = reduced ? 1 : 1 - Math.exp(-dt * 9);
  let moving = false;
  for (const key of NUMERIC_KEYS) {
    const diff = target[key] - cur[key];
    if (Math.abs(diff) > 0.001) moving = true;
    cur[key] += diff * k;
  }
  return moving;
}

export interface MotionFrame {
  bodyY: number;
  bodyRot: number;
  headRot: number;
  lElbow: number;
  rElbow: number;
  breathe: number;
  lookX: number;
  lookY: number;
}

/** Procedural motion layers (hover, breathing, wave, tap, typing, nod, bounce, shake...). */
export function motionLayers(
  pose: OrbitPose,
  cur: PoseNumbers,
  time: number,
  elapsed: number,
  live: boolean,
  gaze: { x: number; y: number } | null,
): MotionFrame {
  const m = new Set(pose.motions);
  const f: MotionFrame = {
    bodyY: cur.bodyY, bodyRot: cur.bodyRot, headRot: cur.headRot,
    lElbow: cur.lElbow, rElbow: cur.rElbow, breathe: 1,
    lookX: gaze ? gaze.x : cur.lookX, lookY: gaze ? gaze.y : cur.lookY,
  };
  if (!live) return f;
  const tau = Math.PI * 2;
  if (m.has("float")) f.bodyY += Math.sin(time * 2.1) * cur.floatAmp;
  if (m.has("fly")) f.bodyY += Math.sin(time * 6) * 1.5;
  if (m.has("breathe")) {
    f.breathe = 1 + Math.sin(time * 1.4) * 0.014;
    // Relaxed arms sway a little, out of phase, like a pet at rest.
    f.lElbow += Math.sin(time * 1.1) * 3;
    f.rElbow += Math.sin(time * 1.1 + 1.4) * 3;
  }
  if (m.has("wave")) f.rElbow += Math.sin(time * tau * 2.4) * 26;
  if (m.has("tap")) f.rElbow += -Math.max(0, Math.sin(time * tau * 2.6)) * 22;
  if (m.has("type")) {
    f.lElbow += Math.sin(time * tau * 5) * 10;
    f.rElbow += Math.sin(time * tau * 5 + Math.PI) * 10;
  }
  if (m.has("busy")) {
    f.lElbow += Math.sin(time * tau * 1.8) * 14;
    f.rElbow -= Math.sin(time * tau * 1.8 + 1) * 14;
  }
  if (m.has("scan") && !gaze) f.lookX = Math.sin(time * tau * 0.7) * 0.8;
  if (m.has("nod")) f.headRot += Math.sin(time * tau * 1.3) * 3;
  if (m.has("tilt")) f.headRot += Math.sin(time * 0.9) * 2;
  if (m.has("bounce")) f.bodyY -= Math.abs(Math.sin(elapsed * tau * 1.7)) * 8 * Math.exp(-elapsed * 1.4);
  if (m.has("shake")) f.headRot += Math.sin(elapsed * tau * 6) * 5 * Math.exp(-elapsed * 2.5);
  if (m.has("talk")) {
    f.rElbow += Math.sin(time * 2.3) * 8;
    f.headRot += Math.sin(time * 1.7) * 1.5;
  }
  return f;
}

/**
 * Mouth openness from real TTS playback events (word boundaries; articulation only while audio
 * plays). The level follows a soft attack/decay envelope so the lips move smoothly, and `round`
 * varies slowly so the mouth alternates between wider and rounder shapes like real vowels.
 */
export function createLipSync(subscribe: (fn: (e: { type: string }) => void) => () => void) {
  let level = 0;
  let target = 0;
  let playing = false;
  let lastBoundary = 0;
  let lastSample = 0;
  const unsubscribe = subscribe((e) => {
    if (e.type === "start") {
      playing = true;
      lastBoundary = 0;
    } else if (e.type === "boundary") {
      target = 0.75 + Math.random() * 0.25;
      lastBoundary = performance.now();
    } else {
      playing = false;
    }
  });
  return {
    sample(time: number, active: boolean): number {
      const now = performance.now();
      const dt = Math.min(0.1, lastSample ? (now - lastSample) / 1000 : 0.033);
      lastSample = now;
      if (!active || !playing) {
        target = 0;
      } else if (lastBoundary && now - lastBoundary < 260) {
        target = Math.max(target * Math.exp(-dt * 6), 0.3);
      } else if (!lastBoundary) {
        // Voice without word-boundary events: a syllable-like rhythm while audio is really playing.
        target = 0.25 + 0.5 * Math.abs(Math.sin(time * 11)) * (0.6 + 0.4 * Math.abs(Math.sin(time * 3.1)));
      } else {
        target = Math.max(target * Math.exp(-dt * 8), 0.2);
      }
      const rate = target > level ? 28 : 14; // open fast, close a bit slower
      level += (target - level) * (1 - Math.exp(-dt * rate));
      return level;
    },
    /** 0 = wide ("ee"), 1 = round ("oo"); only meaningful while talking. */
    round(time: number): number {
      return 0.5 + 0.5 * Math.sin(time * 4.3) * Math.sin(time * 1.7 + 0.6);
    },
    dispose: unsubscribe,
  };
}

export { createBlinker, createIdlePersonality } from "./rigPersonality";
export type { IdleBeat } from "./rigPersonality";
