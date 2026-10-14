import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAssistant } from "../../context/AssistantContext";
import { OrbitalCoreCharacter } from "./OrbitalCoreCharacter";
import { ShieldAlert, Square, Pause, ExternalLink } from "lucide-react";

export const ActiveTaskGuardBanner: React.FC = () => {
  const {
    activeTask,
    characterState,
    isDrawerOpen,
    toggleDrawer,
    requestInterrupt,
    requestPause,
  } = useAssistant();

  if (!activeTask) return null;

  const isWorking = [
    "RUNNING",
    "COMMITTING",
    "PLANNING",
    "THINKING",
    "VALIDATING",
  ].includes(activeTask.status);

  if (!isWorking) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
        className="mb-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-xl p-3.5 shadow-lg shadow-indigo-950/20 text-white"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0">
              <OrbitalCoreCharacter state={characterState} size="sm" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
                  Agent Execution In Progress
                </span>
                <span className="text-[11px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30 font-medium">
                  {activeTask.status}
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-100 truncate mt-0.5">
                {activeTask.goal}
              </p>
              <p className="text-xs text-slate-400">
                Conflicting manual form edits are safely guarded while write operations are applied. Instant interruption is always available.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={requestPause}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
            <button
              type="button"
              onClick={() => requestInterrupt()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500 hover:text-white border border-rose-500/40 flex items-center gap-1.5 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop Immediately
            </button>
            {!isDrawerOpen && (
              <button
                type="button"
                onClick={toggleDrawer}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <span>Live View</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
