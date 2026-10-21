import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen, CheckCircle2, Circle, Database, FileText, History, LayoutDashboard, Loader2, Mail, Rocket, ScanSearch,
  ShieldCheck, Sparkles, Workflow,
} from "lucide-react";
import { EASE } from "./motion";

const STEPS = [
  { icon: ScanSearch, title: "Read the schema", meta: "posts · 9 columns · 2 relations" },
  { icon: Sparkles, title: "Write the draft", meta: "Your model · grounded in 3 docs" },
  { icon: Mail, title: "Ask the reviewer", meta: "editor@example.com" },
  { icon: CheckCircle2, title: "Approved", meta: "Version 2 · after review notes" },
  { icon: Rocket, title: "Publish in one transaction", meta: "Category + post, all or nothing" },
];

const SIDEBAR = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Database, label: "Connections" },
  { icon: Workflow, label: "Automations", active: true },
  { icon: CheckCircle2, label: "Approvals" },
  { icon: BookOpen, label: "Knowledge" },
  { icon: History, label: "History" },
];

/** A stylised, animated view of one automation run inside the portal (illustration). */
export const HeroMockup: React.FC<{ step: number }> = ({ step }) => {
  const approved = step >= 3;
  const published = step >= 5;
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#0B1022]/90 shadow-[0_40px_120px_-30px_rgba(79,70,229,0.55)] overflow-hidden backdrop-blur">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-white/[0.07] bg-white/[0.02]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
        <div className="mx-auto hidden sm:flex items-center gap-2 rounded-md bg-white/[0.05] px-3 py-1 text-[11px] text-slate-400 font-mono">
          <ShieldCheck className="w-3 h-3 text-emerald-400" /> localhost:5173/executions
        </div>
      </div>

      <div className="flex text-left">
        {/* Sidebar */}
        <aside className="hidden md:flex w-48 shrink-0 flex-col gap-1 border-r border-white/[0.07] p-3">
          <div className="flex items-center gap-2 px-2 pb-3 text-[13px] font-semibold text-white">
            <span className="grid place-items-center w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400">
              <Database className="w-3.5 h-3.5" />
            </span>
            DataAuto
          </div>
          {SIDEBAR.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] ${
                active ? "bg-indigo-500/15 text-indigo-200 font-semibold" : "text-slate-400"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </div>
          ))}
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-semibold">Automation run</div>
              <div className="text-[15px] sm:text-[17px] font-semibold text-white mt-0.5">Daily MySQL tips → blog_cms.posts</div>
            </div>
            <AnimatePresence mode="wait">
              <motion.span
                key={published ? "done" : approved ? "approved" : "running"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border ${
                  published
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"
                    : approved
                      ? "bg-indigo-500/10 text-indigo-200 border-indigo-400/30"
                      : "bg-amber-500/10 text-amber-200 border-amber-400/30"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${published ? "bg-emerald-400" : approved ? "bg-indigo-300" : "bg-amber-300 animate-pulse"}`} />
                {published ? "Published" : approved ? "Approved · publishing at 09:00" : "In progress"}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="grid lg:grid-cols-[1fr_1.05fr] gap-5 pt-5">
            {/* Pipeline */}
            <ol className="space-y-2.5">
              {STEPS.map(({ icon: Icon, title, meta }, i) => {
                const done = i < step;
                const running = i === step;
                return (
                  <motion.li
                    key={title}
                    animate={{ opacity: i > step ? 0.45 : 1 }}
                    transition={{ duration: 0.4 }}
                    className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                      running ? "border-indigo-400/40 bg-indigo-500/[0.08]" : "border-white/[0.06] bg-white/[0.02]"
                    }`}
                  >
                    <span
                      className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${
                        done ? "bg-emerald-500/15 text-emerald-300" : running ? "bg-indigo-500/20 text-indigo-200" : "bg-white/5 text-slate-500"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100 truncate">{title}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{meta}</span>
                    </span>
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : running ? (
                      <Loader2 className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-600 shrink-0" />
                    )}
                  </motion.li>
                );
              })}
            </ol>

            {/* Draft preview */}
            <div className="hidden sm:block relative rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
              <div className="relative h-28 bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500">
                <div className="absolute inset-0 opacity-30 landing-grid" />
                <div className="absolute left-4 bottom-3 right-4">
                  <span className="inline-block rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold text-white/90">Databases</span>
                  <div className="mt-1 text-[14px] font-bold text-white leading-snug">5 indexing mistakes that slow MySQL down</div>
                </div>
              </div>
              <div className="p-4 space-y-2">
                {[92, 100, 84, 96, 60].map((w, i) => (
                  <motion.div
                    key={i}
                    initial={false}
                    animate={{ width: step >= 1 ? `${w}%` : "0%" }}
                    transition={{ duration: 0.9, delay: step === 1 ? i * 0.12 : 0, ease: EASE }}
                    className="h-2 rounded-full bg-white/10"
                  />
                ))}
                <div className="flex items-center gap-2 pt-2 text-[11px] text-slate-400">
                  <FileText className="w-3.5 h-3.5" /> slug: 5-indexing-mistakes-mysql
                </div>
              </div>
              <AnimatePresence>
                {approved && (
                  <motion.div
                    initial={{ opacity: 0, scale: 1.4, rotate: -14 }}
                    animate={{ opacity: 1, scale: 1, rotate: -8 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 16 }}
                    className="absolute right-3 top-3 rounded-lg border-2 border-emerald-300/80 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-200 bg-emerald-500/10"
                  >
                    Approved
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Write plan */}
          <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/30 px-4 py-3 font-mono text-[11px] leading-6 text-slate-400 overflow-hidden">
            <div className="text-slate-500">-- write plan · one transaction</div>
            <div>
              <span className="text-violet-300">1</span> create category <span className="text-cyan-300">"Databases"</span>
            </div>
            <div className="truncate">
              <span className="text-violet-300">2</span> insert into posts (title, slug, content, category_id, banner, published_at)
            </div>
            <motion.div animate={{ opacity: published ? 1 : 0.35 }} className={published ? "text-emerald-300" : ""}>
              {published ? "✓ committed · post #128" : "· waiting for publication time"}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};
