import React, { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { CheckCircle2, Database, Image, Link2, Lock, Mail, ScanSearch, Sparkles, Type, Clock3 } from "lucide-react";
import { ManagedHeading } from "./primitives";
import { EASE } from "./motion";

const STEPS = [
  {
    title: "Connect your database",
    body: "Add a MySQL connection from the portal. The platform tests it first, encrypts the password, and starts every connection in read-only mode.",
  },
  {
    title: "Let it learn the schema",
    body: "Tables, columns, keys and relationships are scanned and labelled. Sensitive tables and secret columns are locked by default.",
  },
  {
    title: "Describe what to write",
    body: "Pick a table and a topic. Every column gets a clear plan, from AI-written text to unique slugs, linked categories and cover images.",
  },
  {
    title: "Review before anything is written",
    body: "Preview the real pipeline without writing a thing. When a draft is ready, your reviewer approves it from their inbox or asks for changes.",
  },
  {
    title: "Publish on time, safely",
    body: "At publication time the approved version is written in one transaction, then recorded in your run history and audit log.",
  },
];

// ---------------------------------------------------------------------------
// Step visuals (illustrations of the real portal screens)
// ---------------------------------------------------------------------------

const Panel: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: I, children }) => (
  <div className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_40px_100px_-40px_rgba(30,27,75,0.35)] overflow-hidden">
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5">
      <span className="grid place-items-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600"><I className="w-4 h-4" /></span>
      <span className="text-[14px] font-semibold text-slate-900">{title}</span>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; value: React.ReactNode; delay?: number }> = ({ label, value, delay = 0 }) => (
  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5, ease: EASE }}>
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[13px] text-slate-800">{value}</div>
  </motion.div>
);

const ConnectVisual = () => (
  <Panel title="New connection" icon={Database}>
    <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1 text-[12px] font-semibold">
      {["MySQL", "MariaDB", "PostgreSQL"].map((e, i) => (
        <span key={e} className={`flex-1 rounded-lg py-1.5 text-center ${i === 0 ? "bg-white text-slate-900 shadow-sm" : "text-slate-400"}`}>{e}</span>
      ))}
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Field label="Host" value="127.0.0.1" delay={0.05} />
      <Field label="Port" value="3306" delay={0.1} />
      <Field label="Database" value="blog_cms" delay={0.15} />
      <Field label="Username" value="editor" delay={0.2} />
    </div>
    <div className="mt-3">
      <Field
        label="Password"
        delay={0.25}
        value={<span className="flex items-center justify-between"><span className="tracking-[0.3em]">••••••••••</span><span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Lock className="w-3 h-3" /> Encrypted</span></span>}
      />
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[12px] font-semibold text-emerald-700">Access: read-only</span>
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7, type: "spring", stiffness: 260, damping: 18 }}
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Tested · connected
      </motion.span>
    </div>
  </Panel>
);

