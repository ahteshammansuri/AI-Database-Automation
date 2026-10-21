import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Lock, PlayCircle, ServerCog, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { OrbitMascotCharacter, CharacterState } from "../agent/OrbitMascotCharacter";
import { HeroMockup } from "./HeroMockup";
import { EASE } from "./motion";

// How long each pipeline step of the demo stays on screen (ms); the last one lingers.
const STEP_MS = [1700, 2200, 1700, 1500, 1700, 3200];
// Orbit reacts to the demo: inspects the schema, types the draft, waits, cheers, works, celebrates.
const ORBIT_FOR_STEP: CharacterState[] = ["inspecting", "typing", "waiting", "success", "working", "celebrate"];

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 22, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.9, delay, ease: EASE },
});

export const Hero: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const inView = useInView(stage, { margin: "0px 0px -10% 0px" });
  // Orbit's animation loop only runs while the hero is near the screen.
  const near = useInView(stage, { margin: "300px 0px" });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEP_MS.length), STEP_MS[step]);
    return () => clearTimeout(t);
  }, [step, inView, reduced]);

  // The product window starts tilted back and settles flat as you scroll toward it.
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 25%"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.4 });
  const rotateX = useTransform(smooth, [0, 1], [reduced ? 0 : 20, 0]);
  const scale = useTransform(smooth, [0, 1], [reduced ? 1 : 0.9, 1]);
  const glow = useTransform(smooth, [0, 1], [0.35, 0.9]);

  return (
    <section data-nav-theme="dark" className="relative overflow-hidden bg-[#060914] pt-32 sm:pt-40 pb-24 sm:pb-32">
      {/* Aurora + grid */}
      <div aria-hidden className="absolute inset-0">
        <div className="landing-blob absolute -top-40 -left-32 w-[42rem] h-[42rem] rounded-full bg-indigo-600/35" />
        <div className="landing-blob absolute top-20 -right-40 w-[36rem] h-[36rem] rounded-full bg-violet-600/30" style={{ animationDelay: "-6s" }} />
        <div className="landing-blob absolute top-[46rem] left-1/3 w-[38rem] h-[30rem] rounded-full bg-cyan-500/20" style={{ animationDelay: "-11s" }} />
        <div className="absolute inset-0 landing-grid" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#060914]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-4xl mx-auto">
          <motion.a
            {...fadeUp(0)}
            href="#orbit"
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pl-1.5 pr-3.5 py-1.5 text-[13px] text-slate-300 hover:border-indigo-400/40 hover:bg-white/[0.07] transition-colors"
          >
            <span className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
            Meet Orbit, the voice-first operator for your portal
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </motion.a>

          <motion.h1
            {...fadeUp(0.08)}
            className="mt-7 text-[2.7rem] leading-[1.02] sm:text-[4rem] lg:text-[5.1rem] font-extrabold tracking-[-0.045em] text-white"
          >
            Put your database
            <br />
            <span className="landing-shimmer-text">on autopilot.</span>
          </motion.h1>

          <motion.p {...fadeUp(0.16)} className="mt-6 text-[17px] sm:text-xl leading-relaxed text-slate-400 max-w-2xl mx-auto">
            DataAuto connects to your MySQL database, understands every table, and writes on-brand content into it with
            your own AI: on schedule, approved by a person, and validated before every write.
          </motion.p>

          <motion.div {...fadeUp(0.24)} className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={isAuthenticated ? "/dashboard" : "/register"}
              className="group relative inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_18px_50px_-12px_rgba(129,140,248,0.75)] transition-transform hover:-translate-y-0.5"
            >
              {isAuthenticated ? "Open your dashboard" : "Start for free"}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#how-it-works"
              className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-7 py-3.5 text-[15px] font-semibold text-white hover:bg-white/[0.08] hover:border-white/25 transition-colors"
            >
              <PlayCircle className="w-4 h-4 text-indigo-300" /> See how it works
            </a>
          </motion.div>

          <motion.ul
            {...fadeUp(0.32)}
            className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[13px] text-slate-400"
          >
            <li className="flex items-center gap-2"><ServerCog className="w-4 h-4 text-cyan-300" /> Runs on local Ollama, no paid API</li>
            <li className="flex items-center gap-2"><Lock className="w-4 h-4 text-violet-300" /> Credentials encrypted at rest</li>
            <li className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-300" /> Every write validated and audited</li>
          </motion.ul>
        </div>

        {/* Product stage */}
        <div ref={stage} className="relative mt-16 sm:mt-20 max-w-6xl mx-auto" style={{ perspective: 1400 }}>
          <motion.div
            aria-hidden
            style={{ opacity: glow }}
            className="absolute -inset-x-10 -top-10 -bottom-10 rounded-[40px] bg-[radial-gradient(60%_50%_at_50%_40%,rgba(99,102,241,0.45),transparent_70%)] blur-2xl"
          />
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.35, ease: EASE }}
            style={{ rotateX, scale, transformOrigin: "50% 0%" }}
            className="relative"
          >
            <HeroMockup step={reduced ? 5 : step} />
          </motion.div>

          {/* Floating proof chips */}
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.1, ease: EASE }}
            className="hidden lg:flex absolute -right-8 -top-7 items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0E1430]/90 backdrop-blur px-4 py-3 shadow-2xl"
          >
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-300"><Lock className="w-4 h-4" /></span>
            <span className="text-left">
              <span className="block text-[13px] font-semibold text-white">Read-only by default</span>
              <span className="block text-[11px] text-slate-400">You choose what can be written</span>
            </span>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 1.3, ease: EASE }}
            className="hidden lg:flex absolute -left-12 -bottom-9 items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0E1430]/90 backdrop-blur px-4 py-3 shadow-2xl"
          >
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-violet-500/15 text-violet-300"><Sparkles className="w-4 h-4" /></span>
            <span className="text-left">
              <span className="block text-[13px] font-semibold text-white">The AI never connects to your DB</span>
              <span className="block text-[11px] text-slate-400">Every write goes through the server</span>
            </span>
          </motion.div>

          {/* Orbit, reacting to the demo run */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 14, delay: 1.2 }}
            className="hidden md:block absolute -right-6 lg:-right-14 -bottom-12 drop-shadow-[0_20px_40px_rgba(56,189,248,0.25)]"
          >
            {near && <OrbitMascotCharacter state={reduced ? "idle" : ORBIT_FOR_STEP[step]} size="lg" />}
          </motion.div>
        </div>
      </div>
    </section>
  );
};
