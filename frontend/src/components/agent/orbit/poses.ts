/**
 * Orbit pose library: joint targets per behaviour state.
 *
 * Angles are degrees in SVG convention (positive = clockwise on screen). Arms hang
 * down at 0°. The "primary" gesturing arm is the screen-right arm (`r*`): raising it
 * outward toward the right is negative. The rig is mirrored when Orbit faces left, so
 * gestures always point at the real target.
 */

export type EyeShape = "open" | "happy" | "closed" | "wide" | "focused" | "sad" | "squint";
export type MouthShape = "smile" | "grin" | "open" | "o" | "flat" | "frown" | "wavy" | "talk";
export type HandShape = "mitten" | "point" | "open" | "fist";
export type Motion =
  | "float" | "breathe" | "wave" | "tap" | "type" | "busy" | "scan" | "bounce" | "shake" | "nod" | "talk" | "fly" | "tilt";
export type Extra = "sparkles" | "thinking_dots" | "keyboard" | "ripple" | "zz" | "tablet" | "rings" | "trail" | "stop_glow";

export interface PoseNumbers {
  bodyY: number;
  bodyRot: number;
  headRot: number;
  headY: number;
  lookX: number;
  lookY: number;
  lid: number; // 0 open .. 1 closed
  eyeScale: number;
  mouthOpen: number; // 0..1
  lShoulder: number;
  lElbow: number;
  rShoulder: number;
  rElbow: number;
  feetTuck: number; // 0 hanging .. 1 tucked (flying)
  antennaRot: number;
  glow: number; // 0..1 antenna/core intensity
  capeFlutter: number; // 0..1
  floatAmp: number;
  thruster: number; // 0..1
}

export interface OrbitPose extends PoseNumbers {
  eyes: EyeShape;
  mouth: MouthShape;
  lHand: HandShape;
  rHand: HandShape;
  core: string; // chest/antenna light colour
  motions: Motion[];
  extras: Extra[];
  blush: boolean;
}

export const COLORS = {
  shell: "#FFFFFF",
  shellShade: "#E3E9F7",
  shellEdge: "#C9D3EA",
  screen: "#0F172A",
  screenEdge: "#1E1E2F",
  eye: "#00D4FF",
  cape: "#6C5CE7",
  capeDark: "#4B3FC2",
  accent: "#A29BFE",
  blush: "#FF8FB1",
  cyan: "#00D4FF",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  violet: "#A78BFA",
  gray: "#94A3B8",
};

const BASE: OrbitPose = {
  bodyY: 0, bodyRot: 0, headRot: 0, headY: 0, lookX: 0, lookY: 0, lid: 0, eyeScale: 1, mouthOpen: 0,
  lShoulder: 10, lElbow: 8, rShoulder: -10, rElbow: -8,
  feetTuck: 0, antennaRot: 0, glow: 0.6, capeFlutter: 0.25, floatAmp: 3, thruster: 0.5,
  eyes: "open", mouth: "smile", lHand: "mitten", rHand: "mitten", core: COLORS.cyan,
  motions: ["float", "breathe"], extras: [], blush: false,
};

const P = (o: Partial<OrbitPose>): OrbitPose => ({ ...BASE, ...o });

