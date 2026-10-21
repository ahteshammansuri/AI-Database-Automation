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

/** Gap between docked Orbit and the viewport corner. */
export function dockMargin(): number {
  return window.innerWidth < 640 ? 12 : 24;
}

/** Distance from the viewport bottom that keeps a panel clear of docked Orbit (never underneath it). */
export function dockClearance(gap = 10): number {
  return dockMargin() + MASCOT_BOX.height + gap;
}

function dock(): Pick<MascotPlacement, "x" | "y"> {
  const margin = dockMargin();
  return { x: window.innerWidth - MASCOT_BOX.width - margin, y: window.innerHeight - MASCOT_BOX.height - margin };
}

/** The box Orbit should stand beside: a heading's actual text, not its full-width block. */
function targetRect(el: HTMLElement): DOMRect {
  if (/^H[1-4]$/.test(el.tagName)) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    if (text.width > 0) return text;
  }
  return el.getBoundingClientRect();
}

/** Targets inside the page content keep Orbit inside the content area (never over the navigation). */
function boundsFor(el: HTMLElement): { left: number; right: number } {
  const main = el.closest("main");
  if (!main) return { left: 0, right: window.innerWidth };
  const r = main.getBoundingClientRect();
  return { left: Math.max(0, r.left), right: Math.min(window.innerWidth, r.right) };
}

/** Place Orbit beside (never on top of) the target, inside its area of the viewport. */
function besideTarget(rect: DOMRect, bounds = { left: 0, right: window.innerWidth }): Pick<MascotPlacement, "x" | "y" | "facing"> {
  const gap = 14;
  const roomLeft = rect.left - bounds.left - MASCOT_BOX.width - gap;
  const roomRight = bounds.right - rect.right - MASCOT_BOX.width - gap;
  let x: number;
  let facing: "left" | "right";
  if (roomRight >= 8) {
    x = rect.right + gap;
    facing = "left";
  } else if (roomLeft >= 8) {
    x = rect.left - MASCOT_BOX.width - gap;
    facing = "right";
  } else {
    x = Math.min(bounds.right - MASCOT_BOX.width - 8, Math.max(bounds.left + 8, rect.left));
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
  /** Where Orbit was last placed (to know whether a new target needs any flight at all). */
  const lastPlacement = useRef<{ x: number; y: number } | null>(null);
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
        // Safety net only: the flight normally ends with the "arrived" event from the animation.
        timers.current.transit = setTimeout(() => setInTransit(false), 2500);
        const next = besideTarget(targetRect(el), boundsFor(el));
        const last = lastPlacement.current;
        if (last && Math.hypot(next.x - last.x, next.y - last.y) < 4) {
          // Already there: nothing will animate, so announce the arrival now.
          setTimeout(() => orbitStage.emit({ type: "arrived", target: e.target }), 0);
        }
      } else if (e.type === "arrived") {
        setInTransit(false);
        clearTimeout(timers.current.transit);
      } else if (e.type === "gesture") {
        setGesture(e.gesture);
        clearTimeout(timers.current.gesture);
        timers.current.gesture = setTimeout(() => setGesture(null), e.gesture === "type" ? 1400 : 800);
      } else if (e.type === "return") {
        setTargetKey(null);
        setGesture(null);
        setInTransit(true);
        clearTimeout(timers.current.transit);
        timers.current.transit = setTimeout(() => setInTransit(false), 2500);
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

  let placement: MascotPlacement;
  if (typeof window === "undefined") {
    placement = { x: 0, y: 0, isDocked: true, targetKey: null, facing: "left", lookAt: null, gesture: null, inTransit: false };
  } else if (el) {
    const rect = targetRect(el);
    placement = {
      ...besideTarget(rect, boundsFor(el)),
      isDocked: false,
      targetKey,
      lookAt: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      gesture,
      inTransit,
    };
  } else {
    placement = { ...dock(), isDocked: true, targetKey: null, facing: "left", lookAt: null, gesture, inTransit };
  }

  // Remember where Orbit was put; the next "travel" event uses it to know whether any flight is needed.
  const { x, y } = placement;
  useEffect(() => {
    lastPlacement.current = { x, y };
  }, [x, y]);

  return placement;
};
