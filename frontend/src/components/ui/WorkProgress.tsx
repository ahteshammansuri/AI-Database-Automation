import React from "react";
import { motion } from "framer-motion";
import { Check, Circle, Loader2, X } from "lucide-react";

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface WorkStep {
  key: string;
  label: string;
  /** Shown under the label while the step runs or after it finished. */
  detail?: string | null;
}

interface Props {
  title: string;
  steps: WorkStep[];
  status: Record<string, StepStatus>;
  seconds?: number;
  /** The latest thing the server reported, word for word. */
  latest?: string | null;
  hint?: string;
}

/**
 * Progress of a long operation, step by step: what is done, what is running now and what comes next. Statuses come
 * from what the server reported, never from a timer.
 */
export const WorkProgress: React.FC<Props> = ({ title, steps, status, seconds, latest, hint }) => {
  const done = steps.filter((s) => status[s.key] === "done").length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <div className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-white to-cyan-50/40 p-4 sm:p-5" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> {title}
        </p>
        {seconds !== undefined && <span className="font-mono text-[12px] tabular-nums text-slate-500">{seconds}s</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" initial={false} animate={{ width: `${Math.max(4, pct)}%` }} transition={{ duration: 0.5 }} />
      </div>
      <ol className="space-y-2.5">
        {steps.map((s) => {
          const st = status[s.key] ?? "pending";
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                st === "done" ? "bg-emerald-500 text-white" : st === "active" ? "bg-indigo-600 text-white" : st === "failed" ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                {st === "done" ? <Check className="h-3.5 w-3.5" /> : st === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : st === "failed" ? <X className="h-3.5 w-3.5" /> : <Circle className="h-2.5 w-2.5" />}
              </span>
              <div className="min-w-0">
                <p className={`text-[13px] font-semibold ${st === "pending" ? "text-slate-400" : st === "failed" ? "text-rose-700" : "text-slate-900"}`}>
                  {s.label}{st === "active" && <span className="ml-1.5 text-[11.5px] font-medium text-indigo-600">in progress</span>}
                </p>
                {s.detail && st !== "pending" && <p className="text-[12px] leading-snug text-slate-500">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {latest && <p className="rounded-xl bg-white/80 px-3 py-2 text-[12px] text-slate-600 ring-1 ring-slate-100">{latest}</p>}
      {hint && <p className="text-[11.5px] text-slate-400">{hint}</p>}
    </div>
  );
};
