import React from "react";
import { motion } from "framer-motion";
import { Bot, Cpu, Database, FileCode2, FileText, Mail, Sparkles } from "lucide-react";
import { Counter } from "./primitives";
import { staggerChild, staggerParent } from "./motion";

const STACK = [
  { icon: Database, label: "MySQL" },
  { icon: Database, label: "MariaDB" },
  { icon: Database, label: "PostgreSQL*" },
  { icon: Cpu, label: "Ollama (local)" },
  { icon: Sparkles, label: "OpenAI" },
  { icon: Sparkles, label: "Google Gemini" },
  { icon: Bot, label: "Anthropic Claude" },
  { icon: FileCode2, label: "Markdown" },
  { icon: FileText, label: "PDF" },
  { icon: FileText, label: "Plain text" },
  { icon: Mail, label: "Your SMTP mail" },
];

const FACTS = [
  { value: 0, suffix: "", title: "paid AI APIs required", body: "A local Ollama model runs the whole workflow. Cloud models are optional." },
  { value: 7, suffix: "", title: "kinds of schema change, always blocked", body: "DROP, TRUNCATE, ALTER, CREATE, RENAME, GRANT and REVOKE. No setting enables them." },
  { value: 48, suffix: "", title: "character approval links", body: "Single use, tied to one draft version, and expired after 24 hours." },
  { value: 3, suffix: "", title: "rounds of review notes", body: "Each “request changes” produces a new version written with the reviewer’s notes." },
];

export const StackMarquee: React.FC = () => (
  <section data-nav-theme="dark" className="relative bg-[#060914] pb-24 sm:pb-28">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <p className="text-center text-[13px] font-medium uppercase tracking-[0.18em] text-slate-500">Works with what you already run</p>
      <div className="landing-marquee-wrap landing-fade-x mt-7 overflow-hidden">
        <div className="landing-marquee flex w-max gap-3">
          {[...STACK, ...STACK].map(({ icon: Icon, label }, i) => (
            <span
              key={i}
              aria-hidden={i >= STACK.length}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[14px] font-medium text-slate-300 whitespace-nowrap hover:border-indigo-400/40 hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4 text-indigo-300" /> {label}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-4 text-center text-[12px] text-slate-500">
        *PostgreSQL uses the same adapter and needs the PostgreSQL PHP driver on your server. SQL Server and MongoDB are not supported yet.
      </p>

      <motion.div
        variants={staggerParent}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mt-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.08]"
      >
        {FACTS.map((f) => (
          <motion.div key={f.title} variants={staggerChild} className="group bg-[#080C1A] p-7 hover:bg-[#0B1022] transition-colors">
            <div className="text-5xl font-extrabold tracking-[-0.04em] text-white">
              <Counter to={f.value} suffix={f.suffix} />
            </div>
            <div className="mt-3 text-[15px] font-semibold text-slate-200">{f.title}</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500 group-hover:text-slate-400 transition-colors">{f.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  </section>
);
