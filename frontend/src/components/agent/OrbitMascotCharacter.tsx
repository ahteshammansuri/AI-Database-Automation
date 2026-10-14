import React, { useEffect, useState, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import soundManager from "../../services/soundEffects";

export type CharacterState =
  | "idle"
  | "listening"
  | "transcribing"
  | "understanding"
  | "thinking"
  | "planning"
  | "navigating"
  | "pointing"
  | "working"
  | "retrieving_context"
  | "generating"
  | "validating"
  | "waiting_for_user"
  | "needs_confirmation"
  | "executing"
  | "speaking"
  | "success"
  | "complete"
  | "completed"
  | "warning"
  | "oops"
  | "paused"
  | "interrupted"
  | "error"
  | "offline"
  | "celebrate"
  | "celebration"
  | "excited"
  | "moving"
  | "flying"
  | "clicking"
  | "interacting"
  | "typing"
  | "entering_data"
  | "processing"
  | "loading"
  | "activation"
  | "cancelled"
  // Legacy uppercase variants
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "ASKING"
  | "PLANNING"
  | "WORKING"
  | "WAITING_FOR_EXTERNAL"
  | "VALIDATING"
  | "INTERRUPTING"
  | "PAUSED"
  | "SUCCEEDED"
  | "PARTIAL_SUCCESS"
  | "FAILED";

export type CharacterAngle =
  | "front"
  | "front_three_quarter"
  | "side"
  | "rear_three_quarter"
  | "back"
  | "left";

export interface OrbitMascotCharacterProps {
  state?: CharacterState;
  angle?: CharacterAngle;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showBadge?: boolean;
  interactive?: boolean;
  audioLevel?: number; // 0.0 to 1.0 for voice-reactive pulsing
  turnaround?: CharacterAngle;
  forceVectorRig?: boolean;
  playSoundOnChange?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

// Maps state string to sprite file name (All 19 verified HD 512x512 transparent PNG assets)
const STATE_SPRITE_MAP: Record<string, string> = {
  idle: "mascot-idle.png",
  listening: "mascot-listening.png",
  transcribing: "mascot-listening.png",
  understanding: "mascot-understanding.png",
  thinking: "mascot-thinking.png",
  planning: "mascot-planning.png",
  navigating: "mascot-navigating.png",
  pointing: "mascot-navigating.png",
  moving: "mascot-flying.png",
  flying: "mascot-flying.png",
  clicking: "mascot-clicking.png",
  interacting: "mascot-clicking.png",
  typing: "mascot-typing.png",
  entering_data: "mascot-typing.png",
  processing: "mascot-processing.png",
  loading: "mascot-loading.png",
  working: "mascot-working.png",
  executing: "mascot-executing.png",
  retrieving_context: "mascot-planning.png",
  generating: "mascot-working.png",
  validating: "mascot-validating.png",
  speaking: "mascot-speaking.png",
  waiting_for_user: "mascot-warning.png",
  needs_confirmation: "mascot-warning.png",
  success: "mascot-success.png",
  succeeded: "mascot-success.png",
  partial_success: "mascot-success.png",
  complete: "mascot-complete.png",
  completed: "mascot-completed.png",
  warning: "mascot-warning.png",
  oops: "mascot-warning.png",
  error: "mascot-error.png",
  failed: "mascot-error.png",
  paused: "mascot-paused.png",
  interrupted: "mascot-interrupted.png",
  cancelled: "mascot-interrupted.png",
  interrupting: "mascot-interrupted.png",
  offline: "mascot-offline.png",
  celebrate: "mascot-celebrate.png",
  celebration: "mascot-celebrate.png",
  excited: "mascot-celebrate.png",
  activation: "mascot-idle.png",
};

const MASCOT_ASSET_VERSION = "20261014_hd3";
const withAssetVersion = (filename: string) => `/mascot/${filename}?v=${MASCOT_ASSET_VERSION}`;

const ANGLE_SPRITE_MAP: Record<CharacterAngle, string> = {
  front: "angle-front.png",
  front_three_quarter: "angle-front-three-quarter.png",
  side: "angle-side.png",
  rear_three_quarter: "angle-rear-three-quarter.png",
  back: "angle-back.png",
  left: "angle-left.png",
};

const STATE_META: Record<
  string,
  {
    label: string;
    glowColor: string;
    thrustColor: string;
    badgeBg: string;
    eyeType: "normal" | "happy" | "thinking" | "scanning" | "focused" | "alert" | "sad" | "sleepy" | "offline";
  }
> = {
  idle: {
    label: "Orbit Ready",
    glowColor: "rgba(6, 182, 212, 0.4)",
    thrustColor: "#00D4FF",
    badgeBg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    eyeType: "normal",
  },
  listening: {
    label: "Listening...",
    glowColor: "rgba(6, 182, 212, 0.75)",
    thrustColor: "#00D4FF",
    badgeBg: "bg-cyan-500/25 text-cyan-200 border-cyan-400/50 animate-pulse",
    eyeType: "normal",
  },
  transcribing: {
    label: "Transcribing Speech",
    glowColor: "rgba(14, 165, 233, 0.6)",
    thrustColor: "#38bdf8",
    badgeBg: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    eyeType: "scanning",
  },
  understanding: {
    label: "Analyzing Intent",
    glowColor: "rgba(139, 92, 246, 0.65)",
    thrustColor: "#a78bfa",
    badgeBg: "bg-violet-500/20 text-violet-300 border-violet-500/30 animate-pulse",
    eyeType: "thinking",
  },
  planning: {
    label: "Structuring Plan",
    glowColor: "rgba(59, 130, 246, 0.6)",
    thrustColor: "#60a5fa",
    badgeBg: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    eyeType: "focused",
  },
  navigating: {
    label: "Navigating Portal",
    glowColor: "rgba(2, 132, 199, 0.65)",
    thrustColor: "#38bdf8",
    badgeBg: "bg-sky-500/25 text-sky-200 border-sky-400/40",
    eyeType: "focused",
  },
  moving: {
    label: "Navigating Portal",
    glowColor: "rgba(2, 132, 199, 0.65)",
    thrustColor: "#38bdf8",
    badgeBg: "bg-sky-500/25 text-sky-200 border-sky-400/40",
    eyeType: "focused",
  },
  working: {
    label: "Executing Step",
    glowColor: "rgba(16, 185, 129, 0.65)",
    thrustColor: "#34d399",
    badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse",
    eyeType: "focused",
  },
  executing: {
    label: "Executing Step",
    glowColor: "rgba(16, 185, 129, 0.65)",
    thrustColor: "#34d399",
    badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse",
    eyeType: "focused",
  },
  validating: {
    label: "Validating Constraints",
    glowColor: "rgba(147, 51, 234, 0.6)",
    thrustColor: "#c084fc",
    badgeBg: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    eyeType: "scanning",
  },
  speaking: {
    label: "Speaking",
    glowColor: "rgba(16, 185, 129, 0.65)",
    thrustColor: "#10b981",
    badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    eyeType: "happy",
  },
  waiting_for_user: {
    label: "Awaiting Input",
    glowColor: "rgba(245, 158, 11, 0.6)",
    thrustColor: "#fbbf24",
    badgeBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    eyeType: "normal",
  },
  needs_confirmation: {
    label: "Confirm Action",
    glowColor: "rgba(234, 88, 12, 0.7)",
    thrustColor: "#f97316",
    badgeBg: "bg-orange-500/20 text-orange-300 border-orange-500/40 animate-pulse",
    eyeType: "alert",
  },
  success: {
    label: "Verified & Complete",
    glowColor: "rgba(16, 185, 129, 0.75)",
    thrustColor: "#34d399",
    badgeBg: "bg-emerald-500/25 text-emerald-300 border-emerald-500/40",
    eyeType: "happy",
  },
  celebrate: {
    label: "Goal Achieved!",
    glowColor: "rgba(245, 158, 11, 0.8)",
    thrustColor: "#fde047",
    badgeBg: "bg-amber-500/25 text-amber-200 border-amber-400/50",
    eyeType: "happy",
  },
  warning: {
    label: "Attention Needed",
    glowColor: "rgba(245, 158, 11, 0.65)",
    thrustColor: "#fbbf24",
    badgeBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    eyeType: "sad",
  },
  error: {
    label: "Encountered Issue",
    glowColor: "rgba(239, 68, 68, 0.7)",
    thrustColor: "#f87171",
    badgeBg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    eyeType: "sad",
  },
  paused: {
    label: "Operation Paused",
    glowColor: "rgba(100, 116, 139, 0.5)",
    thrustColor: "#94a3b8",
    badgeBg: "bg-slate-700/40 text-slate-300 border-slate-600",
    eyeType: "sleepy",
  },
  interrupted: {
    label: "Interrupted",
    glowColor: "rgba(234, 88, 12, 0.65)",
    thrustColor: "#fb923c",
    badgeBg: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    eyeType: "alert",
  },
  offline: {
    label: "Voice Offline",
    glowColor: "rgba(71, 85, 105, 0.35)",
    thrustColor: "#475569",
    badgeBg: "bg-slate-800 text-slate-400 border-slate-700",
    eyeType: "offline",
  },
};

// Size scaling: 'md' defaults to 104px for crisp, high-DPI visibility of all details
const SIZE_MAP = {
  xs: 48,
  sm: 74,
  md: 104,
  lg: 144,
  xl: 196,
};

export const OrbitMascotCharacter: React.FC<OrbitMascotCharacterProps> = ({
  state = "idle",
  angle,
  size = "md",
  className = "",
  showBadge = false,
  interactive = false,
  audioLevel = 0,
  turnaround,
  forceVectorRig = false,
  playSoundOnChange = false,
  onClick,
  onPointerDown,
  onPointerUp,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [imageError, setImageError] = useState(false);
  const [blink, setBlink] = useState(false);
  const prevStateRef = useRef<string>(state);

  // Preload angle and behavior images into browser cache with cache buster
  useEffect(() => {
    const urls = Object.values(ANGLE_SPRITE_MAP).map((f) => withAssetVersion(f));
    Object.values(STATE_SPRITE_MAP).forEach((f) => urls.push(withAssetVersion(f)));
    urls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, []);

  // Spontaneous natural blinking
  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 3800 + Math.random() * 2200);
    return () => clearInterval(interval);
  }, []);

  const normalizedState = useMemo(() => {
    const s = state.toLowerCase();
    if (s === "thought" || s === "thought_process") return "thinking";
    if (s === "asking") return "waiting_for_user";
    if (s === "succeeded" || s === "partial_success") return "success";
    if (s === "failed") return "error";
    if (s === "interrupting" || s === "cancelled") return "interrupted";
    if (s === "waiting_for_external") return "working";
    return s;
  }, [state]);

  // Distinct procedural sound trigger on behavior state transition
  useEffect(() => {
    if (playSoundOnChange && prevStateRef.current !== normalizedState && normalizedState !== "idle") {
      soundManager.playSoundForBehavior(normalizedState);
    }
    prevStateRef.current = normalizedState;
  }, [normalizedState, playSoundOnChange]);

  const meta = STATE_META[normalizedState] || STATE_META.idle;
  const dim = SIZE_MAP[size] || 104;

  // Determine Sprite URL: prioritize active behavior when not idle, or requested angle
  const spriteFile = useMemo(() => {
    // 1. Explicit turnaround showcase prop (e.g. turnaround angle studio cards)
    if (turnaround && ANGLE_SPRITE_MAP[turnaround]) {
      return withAssetVersion(ANGLE_SPRITE_MAP[turnaround]);
    }
    // 2. If active behavior state is active (not idle), show expressive behavior sprite
    if (normalizedState && normalizedState !== "idle" && STATE_SPRITE_MAP[normalizedState]) {
      return withAssetVersion(STATE_SPRITE_MAP[normalizedState]);
    }
    // 3. Otherwise show angle view (front, 3/4, side, rear, back, left)
    if (angle && ANGLE_SPRITE_MAP[angle]) {
      return withAssetVersion(ANGLE_SPRITE_MAP[angle]);
    }
    const mapped = STATE_SPRITE_MAP[normalizedState] || "mascot-idle.png";
    return withAssetVersion(mapped);
  }, [normalizedState, angle, turnaround]);

  // Floating hover levitation physics
  const floatAnim = prefersReducedMotion
    ? {}
    : {
        y: normalizedState === "moving" ? [-2, 3, -2] : [-4, 4, -4],
        rotate: normalizedState === "listening" ? 3.5 : normalizedState === "interrupted" ? -3 : 0,
      };

  return (
    <div
      className={`relative inline-flex flex-col items-center select-none ${className} ${
        interactive ? "cursor-pointer group touch-none" : ""
      }`}
      onClick={interactive ? onClick : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`Orbit AI Assistant: ${meta.label}`}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: dim, height: dim }}
      >
        {/* Soft Ambient Levitation Thrust Glow beneath feet */}
        <motion.div
          className="absolute -bottom-1 w-3/4 h-3 rounded-full blur-[6px] pointer-events-none transition-colors duration-500"
          animate={
            prefersReducedMotion
              ? { opacity: 0.5 }
              : {
                  scale: [0.92, 1.1 + Math.min(0.25, audioLevel * 0.4), 0.92],
                  opacity: [0.45, 0.85, 0.45],
                }
          }
          transition={{
            duration: normalizedState === "listening" ? 0.9 : 2.0,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            backgroundColor: meta.thrustColor,
            boxShadow: `0 0 18px 5px ${meta.thrustColor}`,
          }}
        />

        {/* Character Visual: High-DPI Sprite or Vector Rig Fallback */}
        <motion.div
          className="relative z-10 w-full h-full flex items-center justify-center pointer-events-none"
          animate={floatAnim}
          transition={{
            duration: normalizedState === "moving" ? 1.0 : 2.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          {!imageError && !forceVectorRig ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                key={spriteFile}
                src={spriteFile}
                alt={`Orbit AI Companion Mascot (${meta.label})`}
                className="w-full h-full object-contain transition-all duration-300"
                style={{
                  filter: `drop-shadow(0 10px 16px rgba(0,0,0,0.4)) drop-shadow(0 0 14px ${meta.thrustColor}80)`,
                }}
                onError={() => setImageError(true)}
                draggable={false}
              />

              {/* Dynamic Audio Level Antenna Halo (Voice pulse) */}
              {audioLevel > 0.08 && (
                <div
                  className="absolute top-[6%] left-[49%] -translate-x-1/2 w-4 h-4 rounded-full pointer-events-none animate-ping"
                  style={{
                    backgroundColor: meta.thrustColor,
                    opacity: Math.min(0.9, audioLevel * 1.3),
                  }}
                />
              )}

              {/* Natural Eye Blink Overlay when Idle on Front View */}
              {blink && normalizedState === "idle" && (!angle || angle === "front") && (
                <div
                  className="absolute top-[32%] left-[45%] -translate-x-1/2 flex space-x-2.5 pointer-events-none"
                  style={{ transform: "scale(0.85)" }}
                >
                  <div className="w-3 h-0.5 bg-[#00D4FF] rounded-full shadow-[0_0_8px_#00D4FF]" />
                  <div className="w-3 h-0.5 bg-[#00D4FF] rounded-full shadow-[0_0_8px_#00D4FF]" />
                </div>
              )}
            </div>
          ) : (
            /* High-Fidelity Articulated SVG Rig Fallback */
            <OrbitVectorRig
              dim={dim}
              state={normalizedState}
              eyeType={meta.eyeType}
              thrustColor={meta.thrustColor}
              blink={blink}
              audioLevel={audioLevel}
              prefersReducedMotion={Boolean(prefersReducedMotion)}
            />
          )}
        </motion.div>
      </div>

      {/* Optional Compact Status Badge */}
      {showBadge && (
        <span
          className={`mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border shadow-sm transition-all duration-300 ${meta.badgeBg}`}
        >
          {meta.label}
        </span>
      )}
    </div>
  );
};

