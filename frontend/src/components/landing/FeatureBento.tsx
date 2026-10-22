import React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, BookOpen, CalendarClock, Check, FileText, GitMerge, History, KeyRound, Mail, PenLine, ScanSearch,
} from "lucide-react";
import { ManagedHeading, SpotlightCard } from "./primitives";
import { useCycle, EASE } from "./motion";
import { BrandName } from "../../context/PlatformContext";

const Icon: React.FC<{ icon: React.ElementType; tone: string }> = ({ icon: I, tone }) => (
  <span className={`grid place-items-center w-10 h-10 rounded-2xl ${tone}`}>
    <I className="w-5 h-5" />
  </span>
);

const CardText: React.FC<{ icon: React.ElementType; tone: string; title: string; body: string }> = ({ icon, tone, title, body }) => (
  <div>
    <Icon icon={icon} tone={tone} />
    <h3 className="mt-5 text-[19px] font-bold tracking-[-0.02em] text-slate-950">{title}</h3>
    <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{body}</p>
  </div>
);

const TABLES = [
  { name: "posts", label: "Write target", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { name: "categories", label: "Reference", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  { name: "tags", label: "Reference", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  { name: "payments", label: "Read-only", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  { name: "users", label: "Restricted", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  { name: "sessions", label: "Blocked", tone: "bg-rose-50 text-rose-700 border-rose-200" },
];

const SchemaVisual: React.FC = () => {
  const row = useCycle(TABLES.length, 1100);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 font-mono text-[12.5px]">
      {TABLES.map((t, i) => (
        <motion.div
          key={t.name}
          animate={{ backgroundColor: i === row ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0)" }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between rounded-xl px-3 py-2"
        >
          <span className="flex items-center gap-2 text-slate-700">
            <ScanSearch className={`w-3.5 h-3.5 transition-colors ${i === row ? "text-indigo-500" : "text-slate-300"}`} />
            {t.name}
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 font-sans text-[11px] font-semibold ${t.tone}`}>{t.label}</span>
        </motion.div>
      ))}
      <div className="mt-2 flex flex-wrap gap-2 px-3 pb-1 font-sans text-[11px]">
        <span className="rounded-md bg-white border border-slate-200 px-2 py-1 text-slate-500">password_hash · never returned</span>
        <span className="rounded-md bg-white border border-slate-200 px-2 py-1 text-slate-500">email · masked</span>
      </div>
    </div>
  );
};

const KnowledgeVisual: React.FC = () => (
  <div>
    <div className="flex flex-wrap gap-2">
      {["brand-voice.md", "product-faq.pdf", "style-notes.txt"].map((d, i) => (
        <motion.span
          key={d}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 * i, duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-600 shadow-sm"
        >
          <FileText className="w-3.5 h-3.5 text-violet-500" /> {d}
        </motion.span>
      ))}
    </div>
    <div className="mt-3 flex items-center gap-2">
      <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 transition-transform duration-500 group-hover:translate-x-1" />
      <span className="rounded-xl bg-violet-600 px-3 py-2 text-[12px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(124,58,237,0.7)]">
        Draft grounded in 3 passages
      </span>
    </div>
  </div>
);

const ApprovalVisual: React.FC = () => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 text-[11px] text-slate-500">
      <Mail className="w-3.5 h-3.5" /> <BrandName /> · Review needed
    </div>
    <div className="mt-1.5 text-[14px] font-semibold text-slate-900 leading-snug">5 indexing mistakes that slow MySQL down</div>
    <div className="mt-3 flex gap-2">
      <span className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-transform group-hover:-translate-y-0.5">Approve</span>
      <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700">Request changes</span>
    </div>
    <div className="mt-3 flex items-center gap-1.5 text-[11px]">
      {["v1", "v2", "v3"].map((v, i) => (
        <span key={v} className={`rounded-full px-2 py-0.5 font-semibold ${i === 1 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
          {v}
        </span>
      ))}
      <span className="text-slate-400">· approved after notes</span>
    </div>
  </div>
);

const ScheduleVisual: React.FC = () => (
  <div>
    <div className="grid grid-cols-7 gap-1.5">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => {
        const on = i === 0 || i === 3;
        return (
          <div key={i} className={`rounded-xl py-2.5 text-center text-[12px] font-semibold transition-colors ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-slate-50"}`}>
            {d}
          </div>
        );
      })}
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">08:30 write</span>
      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">09:00 publish</span>
      <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-indigo-700">Asia/Kolkata</span>
    </div>
  </div>
);

const RelationalVisual: React.FC = () => (
  <div className="relative mt-8 flex items-center justify-between gap-2">
    <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 shadow-sm">categories</span>
    <svg viewBox="0 0 100 10" className="h-3 flex-1" preserveAspectRatio="none" aria-hidden>
      <line x1="0" y1="5" x2="100" y2="5" stroke="#818CF8" strokeWidth="2" className="landing-flow" vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-700 shadow-sm">posts</span>
    <span className="absolute left-1/2 -translate-x-1/2 -top-7 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
      1 transaction
    </span>
  </div>
);

const MODELS = [
  { name: "Ollama", note: "Local · free", on: true },
  { name: "OpenAI", note: "Your key" },
  { name: "Gemini", note: "Your key" },
  { name: "Claude", note: "Your key" },
];
const ModelsVisual: React.FC = () => (
  <div className="space-y-1.5">
    {MODELS.map((m) => (
      <div key={m.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="text-[13px] font-semibold text-slate-800">
          {m.name} <span className="font-normal text-slate-400">· {m.note}</span>
        </span>
        <span className={`relative h-5 w-9 rounded-full transition-colors ${m.on ? "bg-emerald-500" : "bg-slate-200"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${m.on ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </div>
    ))}
  </div>
);

const ManualVisual: React.FC = () => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-semibold text-slate-500">AI writing</span>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
        Off <span className="relative h-5 w-9 rounded-full bg-slate-200"><span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow" /></span>
      </span>
    </div>
    <div className="mt-3 space-y-2">
      <div className="h-2.5 w-3/4 rounded-full bg-slate-800/80" />
      {[100, 92, 70].map((w) => <div key={w} className="h-2 rounded-full bg-slate-100" style={{ width: `${w}%` }} />)}
    </div>
    <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-[12px] font-semibold text-indigo-700">
      <CalendarClock className="w-3.5 h-3.5" /> Scheduled · Fri 10:00
    </div>
  </div>
);

const AuditVisual: React.FC = () => (
  <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-[11.5px] leading-6 text-slate-400">
    {[
      ["08:30", "automation.generated", "text-indigo-300"],
      ["08:41", "version.approved", "text-emerald-300"],
      ["09:00", "record.inserted posts#128", "text-cyan-300"],
      ["09:02", "connection.tested", "text-slate-300"],
    ].map(([t, e, c]) => (
      <div key={e} className="flex gap-3 truncate">
        <span className="text-slate-600">{t}</span>
        <span className={c}>{e}</span>
      </div>
    ))}
  </div>
);

const CARDS: { span: string; icon: React.ElementType; tone: string; title: string; body: string; visual: React.ReactNode }[] = [
  {
    span: "lg:col-span-4",
    icon: ScanSearch,
    tone: "bg-indigo-50 text-indigo-600",
    title: "It understands your schema",
    body: "It reads your tables, columns, keys and relationships, then labels every table: where it can write, which tables are references, and which sensitive ones stay locked.",
    visual: <SchemaVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: BookOpen,
    tone: "bg-violet-50 text-violet-600",
    title: "Writes with your knowledge",
    body: "Upload Markdown, TXT or PDF guides. Drafts draw on passages retrieved from your own documents.",
    visual: <KnowledgeVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: Mail,
    tone: "bg-sky-50 text-sky-600",
    title: "A person approves, by email",
    body: "Reviewers see the rendered draft and the exact database steps. Requesting changes writes a new version.",
    visual: <ApprovalVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: CalendarClock,
    tone: "bg-amber-50 text-amber-600",
    title: "Publishes on schedule",
    body: "One-time, daily or weekly, in your timezone. Background workers keep going when your browser is closed.",
    visual: <ScheduleVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: GitMerge,
    tone: "bg-emerald-50 text-emerald-600",
    title: "Relational, all or nothing",
    body: "Need a category that doesn't exist yet? It's created first, linked by its id, and everything commits together.",
    visual: <RelationalVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: KeyRound,
    tone: "bg-cyan-50 text-cyan-600",
    title: "Your model, your keys",
    body: "Local Ollama works out of the box. Add OpenAI, Gemini or Claude with your own key, encrypted at rest.",
    visual: <ModelsVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: PenLine,
    tone: "bg-rose-50 text-rose-600",
    title: "Or write it yourself",
    body: "Turn AI off, write or paste your content, and schedule it through the same safe pipeline.",
    visual: <ManualVisual />,
  },
  {
    span: "lg:col-span-2",
    icon: History,
    tone: "bg-slate-100 text-slate-700",
    title: "A complete audit trail",
    body: "Every run, approval, change and connection test is recorded, with a timeline you can open later.",
    visual: <AuditVisual />,
  },
];

export const FeatureBento: React.FC = () => (
  <section id="features" data-nav-theme="light" className="relative z-10 -mt-10 rounded-t-[40px] bg-[#F7F8FC] pt-24 sm:pt-32 pb-24 sm:pb-32 scroll-mt-16">
    <div aria-hidden className="absolute inset-x-0 top-0 h-[520px] landing-grid-light rounded-t-[40px]" />
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
      <ManagedHeading section="product" />
      <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-6 gap-4 sm:gap-5">
        {CARDS.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.8, delay: (i % 3) * 0.08, ease: EASE }}
            className={`${c.span} ${i === 0 ? "sm:col-span-2" : ""}`}
          >
            <SpotlightCard className="h-full">
              <div className={`h-full p-6 sm:p-7 flex flex-col gap-6 ${i === 0 ? "lg:grid lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-10" : "justify-between"}`}>
                <CardText icon={c.icon} tone={c.tone} title={c.title} body={c.body} />
                <div>{c.visual}</div>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
      <p className="mt-8 flex items-center justify-center gap-2 text-[14px] text-slate-500">
        <Check className="w-4 h-4 text-emerald-500" /> Works for any eligible table: blog posts, products, FAQs, web pages.
      </p>
    </div>
  </section>
);
