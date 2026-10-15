import { useCallback, useRef } from "react";
import { orbitTargets } from "../services/orbitTargets";

/**
 * Register an element as a semantic Orbit target. Returns a callback ref:
 *   <button ref={useOrbitTarget("connections.add")} ...>
 */
export function useOrbitTarget<T extends HTMLElement = HTMLElement>(key: string | null | undefined) {
  const current = useRef<{ key: string; el: T } | null>(null);

  return useCallback(
    (el: T | null) => {
      if (current.current) {
        orbitTargets.unregister(current.current.key, current.current.el);
        current.current = null;
      }
      if (el && key) {
        orbitTargets.register(key, el);
        current.current = { key, el };
      }
    },
    [key]
  );
}
