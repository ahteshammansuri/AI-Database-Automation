import { useEffect, useRef, useState } from "react";

/**
 * Open/close state for a picker's dropdown: closes on a click outside, and opens upwards when there is not enough
 * room below the trigger (pickers near the bottom of a dialog stay visible).
 */
export function useDropdown<T extends HTMLElement = HTMLDivElement>(menuHeight = 340) {
  const box = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (next?: boolean) => {
    const want = next ?? !open;
    if (want && box.current) {
      const r = box.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < menuHeight && r.top > window.innerHeight - r.bottom);
    }
    setOpen(want);
  };

  return { box, open, up, toggle, close: () => setOpen(false) };
}
