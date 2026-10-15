import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft } from "lucide-react";
import { orbitStage } from "../../services/orbitStage";
import { orbitTargets } from "../../services/orbitTargets";
import { api } from "../../services/api";
import { pageStateService } from "../../services/pageStateService";

/** Caption bubble shown above Orbit while it guides the user (show_me). */
export const OrbitCaption: React.FC = () => {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: any;
    const off = orbitStage.subscribe((e) => {
      if (e.type === "caption") {
        setText(e.text);
        clearTimeout(timer);
        timer = setTimeout(() => setText(null), 7000);
      } else if (e.type === "return") {
        setText(null);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.95 }}
          role="status"
          className="absolute bottom-full mb-2 right-0 w-56 bg-white text-slate-800 text-[11px] leading-snug rounded-2xl rounded-br-sm px-3 py-2 shadow-xl border border-indigo-100"
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Chip next to a real secret field (e.g. the connection password) while Orbit waits for the
 * user to type it. Enter in the field or the chip tells Orbit to continue; the value itself
 * stays in the form and is only ever sent by the page's own Test/Save request.
 */
export const OrbitSecretChip: React.FC = () => {
  const [wait, setWait] = useState<{ target: string; taskId: number; surface: string; field: string; label: string } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => orbitStage.subscribe((e) => {
    if (e.type === "secret_wait") setWait(e);
    if (e.type === "secret_done") setWait(null);
  }), []);

  useEffect(() => {
    if (!wait) return;
    const el = orbitTargets.get(wait.target);
    if (!el) return;
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void proceed();
      }
    };
    el.addEventListener("keydown", onKey);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const t = setInterval(measure, 500);
    return () => {
      el.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wait]);

  const proceed = async () => {
    if (!wait || sending) return;
    const el = orbitTargets.get(wait.target) as HTMLInputElement | null;
    if (el && !el.value) {
      el.focus();
      return;
    }
    setSending(true);
    try {
      await api.continueAgentTask(wait.taskId, { surface: wait.surface, field: wait.field, page_context: pageStateService.getSnapshot() });
      orbitStage.emit({ type: "secret_done" });
    } finally {
      setSending(false);
    }
  };

  if (!wait || !rect) return null;
  return (
    <div className="fixed z-[60]" style={{ top: rect.top + rect.height / 2 - 14, left: Math.min(window.innerWidth - 190, rect.right + 8) }}>
      <button
        type="button"
        onClick={proceed}
        disabled={sending}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-semibold shadow-lg hover:bg-indigo-500 disabled:opacity-60"
      >
        <CornerDownLeft className="w-3 h-3" />
        {sending ? "Telling Orbit…" : `Done: continue with Orbit`}
      </button>
    </div>
  );
};
