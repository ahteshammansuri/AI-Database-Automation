import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Smartphone } from "lucide-react";
import { useOrbitRemote } from "../../context/OrbitRemoteContext";

/** While Orbit's face is held on the paired phone: shown at the top of this screen, with the words heard so far. */
export const PhoneListeningPill: React.FC = () => {
  const { phoneListening, session } = useOrbitRemote();
  return (
    <AnimatePresence>
      {phoneListening && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.97 }}
          transition={{ type: "spring", damping: 24, stiffness: 320 }}
          className="pointer-events-none fixed left-1/2 top-3 z-[80] w-[min(92vw,520px)] -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/30 bg-slate-950/92 px-4 py-2.5 text-white shadow-[0_18px_40px_-16px_rgba(8,145,178,0.7)] backdrop-blur-xl">
            <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300">
              <span className="absolute inset-0 animate-ping rounded-xl bg-cyan-400/20" />
              <Smartphone className="relative h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-cyan-200">Listening on {session?.device_label || "your phone"}</span>
              <span className="block truncate text-[13px] text-slate-200">{phoneListening.words ? `“${phoneListening.words}”` : "Speak now…"}</span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
