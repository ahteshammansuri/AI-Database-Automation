import React, { useRef, useState, useCallback, useEffect } from "react";

export interface UsePressAndHoldOptions {
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onTap: () => void;
  holdThresholdMs?: number;
  startOnDown?: boolean;
}

export interface UsePressAndHoldReturn {
  isHolding: boolean;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onClick: (e: React.MouseEvent) => void;
  };
}

export const usePressAndHold = ({
  onHoldStart,
  onHoldEnd,
  onTap,
  holdThresholdMs = 250,
  startOnDown = false,
}: UsePressAndHoldOptions): UsePressAndHoldReturn => {
  const [isHolding, setIsHolding] = useState<boolean>(false);
  const pointerDownTimeRef = useRef<number>(0);
  const isPointerDownRef = useRef<boolean>(false);
  const isHoldRecognizedRef = useRef<boolean>(false);
  const holdTimerRef = useRef<any>(null);
  const preventClickTimeoutRef = useRef<any>(null);
  const preventClickRef = useRef<boolean>(false);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (preventClickTimeoutRef.current) clearTimeout(preventClickTimeoutRef.current);
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Primary mouse button (0) or touch only
      if (e.button !== 0) return;

      // Capture pointer so dragging slightly off button doesn't drop pointerup
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignored if capture unsupported
      }

      pointerDownTimeRef.current = Date.now();
      isPointerDownRef.current = true;
      isHoldRecognizedRef.current = false;
      preventClickRef.current = false;

      if (startOnDown) {
        // Immediate start mode (e.g. push-to-talk voice button):
        // Show holding state & start microphone immediately so 0 audio is clipped
        setIsHolding(true);
        onHoldStart();

        holdTimerRef.current = setTimeout(() => {
          if (isPointerDownRef.current) {
            isHoldRecognizedRef.current = true;
          }
        }, holdThresholdMs);
      } else {
        // Delayed start mode (e.g. mascot toggle):
        // Only trigger hold if pointer remains down >= threshold
        holdTimerRef.current = setTimeout(() => {
          if (isPointerDownRef.current) {
            isHoldRecognizedRef.current = true;
            setIsHolding(true);
            onHoldStart();
          }
        }, holdThresholdMs);
      }
    },
    [onHoldStart, holdThresholdMs, startOnDown]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDownRef.current) return;
      isPointerDownRef.current = false;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      const duration = Date.now() - pointerDownTimeRef.current;
      setIsHolding(false);

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }

      // Mark preventClick so trailing synthetic click event is always swallowed
      preventClickRef.current = true;
      if (preventClickTimeoutRef.current) clearTimeout(preventClickTimeoutRef.current);
      preventClickTimeoutRef.current = setTimeout(() => {
        preventClickRef.current = false;
      }, 350);

      const isDeliberateHold = duration >= holdThresholdMs || isHoldRecognizedRef.current;

      if (isDeliberateHold) {
        // Sustained PRESS AND HOLD: release stops recording and sends transcript
        onHoldEnd();
      } else {
        // Quick TAP (< threshold): cleanly delegate to tap toggle
        onTap();
      }
    },
    [holdThresholdMs, onHoldEnd, onTap, startOnDown]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isPointerDownRef.current) return;
      isPointerDownRef.current = false;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setIsHolding(false);
      onHoldEnd();
    },
    [onHoldEnd]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Swallows trailing browser click events following pointerup
      if (preventClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Fallback click for keyboard activation or assistive tech
      onTap();
    },
    [onTap]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent long-press context menu on touch devices
    e.preventDefault();
  }, []);

  return {
    isHolding,
    bind: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onContextMenu: handleContextMenu,
      onClick: handleClick,
    },
  };
};
