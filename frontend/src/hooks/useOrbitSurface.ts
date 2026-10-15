import { useEffect, useRef } from "react";
import { orbitSurfaces, SurfaceHandle } from "../services/orbitSurfaces";

/**
 * Register a catalogued surface for Orbit. `build` is re-read on every call, so handlers
 * always see the page's latest state (no stale closures):
 *
 *   useOrbitSurface("connections.form", () => ({ isOpen: () => showModal, fields: {...}, actions: {...} }));
 */
export function useOrbitSurface(id: string, build: () => SurfaceHandle, enabled = true): void {
  const ref = useRef(build);
  ref.current = build;

  useEffect(() => {
    if (!enabled) return;
    return orbitSurfaces.register(id, () => ref.current());
  }, [id, enabled]);
}