// High-Fidelity Articulated Vector Rig for Orbit (Canonical Model Representation)
interface OrbitVectorRigProps {
  dim: number;
  state: string;
  eyeType: string;
  thrustColor: string;
  blink: boolean;
  audioLevel: number;
  prefersReducedMotion: boolean;
}

const OrbitVectorRig: React.FC<OrbitVectorRigProps> = ({
  dim,
  state,
  eyeType,
  thrustColor,
  blink,
  audioLevel,
}) => {
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 100 100"
      className="overflow-visible select-none drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
    >
      <defs>
        <linearGradient id="orbitShellGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F4F7FF" />
          <stop offset="100%" stopColor="#E0E7FF" />
        </linearGradient>
        <radialGradient id="orbitScreenGrad" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#1E293B" />
          <stop offset="70%" stopColor="#0B1020" />
          <stop offset="100%" stopColor="#050811" />
        </radialGradient>
        <linearGradient id="orbitCapeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="60%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
        <radialGradient id="orbitEmblemGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#00D4FF" />
          <stop offset="90%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6366F1" />
        </radialGradient>
        <filter id="orbitGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Mini Cape (Behind Body) */}
      <path
        d="M 32 50 C 26 58 20 68 25 74 C 34 72 42 66 50 67 C 58 66 66 72 75 74 C 80 68 74 58 68 50 Z"
        fill="url(#orbitCapeGrad)"
        stroke="#4338CA"
        strokeWidth="0.8"
      />

      {/* Hover Feet with Levitation Glow */}
      <g>
        <ellipse cx="43" cy="79" rx="4.5" ry="3" fill="#E2E8F0" />
        <ellipse cx="57" cy="79" rx="4.5" ry="3" fill="#E2E8F0" />
        <ellipse cx="43" cy="81" rx="3" ry="1.5" fill={thrustColor} filter="url(#orbitGlow)" />
        <ellipse cx="57" cy="81" rx="3" ry="1.5" fill={thrustColor} filter="url(#orbitGlow)" />
      </g>

      {/* Rounded Pearl White Torso Body */}
      <rect
        x="33"
        y="48"
        width="34"
        height="30"
        rx="15"
        fill="url(#orbitShellGrad)"
        stroke="#CBD5E1"
        strokeWidth="1"
      />

      {/* Glowing Triangular AI Chest Emblem */}
      <g filter="url(#orbitGlow)">
        <circle cx="50" cy="63" r="6" fill="#1E1B4B" stroke="#6366F1" strokeWidth="0.8" />
        <polygon points="50,59 55,65 45,65" fill="url(#orbitEmblemGrad)" />
      </g>

      {/* Articulated White Arms & Hands */}
      {state === "listening" ? (
        <>
          <path d="M 33 54 C 28 60 27 68 31 71" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M 67 54 C 74 48 76 38 73 35" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
        </>
      ) : state === "success" || state === "celebrate" ? (
        <>
          <path d="M 33 54 C 24 45 22 36 26 33" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M 67 54 C 76 45 78 36 74 33" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M 33 54 C 27 60 26 67 30 70" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M 67 54 C 73 60 74 67 70 70" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
        </>
      )}

      {/* Top Antenna with Pulsing Tip */}
      <line x1="50" y1="21" x2="50" y2="13" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" />
      <circle
        cx="50"
        cy="12"
        r={2.8 + audioLevel * 1.5}
        fill={thrustColor}
        filter="url(#orbitGlow)"
      />

      {/* Rounded Side Ear Modules */}
      <circle cx="21" cy="33" r="5" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="0.8" />
      <circle cx="79" cy="33" r="5" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="0.8" />

      {/* Large Expressive Head Shell */}
      <rect
        x="23"
        y="18"
        width="54"
        height="35"
        rx="17.5"
        fill="url(#orbitShellGrad)"
        stroke="#CBD5E1"
        strokeWidth="1"
      />

      {/* Glossy Midnight Face Screen Visor */}
      <rect
        x="27"
        y="21"
        width="46"
        height="27"
        rx="13.5"
        fill="url(#orbitScreenGrad)"
      />

      {/* Digital Cyan LED Eyes & Mouth */}
      {blink ? (
        <g stroke="#00D4FF" strokeWidth="2.4" strokeLinecap="round" filter="url(#orbitGlow)">
          <line x1="38" y1="34" x2="44" y2="34" />
          <line x1="56" y1="34" x2="62" y2="34" />
        </g>
      ) : eyeType === "happy" ? (
        <g stroke="#00D4FF" strokeWidth="2.5" strokeLinecap="round" fill="none" filter="url(#orbitGlow)">
          <path d="M 37 36 Q 41 31 45 36" />
          <path d="M 55 36 Q 59 31 63 36" />
          <path d="M 47 41 Q 50 44 53 41" />
        </g>
      ) : eyeType === "thinking" ? (
        <g fill="#00D4FF" filter="url(#orbitGlow)">
          <ellipse cx="42" cy="33" rx="3.2" ry="4" />
          <line x1="56" y1="34" x2="63" y2="34" stroke="#00D4FF" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="50" cy="41" r="1.2" />
        </g>
      ) : eyeType === "sad" ? (
        <g stroke="#F87171" strokeWidth="2.4" strokeLinecap="round" fill="none" filter="url(#orbitGlow)">
          <path d="M 37 33 Q 41 37 45 33" />
          <path d="M 55 33 Q 59 37 63 33" />
          <path d="M 47 42 Q 50 40 53 42" />
        </g>
      ) : eyeType === "offline" ? (
        <g fill="#475569">
          <circle cx="41" cy="34" r="1.8" />
          <circle cx="59" cy="34" r="1.8" />
        </g>
      ) : (
        <g fill="#00D4FF" filter="url(#orbitGlow)">
          <ellipse cx="41" cy="34" rx="3.5" ry="4.5" />
          <ellipse cx="59" cy="34" rx="3.5" ry="4.5" />
          <circle cx="42" cy="32.5" r="1.2" fill="#FFFFFF" />
          <circle cx="60" cy="32.5" r="1.2" fill="#FFFFFF" />
          <path d="M 47 41 Q 50 44 53 41" stroke="#00D4FF" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </g>
      )}
    </svg>
  );
};

// Aliases for seamless drop-in backwards compatibility
export const AuraCoreCharacter = OrbitMascotCharacter;
export const OrbitalCoreCharacter = OrbitMascotCharacter;

export default OrbitMascotCharacter;
