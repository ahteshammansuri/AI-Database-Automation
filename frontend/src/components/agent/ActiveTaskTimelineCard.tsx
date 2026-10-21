import React, { useState, useEffect } from "react";
import {
  Square,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AgentTask, AgentTimelineEvent } from "../../context/AssistantContext";
import { FieldError } from "../ui/kit";
import { rules, validateField } from "../../lib/validation";

interface ActiveTaskTimelineCardProps {
  task: AgentTask;
  events: AgentTimelineEvent[];
  onStop: () => void;
  onPause: () => void;
  onConfirm?: () => void;
  onCorrect: (correction: string) => void;
  disabled?: boolean;
}

export const ActiveTaskTimelineCard: React.FC<ActiveTaskTimelineCardProps> = ({
  task,
  events,
  onStop,
  onPause,
  onConfirm,
  onCorrect,
  disabled = false,
}) => {
  const [elapsedSecs, setElapsedSecs] = useState<number>(0);
  const [showCorrectionInput, setShowCorrectionInput] = useState<boolean>(false);
  const [correctionText, setCorrectionText] = useState<string>("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [showTechnicalTrace, setShowTechnicalTrace] = useState<boolean>(false);

  // Timer: elapsed time counter while task is running
  useEffect(() => {
    if (task.status !== "RUNNING" && task.status !== "WAITING_FOR_INPUT" && task.status !== "WAITING_FOR_APPROVAL") {
      return;
    }

    const start = new Date(task.created_at).getTime();
    const updateTimer = () => {
      const now = Date.now();
      setElapsedSecs(Math.max(0, Math.floor((now - start) / 1000)));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [task.status, task.created_at]);

  const handleCorrectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateField("correction", { correction: correctionText }, {
      correction: [rules.required("Correction", "Type what Orbit should change."), rules.maxLength(4000, "Correction")],
    });
    setCorrectionError(problem);
    if (problem) return;
    onCorrect(correctionText.trim());
    setCorrectionText("");
    setShowCorrectionInput(false);
  };

  const isWorking = task.status === "RUNNING" || task.status === "COMMITTING";
  const isAwaitingApproval = task.status === "WAITING_FOR_APPROVAL";

  return (
    <div className="p-4 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-xl text-slate-100 my-3">
      {/* Task Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {task.task_type}
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                isWorking
                  ? "bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse"
                  : isAwaitingApproval
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : task.status === "SUCCEEDED"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-700 text-slate-300 border-slate-600"
              }`}
            >
              {task.status}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-slate-100 truncate">{task.goal}</h4>
        </div>

        {/* Live Elapsed Counter */}
        <div className="flex items-center space-x-1 text-xs text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700 flex-shrink-0">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{elapsedSecs}s</span>
        </div>
      </div>

      {/* Confirmation Callout if WAITING_FOR_APPROVAL */}
      {isAwaitingApproval && onConfirm && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-xl"
        >
          <div className="flex items-center space-x-2 text-amber-300 font-medium text-xs mb-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Confirmation Required Before Commit</span>
          </div>
          <p className="text-xs text-amber-200/90 mb-3">
            Your autonomy setting requires approval before applying consequential modifications.
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={onConfirm}
              disabled={disabled}
              className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg shadow-sm transition active:scale-95 flex items-center justify-center space-x-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Confirm & Execute</span>
            </button>
            <button
              onClick={onStop}
              disabled={disabled}
              className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition border border-slate-700"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Live Timeline Events Progress */}
      <div className="space-y-2 mb-3">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Execution Timeline
        </div>
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
          {events.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-1">Initializing planned steps...</div>
          ) : (
            events.map((evt, idx) => (
              <div
                key={evt.id || idx}
                className="flex items-start space-x-2 text-xs py-1 border-b border-slate-800/60 last:border-0"
              >
                <div className="mt-0.5 flex-shrink-0">
                  {evt.status === "running" ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                  ) : evt.status === "succeeded" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : evt.status === "failed" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : evt.status === "waiting" ? (
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full bg-slate-700" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-200 truncate">{evt.step_name}</span>
                    <span className="text-[10px] text-slate-500 ml-2">
                      {new Date(evt.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">{evt.message}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Instant Action Controls: Stop, Pause, Correction */}
      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          {isWorking && (
            <>
              <button
                type="button"
                onClick={onStop}
                disabled={disabled}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-semibold flex items-center space-x-1.5 transition active:scale-95"
                title="Instantly stop task at next safe boundary"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
              <button
                type="button"
                onClick={onPause}
                disabled={disabled}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-xs font-medium flex items-center space-x-1.5 transition active:scale-95"
                title="Pause task execution"
              >
                <Pause className="w-3 h-3" />
                <span>Pause</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowCorrectionInput(!showCorrectionInput)}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition"
            title="Tell assistant to adjust plan parameters"
          >
            <Sparkles className="w-3 h-3" />
            <span>Change Plan</span>
          </button>
        </div>

        {/* Collapsible Technical Details Trace Toggle */}
        <button
          type="button"
          onClick={() => setShowTechnicalTrace(!showTechnicalTrace)}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center space-x-1 transition"
        >
          <span>Trace</span>
          {showTechnicalTrace ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Mid-Task Correction Drawer */}
      <AnimatePresence>
        {showCorrectionInput && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCorrectionSubmit}
            noValidate
            className="mt-3 pt-3 border-t border-slate-800"
          >
            <div className="flex items-center space-x-2">
              <input
                id={`orbit-correction-${task.id}`}
                type="text"
                value={correctionText}
                onChange={(e) => { setCorrectionText(e.target.value); setCorrectionError(null); }}
                placeholder="e.g. Stop, use category Reviews instead"
                aria-label="Correction for Orbit"
                aria-invalid={!!correctionError}
                aria-describedby={correctionError ? `orbit-correction-${task.id}-error` : undefined}
                className={`flex-1 px-3 py-1.5 text-xs bg-slate-800 border rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${correctionError ? "border-rose-400/80 focus:ring-rose-400" : "border-slate-700 focus:ring-indigo-500"}`}
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
              >
                Apply
              </button>
            </div>
            <FieldError id={`orbit-correction-${task.id}`} message={correctionError} tone="dark" />
          </motion.form>
        )}
      </AnimatePresence>

      {/* Collapsible Technical Trace View */}
      {showTechnicalTrace && (
        <div className="mt-3 p-2.5 bg-slate-950 rounded-xl text-[10px] font-mono text-slate-400 border border-slate-800 overflow-x-auto max-h-36">
          <div className="text-slate-500 mb-1">Correlation ID: {task.id}</div>
          <div>Resource: {task.target_resource_type || "None"} #{task.target_resource_id || "N/A"}</div>
          <div className="mt-1 text-slate-300">Active Plan Steps ({task.active_plan?.length || 0}):</div>
          {task.active_plan?.map((step, idx) => (
            <div key={idx} className="mt-1 text-slate-400">
              [{idx + 1}] {step.tool} - {JSON.stringify(step.args)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
