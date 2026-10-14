import { useState, useEffect, useCallback, useRef } from "react";
import { useReducedMotion } from "framer-motion";

export interface MascotCoordinates {
  x: number;
  y: number;
  isDocked: boolean;
  targetAnchor: string | null;
}

export const useMascotTravel = (activeAnchor: string | null) => {
  const prefersReducedMotion = useReducedMotion();
  const [coords, setCoords] = useState<MascotCoordinates>({
    x: 0,
    y: 0,
    isDocked: true,
    targetAnchor: null,
  });

  const prevElementRef = useRef<HTMLElement | null>(null);

  // Compute docked coordinates (bottom-right of viewport)
  const getDockedCoords = useCallback(() => {
    const marginX = window.innerWidth < 640 ? 16 : 24;
    const marginY = window.innerWidth < 640 ? 16 : 24;
    const mascotSize = 104;
    return {
      x: window.innerWidth - mascotSize - marginX,
      y: window.innerHeight - mascotSize - marginY,
      isDocked: true,
      targetAnchor: null,
    };
  }, []);

  // Update target coordinates
  const updateTargetPosition = useCallback(() => {
    // If reduced motion or no target anchor, stay at dock
    if (prefersReducedMotion || !activeAnchor) {
      // Remove prior element highlight
      if (prevElementRef.current) {
        prevElementRef.current.classList.remove("ring-2", "ring-indigo-500/60", "shadow-indigo-500/20");
        prevElementRef.current = null;
      }
      setCoords(getDockedCoords());
      return;
    }

    const element = document.getElementById(activeAnchor);
    if (!element) {
      // Element not in DOM yet, keep at dock
      setCoords(getDockedCoords());
      return;
    }

    // Scroll element into view smoothly if partially out of viewport
    const rect = element.getBoundingClientRect();
    const isOutOfView =
      rect.top < 80 ||
      rect.bottom > window.innerHeight - 80 ||
      rect.left < 40 ||
      rect.right > window.innerWidth - 40;

    if (isOutOfView) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Compute comfortable placement beside target element
    const mascotDim = 64;
    let targetX = rect.left - mascotDim - 18;
    let targetY = rect.top + Math.min(24, rect.height / 3);

    // If left side would clip off-screen, place on right or top
    if (targetX < 16) {
      targetX = Math.min(window.innerWidth - mascotDim - 16, rect.right + 18);
    }
    // Vertical boundary checks
    if (targetY < 80) targetY = 80;
    if (targetY > window.innerHeight - mascotDim - 24) {
      targetY = window.innerHeight - mascotDim - 24;
    }

    // Apply temporary luminous highlight to the target section
    if (prevElementRef.current && prevElementRef.current !== element) {
      prevElementRef.current.classList.remove("ring-2", "ring-indigo-500/60", "shadow-indigo-500/20");
    }
    element.classList.add("ring-2", "ring-indigo-500/60", "shadow-indigo-500/20", "transition-all", "duration-500");
    prevElementRef.current = element;

    setCoords({
      x: targetX,
      y: targetY,
      isDocked: false,
      targetAnchor: activeAnchor,
    });
  }, [activeAnchor, prefersReducedMotion, getDockedCoords]);

  // Handle activeAnchor changes & window resizing
  useEffect(() => {
    updateTargetPosition();

    // Check again after short delay in case route navigation or DOM render takes a moment
    const timer = setTimeout(updateTargetPosition, 320);

    const handleResize = () => updateTargetPosition();
    const handleScroll = () => {
      // Update coordinates on scroll if anchored
      if (activeAnchor) updateTargetPosition();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
      if (prevElementRef.current) {
        prevElementRef.current.classList.remove("ring-2", "ring-indigo-500/60", "shadow-indigo-500/20");
      }
    };
  }, [activeAnchor, updateTargetPosition]);

  return coords;
};
