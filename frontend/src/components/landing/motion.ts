import { useEffect, useState } from "react";
import type { Variants } from "framer-motion";

/** Shared easing for the landing page: fast start, long soft settle. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

/** Cycles 0..count-1 every `ms` while `active` (for looping product demos). */
export function useCycle(count: number, ms: number, active = true): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms, active]);
  return i;
}
