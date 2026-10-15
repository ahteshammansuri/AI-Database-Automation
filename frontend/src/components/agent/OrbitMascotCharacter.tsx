import React, { Suspense, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import soundManager from "../../services/soundEffects";
import { OrbitRig } from "./orbit/OrbitRig";
import { chooseRenderer, webglAvailable } from "./orbit3d/rendererChoice";

// Three.js loads lazily: the SVG Orbit shows instantly and the 3D one replaces it when ready.
const Orbit3D = React.lazy(() => import("./orbit3d/Orbit3D"));

const HAS_WEBGL = typeof window !== "undefined" && webglAvailable();

export type CharacterState =
  | "idle"
  | "curious"
  | "greeting"
  | "resting"
  | "waking"
  | "arriving"
  | "inspecting"
  | "returning"
  | "waiting"
  | "needs_input"
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
  /** Accepted for compatibility; the articulated rig turns via `facing`/gaze instead of sprite angles. */
  angle?: CharacterAngle;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Real microphone level 0..1 (listening glow). */
  audioLevel?: number;
  /** Side of the active target; Orbit mirrors so gestures point at it. */
  facing?: "left" | "right";
  /** Viewport point Orbit should look at (the element it is working on). */
  lookAt?: { x: number; y: number } | null;
  /** Allowlisted emotion hint from the generated reply (applied while speaking). */
  emotion?: string | null;
  playSoundOnChange?: boolean;
  onClick?: () => void;
}

const SIZE_MAP = { xs: 48, sm: 64, md: 100, lg: 140, xl: 190 };

/**
 * Orbit's character. Renders the layered SVG rig (see orbit/OrbitRig.tsx);
 * the old per-state PNG sprites are no longer used for the live character.
 */
export const OrbitMascotCharacter: React.FC<OrbitMascotCharacterProps> = ({
  state = "idle",
  size = "md",
  className = "",
  audioLevel = 0,
  facing,
  lookAt = null,
  emotion = null,
  playSoundOnChange = false,
  onClick,
}) => {
  const reduced = Boolean(useReducedMotion());
  // Real-time 3D for the main character; small avatars (panel header, banner) stay SVG so the
  // page never holds more than a couple of WebGL contexts.
  const Renderer = chooseRenderer(size, HAS_WEBGL) === "3d" ? Orbit3D : OrbitRig;
  const normalized = String(state).toLowerCase();
  const prev = useRef(normalized);

  useEffect(() => {
    if (playSoundOnChange && prev.current !== normalized && normalized !== "idle") {
      soundManager.playSoundForBehavior(normalized);
    }
    prev.current = normalized;
  }, [normalized, playSoundOnChange]);

  const rigProps = {
    state: normalized,
    width: SIZE_MAP[size] ?? 100,
    audioLevel,
    facing,
    lookAt,
    emotion,
    followPointer: size !== "xs",
    reducedMotion: reduced,
  };

  return (
    <div className={`inline-flex items-end justify-center ${className}`} onClick={onClick}>
      {Renderer === OrbitRig ? (
        <OrbitRig {...rigProps} />
      ) : (
        <Suspense fallback={<OrbitRig {...rigProps} />}>
          <Orbit3D {...rigProps} />
        </Suspense>
      )}
    </div>
  );
};

export const AuraCoreCharacter = OrbitMascotCharacter;
export const OrbitalCoreCharacter = OrbitMascotCharacter;

export default OrbitMascotCharacter;
