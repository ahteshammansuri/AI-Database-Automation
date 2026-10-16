import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Open/close state for a trigger + floating panel: closes on outside click and Escape, and picks
 * left or right alignment so the panel never overflows the viewport on narrow screens.
 */
export function usePopover(panelWidth = 320) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setAlignRight(rect.left + Math.min(panelWidth, vw - 32) > vw - 16 && rect.right - panelWidth >= 16);
    setOpenUp(rect.bottom + 380 > vh && rect.top > 400);
  }, [panelWidth]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }, [place]);

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  const panelPosition = `${alignRight ? "right-0" : "left-0"} ${openUp ? "bottom-full mb-2" : "top-full mt-2"}`;

  return { open, setOpen, toggle, close, rootRef, triggerRef, panelPosition };
}
