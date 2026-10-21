import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Hand, Lock, QrCode as QrIcon, Smartphone } from "lucide-react";
import { PhoneOrbitMock } from "./PhoneOrbitMock";
import { useOrbitRemote } from "../../context/OrbitRemoteContext";

/** Dashboard feature card: pair a phone and talk to Orbit from it. */
export const OrbitRemoteCard: React.FC = () => {
  const r = useOrbitRemote();
  const connected = r.phase === "connected";

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="da-ink px-6 py-7 sm:px-9"
      aria-labelledby="orbit-remote-title"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="landing-blob absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan-500/20" />
        <div className="landing-blob absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-violet-600/25" style={{ animationDelay: "-5s" }} />
        <div className="absolute inset-0 landing-grid opacity-60" />
      </div>
      <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11.5px] font-semibold text-cyan-200">
            <Smartphone className="h-3.5 w-3.5" /> Orbit Remote
          </span>
          <h2 id="orbit-remote-title" className="mt-4 text-[24px] sm:text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-white">
            {connected ? <>Orbit is listening to your phone.</> : <>Talk to Orbit <span className="landing-shimmer-text">from your phone.</span></>}
          </h2>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-slate-400">
            {connected
              ? `${r.session?.device_label || "Your phone"} is connected. Hold Orbit's face on the phone and speak; Orbit does it here while your phone shows what it is thinking.`
              : "Scan a code, hold Orbit's face on your phone and say what you need. Orbit does the work here, on this screen, and your phone follows along."}
          </p>
          <ul className="mt-5 grid gap-2.5 text-[13px] text-slate-300 sm:grid-cols-3">
            <li className="flex items-center gap-2"><QrIcon className="h-4 w-4 text-indigo-300" /> Scan, no app to install</li>
            <li className="flex items-center gap-2"><Hand className="h-4 w-4 text-cyan-300" /> Hold to talk, let go to send</li>
            <li className="flex items-center gap-2"><Lock className="h-4 w-4 text-emerald-300" /> Passwords stay on this computer</li>
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={r.openModal}
              className="da-btn px-5 py-2.5 text-[13.5px] bg-white text-slate-950 shadow-glow hover:-translate-y-px hover:bg-indigo-50"
            >
              {connected ? <>Manage phone <ArrowRight className="h-4 w-4" /></> : <><QrIcon className="h-4 w-4" /> Connect your phone</>}
            </button>
            {connected && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Connected
              </span>
            )}
          </div>
        </div>
        <motion.div
          className="mx-auto"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <PhoneOrbitMock width={164} state={r.phoneListening ? "listening" : connected ? "waiting" : "greeting"} caption={r.phoneListening ? "Listening…" : "Hold to talk"} />
        </motion.div>
      </div>
    </motion.section>
  );
};
