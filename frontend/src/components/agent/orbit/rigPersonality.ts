/**
 * Idle personality for Orbit (blinking, glances, head tilts). Timer-driven on purpose: these are
 * only used in calm states, never to suggest work that is not happening. No imports, so both
 * renderers and the node test runner can load it directly.
 */

/**
 * Natural blinking (idle personality only): the lid closes in ~70 ms, holds briefly and opens in
 * ~110 ms; about one blink in five is a double blink. `lid` is 0 (open) .. 1 (closed).
 */
export function createBlinker(random: () => number = Math.random) {
  const CLOSE = 70, HOLD = 40, OPEN = 110;
  const gap = () => 2600 + random() * 3600;
  let start = performance.now() + gap();
  let pendingDouble = false;
  const lid = (now: number, enabled: boolean): number => {
    if (!enabled) return 0;
    let t = now - start;
    if (t > CLOSE + HOLD + OPEN) {
      if (pendingDouble) {
        pendingDouble = false;
        start = now + 120;
      } else {
        pendingDouble = random() < 0.2;
        start = now + (pendingDouble ? 0 : gap());
      }
      t = now - start;
    }
    if (t < 0) return 0;
    if (t < CLOSE) return t / CLOSE;
    if (t < CLOSE + HOLD) return 1;
    return Math.max(0, 1 - (t - CLOSE - HOLD) / OPEN);
  };
  return {
    lid,
    closed(now: number, enabled: boolean): boolean {
      return lid(now, enabled) > 0.5;
    },
  };
}

export interface IdleBeat {
  /** Extra gaze offset (-1..1). */
  lookX: number;
  lookY: number;
  /** Extra head tilt in degrees. */
  headRot: number;
  /** Antenna wobble in degrees (a little boing after a tilt). */
  antenna: number;
  /** 0..1: a brief happy smile (eyes squeeze shut, blush) now and then. */
  smile: number;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Pet-like idle personality while Orbit is calm and not working on anything: every few seconds it
 * glances to one side, tilts its head curiously or smiles for a moment, then settles. Only used in idle-type states, so
 * the character never pretends to work.
 */
export function createIdlePersonality(random: () => number = Math.random) {
  type Act = { kind: "glance" | "tilt" | "smile"; start: number; dur: number; dir: number; up: number };
  let act: Act | null = null;
  let next = performance.now() + 2500 + random() * 3000;
  return {
    sample(now: number, enabled: boolean): IdleBeat {
      const none = { lookX: 0, lookY: 0, headRot: 0, antenna: 0, smile: 0 };
      if (!enabled) {
        act = null;
        next = Math.max(next, now + 1500);
        return none;
      }
      if (!act && now >= next) {
        const r = random();
        const kind = r < 0.5 ? "glance" : r < 0.82 ? "tilt" : "smile";
        act = {
          kind,
          start: now,
          dur: kind === "glance" ? 900 + random() * 700 : kind === "tilt" ? 1400 + random() * 600 : 1100 + random() * 500,
          dir: random() < 0.5 ? -1 : 1,
          up: random() * 0.4 - 0.2,
        };
      }
      if (!act) return none;
      const t = (now - act.start) / act.dur;
      if (t >= 1) {
        act = null;
        next = now + 4000 + random() * 5000;
        return none;
      }
      // Ease in over the first 25%, hold, ease out over the last 25%.
      const w = Math.min(ease(t / 0.25), ease((1 - t) / 0.25));
      if (act.kind === "glance") return { lookX: act.dir * 0.75 * w, lookY: act.up * w, headRot: act.dir * 2 * w, antenna: 0, smile: 0 };
      if (act.kind === "smile") return { lookX: 0, lookY: -0.1 * w, headRot: act.dir * 3 * w, antenna: -act.dir * 2 * w, smile: w };
      const settle = t > 0.75 ? Math.sin((t - 0.75) * 40) * 6 * (1 - t) * 4 : 0;
      return { lookX: act.dir * 0.3 * w, lookY: -0.15 * w, headRot: act.dir * 7 * w, antenna: -act.dir * 5 * w + settle, smile: 0 };
    },
  };
}

/**
 * Micro-saccades: tiny, quick eye movements every second or two while Orbit is calm, so its gaze
 * looks alive instead of frozen. Offsets are small (well under a glance) and stop when disabled.
 */
export function createSaccades(random: () => number = Math.random) {
  let next = 0;
  let x = 0;
  let y = 0;
  return {
    sample(now: number, enabled: boolean): { x: number; y: number } {
      if (!enabled) {
        x = 0;
        y = 0;
        next = now + 600;
        return { x: 0, y: 0 };
      }
      if (now >= next) {
        x = (random() - 0.5) * 0.14;
        y = (random() - 0.5) * 0.1;
        next = now + 900 + random() * 1800;
      }
      return { x, y };
    },
  };
}
