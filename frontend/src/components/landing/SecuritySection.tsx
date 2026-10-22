import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Ban, Brain, Database, EyeOff, Fingerprint, Globe2, KeyRound, Lock, Monitor, Server, ShieldCheck, UserCheck, X,
} from "lucide-react";
import { ManagedHeading, Reveal, SpotlightCard } from "./primitives";
import { EASE } from "./motion";
import { BrandName } from "../../context/PlatformContext";

const TIERS = [
  {
    name: "Reads",
    verdict: "Allowed",
    tone: "from-emerald-400 to-teal-400",
    chip: "bg-emerald-50 text-emerald-700",
    body: "Questions, counts and reports run as one validated SELECT on allowed tables, with a forced row limit, a timeout and a read-only transaction.",
  },
  {
    name: "Inserts & updates",
    verdict: "After a preview",
    tone: "from-indigo-400 to-violet-400",
    chip: "bg-indigo-50 text-indigo-700",
    body: "You see exactly what will change and confirm it. Updates are pinned to the exact rows you previewed. Never an unscoped update.",
  },
  {
    name: "Deletes",
    verdict: "Off by default",
    tone: "from-amber-400 to-orange-400",
    chip: "bg-amber-50 text-amber-700",
    body: "Only if the connection owner turns them on. Then: impact analysis, a typed confirmation, a transaction, a backup and an audit record.",
  },
  {
    name: "Schema changes",
    verdict: "Never",
    tone: "from-rose-400 to-pink-500",
    chip: "bg-rose-50 text-rose-700",
    body: "No prompt, setting or request can run these against your database:",
    never: ["DROP", "TRUNCATE", "ALTER", "CREATE", "RENAME", "GRANT", "REVOKE", "Raw SQL console", "AI-written SQL for writes"],
  },
];

const GUARANTEES = [
  { icon: KeyRound, title: "Encrypted credentials", body: "Database passwords and API keys are encrypted at rest, never logged, and never sent back to the browser." },
  { icon: Lock, title: "Sensitive data locked", body: "Credential, token and session tables are blocked. Password hashes, tokens, card numbers and national IDs are never returned." },
  { icon: EyeOff, title: "Personal data masked", body: "Emails and phone numbers stay masked unless revealed through an audited action." },
  { icon: UserCheck, title: "Your workspace only", body: "Ownership is checked on the server for every request and every background job, not just in the browser." },
  { icon: Fingerprint, title: "AI output is untrusted", body: "Types, lengths, required fields, allowed values, references and uniqueness are validated before any write." },
  { icon: Globe2, title: "Safe connection tests", body: "Connection tests are protected against SSRF and network abuse." },
];

/** A connector with a small light travelling along it. */
const Flow: React.FC<{ vertical?: boolean; className?: string }> = ({ vertical = true, className = "" }) => {
  const reduced = useReducedMotion();
  return (
    <div className={`relative ${vertical ? "w-px h-10 mx-auto" : "h-px w-full my-auto"} bg-indigo-300/30 ${className}`}>
      {!reduced && (
        <motion.span
          className="absolute w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_2px_rgba(103,232,249,0.7)]"
          style={vertical ? { left: -2.5 } : { top: -2.5 }}
          animate={vertical ? { top: ["0%", "100%"] } : { left: ["0%", "100%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        />
      )}
    </div>
  );
};

const Node: React.FC<{ icon: React.ElementType; title: React.ReactNode; note: React.ReactNode; accent: string }> = ({ icon: I, title, note, accent }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2.5 sm:px-4 sm:py-3">
    <div className="flex items-center gap-2 sm:gap-2.5">
      <span className={`grid place-items-center w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-xl ${accent}`}><I className="w-4 h-4" /></span>
      <span className="text-[13px] sm:text-[14px] font-semibold leading-tight text-white">{title}</span>
    </div>
    <p className="hidden sm:block mt-1.5 text-[12px] leading-snug text-slate-400">{note}</p>
  </div>
);

const Architecture: React.FC = () => (
  <div className="relative h-full rounded-3xl bg-[#070B18] border border-slate-800 p-6 sm:p-8 overflow-hidden flex flex-col">
    <div aria-hidden className="absolute inset-0 landing-grid opacity-70" />
    <div className="relative flex-1 flex flex-col">
      <h3 className="text-[20px] font-bold tracking-[-0.02em] text-white">The AI never touches your database</h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-slate-400">
        Every read and write goes through the server's controlled execution layer. The AI service only receives text and returns text.
      </p>
      <div className="my-auto pt-8 grid grid-cols-2 gap-x-3 sm:gap-x-5 text-left">
        <div />
        <Node icon={Monitor} title="Your browser" note={<>The <BrandName /> portal</>} accent="bg-sky-500/15 text-sky-300" />
        <div />
        <Flow />
        <div className="flex items-center gap-0">
          <div className="flex-1"><Node icon={Brain} title="AI service" note="Models, retrieval, structured output" accent="bg-violet-500/15 text-violet-300" /></div>
          <div className="w-5"><Flow vertical={false} /></div>
        </div>
        <Node icon={Server} title={<><BrandName /> server</>} note="Accounts, ownership, schedules, approvals, all database access" accent="bg-indigo-500/15 text-indigo-300" />
        <div className="flex flex-col items-center">
          <div className="w-px h-10 border-l border-dashed border-rose-400/50" />
        </div>
        <Flow />
        <div className="flex items-center justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-[12px] font-semibold text-rose-300 whitespace-nowrap">
            <X className="w-3.5 h-3.5" /> No database access
          </span>
        </div>
        <Node icon={Database} title="Your database" note="Read-only until you allow more" accent="bg-emerald-500/15 text-emerald-300" />
      </div>
    </div>
  </div>
);

export const SecuritySection: React.FC = () => (
  <section id="security" data-nav-theme="light" className="relative bg-[#F7F8FC] py-24 sm:py-32 scroll-mt-16">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <ManagedHeading section="security" />

      <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {TIERS.map((t, i) => (
          <motion.div
            key={t.name}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.75, delay: i * 0.08, ease: EASE }}
          >
            <SpotlightCard className="h-full">
              <div className={`h-1 bg-gradient-to-r ${t.tone}`} />
              <div className="p-6">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${t.chip}`}>{t.verdict}</span>
                <h3 className="mt-3 text-[19px] font-bold tracking-[-0.02em] text-slate-950">{t.name}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{t.body}</p>
                {t.never && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {t.never.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1 font-mono text-[11px] font-semibold text-rose-700">
                        <Ban className="w-3 h-3" /> {n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>

      <div className="mt-5 grid lg:grid-cols-[1.05fr_1fr] gap-5">
        <Reveal><Architecture /></Reveal>
        <Reveal delay={0.1}>
          <div className="h-full rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              <h3 className="text-[20px] font-bold tracking-[-0.02em] text-slate-950">Built in, not bolted on</h3>
            </div>
            <div className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-6">
              {GUARANTEES.map((g) => (
                <div key={g.title} className="group">
                  <span className="grid place-items-center w-9 h-9 rounded-xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
                    <g.icon className="w-[18px] h-[18px]" />
                  </span>
                  <h4 className="mt-3 text-[15px] font-semibold text-slate-900">{g.title}</h4>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-600">{g.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);
