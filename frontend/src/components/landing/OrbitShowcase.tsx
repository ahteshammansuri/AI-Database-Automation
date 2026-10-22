import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, Hand, KeyRound, Languages, Loader2, Mic, MousePointerClick } from "lucide-react";
import { OrbitMascotCharacter, CharacterState } from "../agent/OrbitMascotCharacter";
import { ManagedHeading, Reveal } from "./primitives";
import { EASE } from "./motion";

type Scenario = { user: string; steps: { text: string; pose: CharacterState }[]; reply: string; end: CharacterState };

const SCENARIOS: Scenario[] = [
  {
    user: "Connect my blog database: host 127.0.0.1, database blog_cms, user editor.",
    steps: [
      { text: "Opened Connections", pose: "clicking" },
      { text: "Filled host, database and user", pose: "typing" },
      { text: "Pointed at the password box, you typed it", pose: "pointing" },
      { text: "Tested and saved the connection", pose: "working" },
    ],
    reply: "Blog DB is connected, read-only. Shall I scan its tables next?",
    end: "success",
  },
  {
    user: "Aisa kaun sa customer hai jisne sabse zyada orders kiye?",
    steps: [
      { text: "Wrote one read-only query", pose: "thinking" },
      { text: "Safety gate checked it against your schema", pose: "validating" },
      { text: "Ran it with a row limit", pose: "working" },
    ],
    reply: "Rahul Verma placed the most orders: 8. Next is Aarav Sharma with 7.",
    end: "success",
  },
  {
    user: "Create a daily blog automation about MySQL tips at 9 AM.",
    steps: [
      { text: "Opened New Automation", pose: "clicking" },
      { text: "Chose the posts table", pose: "pointing" },
      { text: "Planned how each column is filled", pose: "typing" },
      { text: "Set daily at 09:00, Asia/Kolkata", pose: "working" },
    ],
    reply: "Everything is filled in. Want me to save and schedule it?",
    end: "needs_input",
  },
];

const POINTS = [
  { icon: Languages, title: "Talk or type, in any language", body: "Ask in English, Hindi or Hinglish. Answers come from your real data and the product guides." },
  { icon: MousePointerClick, title: "It does the clicks, on screen", body: "Orbit flies to the real button, types into the real fields and shows every step as it happens." },
  { icon: Hand, title: "Asks before anything important", body: "Running, approving and publishing wait for your OK. Removals need the Confirm button, never just a spoken yes." },
  { icon: KeyRound, title: "Never sees your passwords", body: "Orbit points at the password box and you type it yourself. The value never reaches the AI." },
];

/** Phase -1 = the user is speaking, 0..n-1 = steps, n = Orbit's reply. */
function useDemo(active: boolean) {
  const [s, setS] = useState(0);
  const [phase, setPhase] = useState(-1);
  useEffect(() => {
    if (!active) return;
    const scenario = SCENARIOS[s];
    const last = scenario.steps.length;
    const ms = phase === -1 ? 2000 : phase < last ? 1150 : 3400;
    const t = setTimeout(() => {
      if (phase < last) setPhase(phase + 1);
      else {
        setS((s + 1) % SCENARIOS.length);
        setPhase(-1);
      }
    }, ms);
    return () => clearTimeout(t);
  }, [active, s, phase]);
  return { scenario: SCENARIOS[s], index: s, phase };
}

export const OrbitShowcase: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { margin: "200px 0px" });
  const reduced = useReducedMotion();
  const { scenario, index, phase } = useDemo(near && !reduced);
  const last = scenario.steps.length;
  const pose: CharacterState = reduced
    ? "greeting"
    : phase === -1 ? "listening" : phase < last ? scenario.steps[phase].pose : scenario.end;

  return (
    <section id="orbit" data-nav-theme="dark" className="relative overflow-hidden bg-[#060914] py-24 sm:py-32 scroll-mt-16">
      <div aria-hidden className="absolute inset-0">
        <div className="landing-blob absolute top-0 right-0 w-[40rem] h-[40rem] rounded-full bg-violet-600/25" />
        <div className="landing-blob absolute bottom-0 left-10 w-[34rem] h-[34rem] rounded-full bg-cyan-500/15" style={{ animationDelay: "-8s" }} />
        <div className="absolute inset-0 landing-grid opacity-60" />
      </div>

      <div ref={ref} className="relative max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        <div>
          <ManagedHeading section="orbit" dark align="left" />
          <div className="mt-10 grid sm:grid-cols-2 gap-x-8 gap-y-7">
            {POINTS.map((p, i) => (
              <Reveal key={p.title} delay={0.06 * i}>
                <div className="flex gap-3.5">
                  <span className="grid place-items-center w-10 h-10 shrink-0 rounded-2xl bg-white/[0.06] border border-white/10 text-cyan-300">
                    <p.icon className="w-[18px] h-[18px]" />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold text-white">{p.title}</h3>
                    <p className="mt-1 text-[14.5px] leading-relaxed text-slate-400">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Live Orbit + demo conversation */}
        <Reveal y={40}>
          <div className="relative">
            <div aria-hidden className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[30rem] h-[30rem] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.22),transparent_65%)]" />
            <div className="relative flex justify-center h-[250px]">
              {near && <OrbitMascotCharacter state={pose} size="xl" />}
            </div>
            <div className="relative -mt-3 rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 sm:p-6 min-h-[300px] shadow-[0_40px_100px_-40px_rgba(99,102,241,0.6)]">
              <AnimatePresence mode="wait">
                <motion.div key={index} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                  <div className="flex justify-end">
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.5, ease: EASE }}
                      className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-500 px-4 py-2.5 text-[14px] leading-snug text-white shadow-lg"
                    >
                      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-100/80">
                        <Mic className="w-3 h-3" /> {phase === -1 ? "Listening…" : "You said"}
                      </span>
                      {scenario.user}
                    </motion.div>
                  </div>
                  <ol className="mt-4 space-y-2">
                    {scenario.steps.map((st, i) =>
                      i <= phase ? (
                        <motion.li
                          key={st.text}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, ease: EASE }}
                          className="flex items-center gap-2.5 text-[13.5px] text-slate-300"
                        >
                          {i < phase || phase >= last ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Loader2 className="w-4 h-4 text-cyan-300 animate-spin shrink-0" />
                          )}
                          {st.text}
                        </motion.li>
                      ) : null,
                    )}
                  </ol>
                  <AnimatePresence>
                    {phase >= last && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="mt-4 max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-2.5 text-[14px] leading-snug text-slate-100"
                      >
                        <span className="mb-1 block text-[11px] font-semibold text-cyan-300">Orbit</span>
                        {scenario.reply}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </AnimatePresence>
              <div className="absolute bottom-4 right-5 flex gap-1.5" aria-hidden>
                {SCENARIOS.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? "w-6 bg-cyan-300" : "w-1.5 bg-white/20"}`} />
                ))}
              </div>
            </div>
            <p className="mt-3 text-center text-[12px] text-slate-500">Illustration of real Orbit flows. Replies depend on your data and model.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
