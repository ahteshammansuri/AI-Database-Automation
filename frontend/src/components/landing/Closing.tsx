import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { ArrowRight, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { OrbitMascotCharacter } from "../agent/OrbitMascotCharacter";
import { Logo } from "./LandingNav";
import { NAV_LINKS } from "./navLinks";
import { Accent, Reveal, SectionHeading } from "./primitives";
import { EASE } from "./motion";

const FAQS = [
  {
    q: "Do I need a paid AI subscription?",
    a: "No. DataAuto runs on a local Ollama model on your own machine, so the core workflow needs no paid API. OpenAI, Gemini and Claude are optional: add your own key in the portal if you want them.",
  },
  {
    q: "Which databases does it support?",
    a: "MySQL and MariaDB. PostgreSQL works through the same adapter when the PostgreSQL PHP driver is installed on the server. SQL Server and MongoDB are not supported yet.",
  },
  {
    q: "Can the AI change or delete my data on its own?",
    a: "No. The AI service never connects to your database; the server decides what runs. Automations only write the tables and columns you mapped, after validation and, if you turn it on, a reviewer's approval. Changes you ask Orbit for are previewed and confirmed first. Deletes are off unless you enable them for a connection, and schema changes are never allowed.",
  },
  {
    q: "Where are my database passwords and API keys stored?",
    a: "Encrypted at rest in your own workspace. They are never logged and never sent back to the browser after you save them. Orbit never sees them either: you type them into the form yourself.",
  },
  {
    q: "What happens if nobody approves a draft in time?",
    a: "You choose for each automation: keep it as a draft, publish the latest version, or cancel that run.",
  },
  {
    q: "Does it keep working when I close the browser?",
    a: "Yes. Generation and publishing run as persisted background jobs and schedules, so they continue after you close the tab and survive restarts.",
  },
  {
    q: "Can I write the content myself?",
    a: "Yes. Manual publishing lets you write or paste content and schedule it with AI turned off, through the same validated pipeline.",
  },
  {
    q: "Is my content sent to anyone else?",
    a: "With a local Ollama model, generation stays on your machine. If you pick a cloud provider, prompts and the retrieved passages go to that provider under its terms. Approval emails go through your own mail server. Voice input in Chrome or Edge may use the browser's speech service, and Orbit tells you before you use it the first time.",
  },
];

export const Faq: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" data-nav-theme="light" className="relative bg-[#F7F8FC] py-24 sm:py-32 scroll-mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[0.8fr_1.2fr] gap-12 lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            align="left"
            eyebrow="FAQ"
            title={<>Questions, <Accent>answered plainly</Accent></>}
            subtitle="The short version: your data stays yours, the server enforces every rule, and nothing needs a paid API."
          />
        </div>
        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={f.q} delay={0.03 * i} y={12}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="group w-full flex items-center justify-between gap-6 py-5 text-left"
                >
                  <span className={`text-[17px] font-semibold tracking-[-0.01em] transition-colors ${isOpen ? "text-indigo-700" : "text-slate-900 group-hover:text-indigo-700"}`}>
                    {f.q}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className={`grid place-items-center w-8 h-8 shrink-0 rounded-full border transition-colors ${isOpen ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 text-slate-500 group-hover:border-indigo-300"}`}
                  >
                    <Plus className="w-4 h-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 pr-12 text-[15.5px] leading-relaxed text-slate-600">{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const FinalCta: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { margin: "200px 0px" });
  return (
    <section data-nav-theme="light" className="relative bg-[#F7F8FC] pb-24 sm:pb-32 px-4 sm:px-6">
      <Reveal>
        <div ref={ref} className="relative max-w-7xl mx-auto overflow-hidden rounded-[40px] bg-[#060914] px-6 sm:px-14 py-16 sm:py-20">
          <div aria-hidden className="absolute inset-0">
            <div className="landing-blob absolute -top-24 left-1/4 w-[34rem] h-[34rem] rounded-full bg-indigo-600/35" />
            <div className="landing-blob absolute -bottom-32 right-0 w-[30rem] h-[30rem] rounded-full bg-cyan-500/20" style={{ animationDelay: "-7s" }} />
            <div className="absolute inset-0 landing-grid" />
          </div>
          <div className="relative grid md:grid-cols-[1.4fr_0.6fr] items-center gap-10">
            <div>
              <h2 className="text-[2.2rem] sm:text-[3.2rem] leading-[1.05] font-extrabold tracking-[-0.04em] text-white">
                Your next post can write, review <Accent dark>and publish itself.</Accent>
              </h2>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-400">
                Create a workspace, connect your database and schedule your first automation. Orbit can walk you through it.
              </p>
              <div className="mt-9 flex flex-col sm:flex-row gap-3">
                <Link
                  to={isAuthenticated ? "/dashboard" : "/register"}
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-slate-950 shadow-[0_18px_50px_-12px_rgba(129,140,248,0.75)] transition-transform hover:-translate-y-0.5"
                >
                  {isAuthenticated ? "Open your dashboard" : "Create your workspace"}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
                {!isAuthenticated && (
                  <Link
                    to="/login"
                    className="inline-flex items-center justify-center rounded-full border border-white/15 px-7 py-3.5 text-[15px] font-semibold text-white hover:bg-white/[0.08] transition-colors"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
            <div className="hidden md:flex justify-center">
              {near && (
                <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, ease: EASE }}>
                  <OrbitMascotCharacter state="greeting" size="xl" />
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
};

export const LandingFooter: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const account = isAuthenticated
    ? [{ to: "/dashboard", label: "Dashboard" }, { to: "/connections", label: "Connections" }, { to: "/automations", label: "Automations" }]
    : [{ to: "/login", label: "Sign in" }, { to: "/register", label: "Create account" }];
  return (
    <footer data-nav-theme="dark" className="bg-[#060914] border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 grid gap-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-slate-400">
            AI content and data automation for your own database: understood, approved by people, and written safely.
          </p>
        </div>
        <div>
          <h4 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-500">Product</h4>
          <ul className="mt-4 space-y-2.5">
            {NAV_LINKS.map((l) => (
              <li key={l.href}><a href={l.href} className="text-[14.5px] text-slate-300 hover:text-white transition-colors">{l.label}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-500">{isAuthenticated ? "Your workspace" : "Account"}</h4>
          <ul className="mt-4 space-y-2.5">
            {account.map((l) => (
              <li key={l.to}><Link to={l.to} className="text-[14.5px] text-slate-300 hover:text-white transition-colors">{l.label}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-slate-500">
          <span>© 2026 DataAuto. Self-hosted database automation.</span>
          <span>Laravel · FastAPI · React · Ollama</span>
        </div>
      </div>
    </footer>
  );
};
