import { useEffect, useRef, useState } from "react";
import { orbitStage, OrbitGesture } from "../services/orbitStage";
import { orbitTargets } from "../services/orbitTargets";

export interface MascotPlacement {
  x: number;
  y: number;
  isDocked: boolean;
  targetKey: string | null;
  /** Which way Orbit faces when it is beside a target. */
  facing: "left" | "right";
  /** Centre of the current target in viewport coordinates (for gaze/pointing). */
  lookAt: { x: number; y: number } | null;
  gesture: OrbitGesture | null;
  inTransit: boolean;
}

export const MASCOT_BOX = { width: 120, height: 152 };
const HIGHLIGHT = ["ring-2", "ring-cyan-400/70", "ring-offset-2", "ring-offset-transparent"];

function dock(): Pick<MascotPlacement, "x" | "y"> {
  const margin = window.innerWidth < 640 ? 12 : 24;
  return { x: window.innerWidth - MASCOT_BOX.width - margin, y: window.innerHeight - MASCOT_BOX.height - margin };
}

/** Place Orbit beside (never on top of) the target, inside the viewport. */
function besideTarget(rect: DOMRect): Pick<MascotPlacement, "x" | "y" | "facing"> {
  const gap = 14;
  const roomLeft = rect.left - MASCOT_BOX.width - gap;
  const roomRight = window.innerWidth - rect.right - MASCOT_BOX.width - gap;
  let x: number;
  let facing: "left" | "right";
  if (roomRight >= 8) {
    x = rect.right + gap;
    facing = "left";
  } else if (roomLeft >= 8) {
    x = roomLeft;
    facing = "right";
  } else {
    x = Math.min(window.innerWidth - MASCOT_BOX.width - 8, Math.max(8, rect.left));
    facing = "left";
  }
  let y = rect.top + rect.height / 2 - MASCOT_BOX.height / 2;
  if (roomRight < 8 && roomLeft < 8) {
    y = rect.bottom + gap; // no side room: hover just below
  }
  y = Math.min(window.innerHeight - MASCOT_BOX.height - 8, Math.max(64, y));
  return { x, y, facing };
}

/**
 * Orbit's position follows real runtime events (orbitStage): travel to a registered
 * target before a UI action runs, gesture while it runs, return to the dock after.
 */
export const useMascotTravel = (): MascotPlacement => {
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [gesture, setGesture] = useState<OrbitGesture | null>(null);
  const [inTransit, setInTransit] = useState(false);
  const [, setTick] = useState(0);
  const highlighted = useRef<HTMLElement | null>(null);
  const timers = useRef<{ gesture?: any; transit?: any }>({});

  useEffect(() => {
    return orbitStage.subscribe((e) => {
      if (e.type === "travel") {
        const el = orbitTargets.get(e.target);
        if (!el) return; // never travel toward something that is not really there
        const r = el.getBoundingClientRect();
        if (r.top < 64 || r.bottom > window.innerHeight - 24) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setTargetKey(e.target);
        setInTransit(true);
        clearTimeout(timers.current.transit);
        timers.current.transit = setTimeout(() => setInTransit(false), 600);
      } else if (e.type === "gesture") {
        setGesture(e.gesture);
        clearTimeout(timers.current.gesture);
        timers.current.gesture = setTimeout(() => setGesture(null), e.gesture === "type" ? 1400 : 800);
      } else if (e.type === "return") {
        setTargetKey(null);
        setGesture(null);
        setInTransit(true);
        clearTimeout(timers.current.transit);
        timers.current.transit = setTimeout(() => setInTransit(false), 600);
      }
    });
  }, []);

  // Re-measure on scroll/resize/target registry changes.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, { passive: true, capture: true });
    const unsub = orbitTargets.subscribe(bump);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, { capture: true } as any);
      unsub();
    };
  }, []);

  // Highlight the real element Orbit is working on.
  const el = targetKey ? orbitTargets.get(targetKey) : null;
  useEffect(() => {
    if (highlighted.current && highlighted.current !== el) {
      highlighted.current.classList.remove(...HIGHLIGHT);
      highlighted.current = null;
    }
    if (el) {
      el.classList.add(...HIGHLIGHT);
      highlighted.current = el;
    }
  }, [el]);

  useEffect(() => () => {
    highlighted.current?.classList.remove(...HIGHLIGHT);
    clearTimeout(timers.current.gesture);
    clearTimeout(timers.current.transit);
  }, []);

  if (typeof window === "undefined") {
    return { x: 0, y: 0, isDocked: true, targetKey: null, facing: "left", lookAt: null, gesture: null, inTransit: false };
  }

  if (el) {
    const rect = el.getBoundingClientRect();
    const place = besideTarget(rect);
    return {
      ...place,
      isDocked: false,
      targetKey,
      lookAt: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      gesture,
      inTransit,
    };
  }

  return { ...dock(), isDocked: true, targetKey: null, facing: "left", lookAt: null, gesture, inTransit };
};