/** Canonical behaviour states (§26) plus legacy aliases used around the app. */
export const POSES: Record<string, OrbitPose> = {
  // Idle and awareness
  idle: P({}),
  curious: P({ headRot: 10, lookX: 0.4, mouth: "o", motions: ["float", "breathe", "tilt"] }),
  greeting: P({ rShoulder: -155, rElbow: -15, rHand: "open", eyes: "happy", mouth: "grin", blush: true, motions: ["float", "wave"] }),
  resting: P({ bodyY: 8, lid: 0.6, mouth: "flat", lShoulder: 4, rShoulder: -4, floatAmp: 1, thruster: 0.2, glow: 0.3, extras: ["zz"] }),

  // Voice
  waking: P({ eyes: "wide", headRot: -4, glow: 0.9, mouth: "o" }),
  listening: P({ bodyRot: -3, headRot: -6, lookY: 0.1, eyes: "wide", mouth: "smile", glow: 1, antennaRot: -6,
    lShoulder: 16, rShoulder: -16, motions: ["float", "breathe"] }),
  transcribing: P({ eyes: "focused", lookY: -0.2, headRot: -4, glow: 0.9, mouth: "flat", motions: ["float", "scan"] }),
  understanding: P({ eyes: "focused", lookY: -0.3, headRot: 6, mouth: "o", motions: ["float", "nod"] }),
  thinking: P({ eyes: "focused", lookX: 0.5, lookY: -0.6, headRot: 8, rShoulder: 30, rElbow: 120, rHand: "fist",
    mouth: "flat", core: COLORS.violet, glow: 0.9, extras: ["thinking_dots"], motions: ["float", "breathe"] }),
  speaking: P({ mouth: "talk", eyes: "open", rShoulder: -28, rElbow: -30, rHand: "open", motions: ["float", "talk"] }),
  interrupted: P({ eyes: "wide", mouth: "flat", headRot: 0, rShoulder: -120, rElbow: 15, rHand: "open",
    core: COLORS.amber, extras: ["stop_glow"], motions: ["float"] }),

  // Work planning and website interaction
  planning: P({ eyes: "focused", lookY: 0.5, lShoulder: -30, lElbow: -45, rShoulder: 30, rElbow: 45,
    mouth: "flat", extras: ["tablet"], motions: ["float", "breathe"] }),
  moving: P({ bodyRot: 14, headRot: -6, feetTuck: 1, thruster: 1, capeFlutter: 1, lShoulder: 35, rShoulder: -55,
    rElbow: -10, eyes: "focused", lookX: 0.8, mouth: "smile", extras: ["trail"], motions: ["fly"] }),
  arriving: P({ bodyRot: -4, feetTuck: 0.4, thruster: 0.8, capeFlutter: 0.6, eyes: "open", lookX: 0.6 }),
  pointing: P({ rShoulder: -95, rElbow: -5, rHand: "point", lookX: 0.9, eyes: "open", mouth: "smile", bodyRot: 4 }),
  clicking: P({ rShoulder: -75, rElbow: -20, rHand: "point", lookX: 0.9, lookY: 0.1, eyes: "focused", mouth: "smile",
    bodyRot: 6, extras: ["ripple"], motions: ["float", "tap"] }),
  typing: P({ lShoulder: -15, lElbow: -10, rShoulder: 15, rElbow: 10, lookY: 0.6, eyes: "focused", mouth: "flat",
    extras: ["keyboard"], motions: ["float", "type"] }),
  inspecting: P({ eyes: "squint", lookX: 0.6, headRot: 4, rShoulder: -30, rElbow: -60, mouth: "flat", motions: ["float", "scan"] }),
  waiting: P({ eyes: "open", mouth: "smile", headRot: 4, motions: ["float", "breathe"] }),
  validating: P({ eyes: "squint", lookY: 0.2, mouth: "flat", rShoulder: -35, rElbow: -70, core: COLORS.violet,
    motions: ["float", "scan"] }),
  working: P({ eyes: "focused", lookY: 0.3, mouth: "flat", lShoulder: -25, lElbow: -40, rShoulder: 25, rElbow: 40,
    glow: 0.9, motions: ["float", "busy"] }),
  processing: P({ eyes: "focused", lookY: -0.2, mouth: "flat", lShoulder: 25, rShoulder: -25, core: COLORS.violet,
    extras: ["rings"], motions: ["float", "breathe"] }),
  returning: P({ bodyRot: -10, feetTuck: 0.8, thruster: 0.9, capeFlutter: 0.8, lookX: -0.5, extras: ["trail"], motions: ["fly"] }),

  // Result states
  success: P({ eyes: "happy", mouth: "grin", blush: true, lShoulder: 140, lElbow: 20, rShoulder: -140, rElbow: -20,
    lHand: "open", rHand: "open", core: COLORS.green, glow: 1, motions: ["float", "bounce"] }),
  celebrate: P({ eyes: "happy", mouth: "grin", blush: true, lShoulder: 150, lElbow: 25, rShoulder: -150, rElbow: -25,
    lHand: "open", rHand: "open", core: COLORS.green, glow: 1, capeFlutter: 0.8, extras: ["sparkles"], motions: ["float", "bounce"] }),
  partial_success: P({ eyes: "open", mouth: "flat", rShoulder: -70, rElbow: -30, rHand: "open", core: COLORS.amber }),
  needs_input: P({ eyes: "open", headRot: 6, mouth: "smile", rShoulder: -45, rElbow: -40, rHand: "open", core: COLORS.cyan }),
  needs_confirmation: P({ eyes: "open", mouth: "flat", rShoulder: -110, rElbow: -20, rHand: "open", core: COLORS.amber,
    glow: 0.9, motions: ["float", "breathe"] }),
  warning: P({ eyes: "sad", mouth: "wavy", headRot: -6, rShoulder: -60, rElbow: -30, rHand: "open", core: COLORS.amber }),
  error: P({ eyes: "sad", mouth: "frown", headRot: -8, lShoulder: 4, rShoulder: -4, lElbow: 0, rElbow: 0, capeFlutter: 0.1,
    core: COLORS.red, glow: 0.8, motions: ["float", "shake"] }),
  paused: P({ eyes: "open", lid: 0.35, mouth: "flat", lShoulder: 6, rShoulder: -6, floatAmp: 1.5, core: COLORS.amber, glow: 0.4 }),
  cancelled: P({ eyes: "open", mouth: "flat", lShoulder: 50, lElbow: 50, lHand: "open", core: COLORS.gray, glow: 0.4 }),
  offline: P({ eyes: "closed", mouth: "flat", bodyY: 10, floatAmp: 0.6, thruster: 0.1, glow: 0.15, core: COLORS.gray,
    lShoulder: 3, rShoulder: -3, extras: ["zz"] }),
};

