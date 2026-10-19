import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, X } from "lucide-react";
import { useAssistant } from "../../context/AssistantContext";
import { BubbleKind, pickBubble } from "../../services/orbitBubble";
import { orbitStage } from "../../services/orbitStage";
import { orbitTargets } from "../../services/orbitTargets";
import { api } from "../../services/api";
import { pageStateService } from "../../services/pageStateService";

const KIND_STYLE: Record<BubbleKind, { label?: string; ring: string; dot?: string }> = {
  caption: { ring: "border-indigo-100" },
  confirm: { label: "Needs your OK", ring: "border-amber-300", dot: "bg-amber-500" },
  question: { label: "Your turn", ring: "border-cyan-300", dot: "bg-cyan-500" },
  working: { ring: "border-indigo-100", dot: "bg-indigo-500 animate-pulse" },
  reply: { ring: "border-emerald-200" },
  error: { ring: "border-rose-200", dot: "bg-rose-500" },
};

/**
 * Small speech bubble beside Orbit while its panel is closed: what it is doing right now, the question
 * it is waiting on, a pending confirmation, or a short version of its reply. Every word comes from the
 * server (model speech, narration, step labels); nothing here is canned or invented.
 */
export const OrbitSpeechBubble: React.FC<{ align: "left" | "right"; below: boolean }> = ({ align, below }) => {
  const {
    isOpen, setIsOpen, activeTask, speech, narration, toolActivity, turnStage, awaitingConfirmation, queueStatus,
  } = useAssistant();
  const [caption, setCaption] = useState<{ key: string; text: string } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [expired, setExpired] = useState<Set<string>>(() => new Set());
  const captionSeq = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = orbitStage.subscribe((e) => {
      if (e.type === "caption") {
        setCaption({ key: `caption:${++captionSeq.current}`, text: e.text });
        clearTimeout(timer);
        // Clear (not just hide) so lower-priority messages such as current work show again.
        timer = setTimeout(() => setCaption(null), 7000);
      } else if (e.type === "return") {
        setCaption(null);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  const bubble = pickBubble({
    caption,
    taskId: activeTask?.id ?? null,
    status: activeTask?.status ?? null,
    awaitingConfirmationTool: awaitingConfirmation?.tool ?? null,
    speech: speech ? { messageId: speech.messageId, text: speech.text, isServiceError: speech.isServiceError } : null,
    narration,
    runningStep: toolActivity?.status === "running" ? toolActivity.label : null,
    queue: turnStage === "QUEUED" ? queueStatus : null,
  });

  const ttlKey = bubble?.ttlMs ? bubble.key : null;
  const ttlMs = bubble?.ttlMs;
  useEffect(() => {
    if (!ttlKey || !ttlMs) return;
    const t = setTimeout(() => setExpired((prev) => new Set(prev).add(ttlKey)), ttlMs);
    return () => clearTimeout(t);
  }, [ttlKey, ttlMs]);

  const visible = bubble && !isOpen && !dismissed.has(bubble.key) && !expired.has(bubble.key) ? bubble : null;
  const style = visible ? KIND_STYLE[visible.kind] : null;

  return (
    <AnimatePresence>
      {visible && style && (
        <motion.div
          key={visible.kind}
          initial={{ opacity: 0, y: below ? -6 : 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: below ? -6 : 6, scale: 0.95 }}
          transition={{ duration: 0.18 }}
          role="status"
          aria-live="polite"
          className={`absolute ${below ? "top-full mt-2" : "bottom-full mb-2"} ${align === "right" ? "right-0" : "left-0"} w-60 max-w-[calc(100vw-24px)] bg-white text-slate-800 text-[11px] leading-snug rounded-2xl ${
            below ? (align === "right" ? "rounded-tr-sm" : "rounded-tl-sm") : (align === "right" ? "rounded-br-sm" : "rounded-bl-sm")
          } px-3 py-2 shadow-xl border ${style.ring}`}
        >
          <div className="flex items-start gap-2">
            {style.dot && <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />}
            <div className="flex-1 min-w-0">
              {style.label && <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-0.5">{style.label}</div>}
              <p className="break-words">{visible.text}</p>
              {visible.action && (
                <button
                  type="button"
                  onClick={() => setIsOpen(true)}
                  className={`mt-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                    visible.kind === "confirm" ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  {visible.action}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Hide this message"
              onClick={() => setDismissed((prev) => new Set(prev).add(visible.key))}
              className="-mr-1 -mt-0.5 p-0.5 rounded text-slate-400 hover:text-slate-700"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
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