const DISCOVERED = [
  { t: "posts", c: 9, l: "Recommended target", tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { t: "categories", c: 4, l: "Reference", tone: "text-sky-700 bg-sky-50 border-sky-200" },
  { t: "tags", c: 3, l: "Reference", tone: "text-sky-700 bg-sky-50 border-sky-200" },
  { t: "orders", c: 8, l: "Read-only", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  { t: "users", c: 7, l: "Restricted", tone: "text-rose-700 bg-rose-50 border-rose-200" },
  { t: "password_resets", c: 3, l: "Blocked", tone: "text-rose-700 bg-rose-50 border-rose-200" },
];
const DiscoverVisual = () => (
  <Panel title="Schema explorer · blog_cms" icon={ScanSearch}>
    <div className="relative grid grid-cols-2 gap-2.5">
      {DISCOVERED.map((d, i) => (
        <motion.div
          key={d.t}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 * i, duration: 0.5, ease: EASE }}
          className="rounded-2xl border border-slate-200 p-3"
        >
          <div className="flex items-center justify-between font-mono text-[13px] text-slate-800">
            {d.t}
            <span className="font-sans text-[11px] text-slate-400">{d.c} cols</span>
          </div>
          <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${d.tone}`}>{d.l}</span>
        </motion.div>
      ))}
      <motion.div
        aria-hidden
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%"] }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
        className="pointer-events-none absolute inset-x-0 h-10 -translate-y-1/2 bg-gradient-to-b from-transparent via-indigo-400/15 to-transparent"
      />
    </div>
  </Panel>
);

const PLAN = [
  { col: "title", how: "AI writes it", icon: Sparkles },
  { col: "slug", how: "From the title, made unique", icon: Type },
  { col: "content", how: "AI writes it (Markdown)", icon: Sparkles },
  { col: "category_id", how: "AI picks a category, creates it if new", icon: Link2 },
  { col: "banner", how: "Generated cover image", icon: Image },
  { col: "published_at", how: "The publication time", icon: Clock3 },
];
const BuildVisual = () => (
  <Panel title="New automation · how each column is filled" icon={Sparkles}>
    <div className="divide-y divide-slate-100">
      {PLAN.map((p, i) => (
        <motion.div
          key={p.col}
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.07 * i, duration: 0.5, ease: EASE }}
          className="flex items-center justify-between gap-4 py-2.5"
        >
          <span className="font-mono text-[13px] text-slate-800">{p.col}</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-[12px] text-slate-600">
            <p.icon className="w-3.5 h-3.5 text-indigo-500" /> {p.how}
          </span>
        </motion.div>
      ))}
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
      <span className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">Daily · 08:30 → 09:00</span>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Topic: practical MySQL tips</span>
    </div>
  </Panel>
);

const ReviewVisual = () => (
  <Panel title="Inbox · review needed" icon={Mail}>
    <div className="text-[12px] text-slate-500">To: editor@example.com</div>
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
      <div className="h-20 bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400" />
      <div className="p-4">
        <div className="text-[15px] font-bold text-slate-900">5 indexing mistakes that slow MySQL down</div>
        <div className="mt-2 space-y-1.5">
          {[100, 94, 70].map((w) => <div key={w} className="h-2 rounded-full bg-slate-100" style={{ width: `${w}%` }} />)}
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 p-3 font-mono text-[11.5px] leading-5 text-slate-600">
          1. Create category "Databases"
          <br />2. Insert into posts
        </div>
      </div>
    </div>
    <div className="mt-4 flex items-center gap-2">
      <motion.span whileHover={{ y: -2 }} className="rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(79,70,229,0.8)]">
        Approve
      </motion.span>
      <span className="rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-700">Request changes</span>
      <span className="ml-auto text-[11px] text-slate-400">Single-use link · 24 h</span>
    </div>
  </Panel>
);

const TIMELINE = [
  ["08:30", "Draft written with your model"],
  ["08:31", "Email sent to editor@example.com"],
  ["08:44", "Approved, version 2"],
  ["09:00", "Created category “Databases”"],
  ["09:00", "Inserted into posts · #128"],
];
const PublishVisual = () => (
  <Panel title="Run history · Daily MySQL tips" icon={CheckCircle2}>
    <ol className="relative space-y-3 pl-6">
      <span aria-hidden className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
      {TIMELINE.map(([t, e], i) => (
        <motion.li
          key={e}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.12 * i, duration: 0.5, ease: EASE }}
          className="relative flex items-center justify-between gap-3"
        >
          <span className="absolute -left-6 grid place-items-center w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-emerald-50">
            <CheckCircle2 className="w-3 h-3 text-white" />
          </span>
          <span className="text-[13px] text-slate-700">{e}</span>
          <span className="font-mono text-[12px] text-slate-400">{t}</span>
        </motion.li>
      ))}
    </ol>
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.75, duration: 0.5 }}
      className="mt-4 flex items-center justify-between rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3"
    >
      <span className="text-[13px] font-semibold text-emerald-800">Committed in one transaction</span>
      <span className="text-[12px] text-emerald-700">Browser closed? Still runs.</span>
    </motion.div>
  </Panel>
);

const VISUALS = [ConnectVisual, DiscoverVisual, BuildVisual, ReviewVisual, PublishVisual];

// ---------------------------------------------------------------------------

export const HowItWorks: React.FC = () => {
  const story = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: story, offset: ["start start", "end end"] });
  const rail = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.3 });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));

  const jumpTo = (i: number) => {
    const el = story.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const travel = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + travel * ((i + 0.5) / STEPS.length), behavior: "smooth" });
  };

  const ActiveVisual = VISUALS[active];

  return (
    <section id="how-it-works" data-nav-theme="light" className="relative bg-white scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-24 sm:pt-32">
        <ManagedHeading section="how" />
      </div>

      {/* Desktop: a pinned story that advances as you scroll */}
      <div ref={story} className="hidden lg:block relative" style={{ height: `${STEPS.length * 65}vh` }}>
        <div className="sticky top-0 h-screen flex items-center">
          <div className="max-w-7xl mx-auto w-full px-6 grid grid-cols-[0.95fr_1.05fr] gap-16 items-center">
            <div className="relative pl-10">
              <div aria-hidden className="absolute left-[15px] top-2 bottom-2 w-[2px] rounded-full bg-slate-100" />
              <motion.div
                aria-hidden
                style={{ scaleY: rail }}
                className="absolute left-[15px] top-2 bottom-2 w-[2px] origin-top rounded-full bg-gradient-to-b from-indigo-500 via-violet-500 to-cyan-400"
              />
              <ol className="space-y-3">
                {STEPS.map((s, i) => {
                  const on = i === active;
                  return (
                    <li key={s.title}>
                      <button type="button" onClick={() => jumpTo(i)} className="group relative w-full text-left rounded-2xl px-5 py-4 transition-colors hover:bg-slate-50">
                        <span
                          className={`absolute -left-10 top-5 grid place-items-center w-8 h-8 rounded-full text-[13px] font-bold transition-all duration-500 ${
                            on ? "bg-indigo-600 text-white shadow-[0_0_0_6px_rgba(99,102,241,0.15)]" : i < active ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-400 border border-slate-200"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className={`block text-[20px] font-bold tracking-[-0.02em] transition-colors duration-500 ${on ? "text-slate-950" : "text-slate-400"}`}>
                          {s.title}
                        </span>
                        <motion.span
                          initial={false}
                          animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }}
                          transition={{ duration: 0.5, ease: EASE }}
                          className="block overflow-hidden"
                        >
                          <span className="block pt-2 text-[15.5px] leading-relaxed text-slate-600">{s.body}</span>
                        </motion.span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="relative">
              <div aria-hidden className="absolute -inset-10 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_50%,rgba(129,140,248,0.22),transparent_70%)]" />
              <div className="relative min-h-[470px] flex items-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, y: 30, scale: 0.97, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -20, scale: 0.98, filter: "blur(4px)" }}
                    transition={{ duration: 0.55, ease: EASE }}
                    className="w-full"
                  >
                    <ActiveVisual />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile and tablet: the same story, stacked */}
      <div className="lg:hidden max-w-2xl mx-auto px-4 sm:px-6 pt-14 pb-24 space-y-16">
        {STEPS.map((s, i) => {
          const V = VISUALS[i];
          return (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-8 h-8 rounded-full bg-indigo-600 text-white text-[13px] font-bold">{i + 1}</span>
                <h3 className="text-[20px] font-bold tracking-[-0.02em] text-slate-950">{s.title}</h3>
              </div>
              <p className="mt-3 text-[15.5px] leading-relaxed text-slate-600">{s.body}</p>
              <div className="mt-6"><V /></div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};