/** Map every state name used in the app to a pose. */
const ALIASES: Record<string, string> = {
  executing: "working",
  interacting: "clicking",
  entering_data: "typing",
  navigating: "moving",
  flying: "moving",
  generating: "working",
  retrieving_context: "processing",
  loading: "processing",
  activation: "waking",
  waiting_for_user: "needs_input",
  asking: "needs_input",
  complete: "success",
  completed: "success",
  succeeded: "success",
  celebration: "celebrate",
  excited: "celebrate",
  oops: "warning",
  failed: "error",
  interrupting: "interrupted",
  waiting_for_external: "waiting",
  thought: "thinking",
};

export function poseFor(state: string): OrbitPose {
  const key = (state || "idle").toLowerCase();
  return POSES[key] ?? POSES[ALIASES[key]] ?? POSES.idle;
}

/** Face override from the generated reply's emotion hint (allowlisted values only). */
export function applyEmotion(pose: OrbitPose, emotion?: string | null): OrbitPose {
  switch (emotion) {
    case "happy":
      return { ...pose, eyes: pose.eyes === "open" ? "happy" : pose.eyes, blush: true, mouth: pose.mouth === "talk" ? "talk" : "grin" };
    case "celebrating":
      return { ...pose, eyes: "happy", blush: true };
    case "concerned":
    case "apologetic":
      return { ...pose, eyes: "sad", headRot: pose.headRot - 4 };
    case "curious":
      return { ...pose, headRot: pose.headRot + 8 };
    case "focused":
      return { ...pose, eyes: "focused" };
    case "attentive":
      return { ...pose, eyes: "wide" };
    default:
      return pose;
  }
}

export const NUMERIC_KEYS: (keyof PoseNumbers)[] = [
  "bodyY", "bodyRot", "headRot", "headY", "lookX", "lookY", "lid", "eyeScale", "mouthOpen",
  "lShoulder", "lElbow", "rShoulder", "rElbow", "feetTuck", "antennaRot", "glow", "capeFlutter", "floatAmp", "thruster",
];
