import React from "react";
import { motion } from "framer-motion";
import { Ban, Bot, CheckCircle2, Key, Lock, Network, ShieldAlert, ShieldCheck } from "lucide-react";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { CardHeader, PageHeader } from "../components/ui/kit";
import { SpotlightCard } from "../components/landing/primitives";

/**
 * What the backend actually enforces. Each statement matches code in the Laravel control plane
 * (DataAccessPolicy, SafeDatabaseExecutor, DatabaseSafetyService, DataChangeService, ApprovalToken,
 * ToolPolicyGate). Orbit reads this same data from the screen, so keep it exact when the code changes.
 */
const NEVER_ALLOWED = ["DROP", "TRUNCATE", "ALTER", "CREATE", "RENAME", "GRANT", "REVOKE", "Raw SQL console", "AI-written SQL for writes"];

const OPERATIONS = [
  {
    name: "Reads",
    rule: "Read-only questions about your data run as a single validated SELECT on allowed tables, with a forced LIMIT, a statement timeout and a read-only transaction.",
  },
  {
    name: "New rows (INSERT)",
    rule: "Automations and Manual Publishing only add new rows to tables you chose, with parameterized statements in one transaction. A linked parent record (for example a category) is created first in the same transaction only when you allowed it. Sensitive tables never receive automated writes.",
  },
  {
    name: "Editing rows (UPDATE)",
    rule: "Needs a connection set to read & write, a before → after preview of the exact rows, and your confirmation. Updates are pinned to the previewed primary keys, so an unscoped update is impossible. An executed change can be undone from its saved, encrypted before-image.",
  },
  {
    name: "Row DELETE",
    rule: "Off by default. Only when the connection owner sets access mode to read, write & delete: impact analysis first, then you type an exact phrase (voice alone is not accepted). It runs in a transaction, the deleted rows are saved first (encrypted) so it can be undone, and it is audited.",
  },
];

const TABLE_RULES = [
  { label: "Always blocked", detail: "Credential, token and session tables (tokens, sessions, password_resets, personal_access_tokens, oauth_*, credentials). No setting can open them." },
  { label: "Read-only by default", detail: "Payments, invoices, transactions, financial, roles, permissions and audit tables. The connection owner can change this per table." },
  { label: "Never written by automations", detail: "Tables named like users, accounts, auth, passwords, sessions, tokens, roles, permissions, payments, transactions, billing, invoices, wallets, audit or logs." },
  { label: "Secret columns", detail: "Password hashes, tokens, card numbers and national IDs are never returned or written." },
  { label: "Personal data", detail: "Emails and phone numbers are masked in results unless revealed through an audited action." },
];

const PROTECTIONS = [
  { icon: Key, title: "Secrets encrypted at rest", text: "Database passwords and AI provider keys are stored encrypted and never sent back to the browser after saving." },
  { icon: Network, title: "Connection test guard", text: "Tests refuse the cloud metadata address and well-known non-database ports such as SSH, SMTP, Redis, Docker and Kubernetes." },
  { icon: Lock, title: "Email approval links", text: "Each link carries a random single-use token for one draft version and expires after 24 hours. Opening it only shows the preview; approving or rejecting needs a button press." },
  { icon: Bot, title: "Orbit (AI assistant)", text: "The backend decides permissions, never the model. Changes need your confirmation; removals and cancellations need the Confirm button in Orbit's panel. Orbit never types or reads passwords or keys." },
  { icon: ShieldCheck, title: "Ownership and audit", text: "Every connection, automation, run and document belongs to one user and is checked on the server and in background jobs. Security-relevant actions are written to the audit log." },
];

export const SecuritySettingsPage: React.FC = () => {
  useOrbitSurface("security.page", () => ({
    describe: () => ({
      never_allowed: NEVER_ALLOWED,
      operations: OPERATIONS,
      table_rules: TABLE_RULES,
      protections: PROTECTIONS.map(({ title, text }) => ({ title, text })),
    }),
  }));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Security & guardrails"
        description="What can and cannot happen to your databases. These rules run on the server for every request and background job; the AI never decides them."
        actions={
          <span className="da-chip da-chip-emerald px-3 py-1.5 text-[12.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Enforced by the backend
          </span>
        }
      />

      {/* Never possible */}
      <section className="da-ink p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -top-20 right-0 h-72 w-72 rounded-full bg-rose-600/25" />
          <div className="absolute inset-0 landing-grid opacity-60" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500/15 text-rose-300"><ShieldAlert className="h-5 w-5" /></span>
            <div>
              <h3 className="text-[19px] font-bold tracking-[-0.02em] text-white">Never possible</h3>
              <p className="text-[13.5px] text-slate-400">No prompt, setting or request can run these against a connected database.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {NEVER_ALLOWED.map((kw) => (
              <span key={kw} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 font-mono text-[12.5px] font-semibold text-rose-200">
                <Ban className="h-3.5 w-3.5 text-rose-400" /> {kw}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section className="da-card space-y-4 p-6">
          <CardHeader icon={CheckCircle2} tone="emerald" title="What is allowed, and how" description="Every connection starts read-only." />
          <ol className="space-y-2.5">
            {OPERATIONS.map((op, i) => (
              <li key={op.name} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-950 text-[11px] font-bold text-white">{i + 1}</span>
                <div>
                  <strong className="text-[13.5px] text-slate-900">{op.name}</strong>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{op.rule}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="da-card space-y-4 p-6">
          <CardHeader icon={Lock} tone="amber" title="Sensitive tables and columns" description="Restricted by default." />
          <ul className="space-y-2.5">
            {TABLE_RULES.map((r) => (
              <li key={r.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                <strong className="flex items-center gap-2 text-[13.5px] text-slate-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {r.label}
                </strong>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{r.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROTECTIONS.map(({ icon: Icon, title, text }, i) => (
          <motion.div key={title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.45 }}>
            <SpotlightCard className="h-full shadow-soft">
              <div className="p-5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-700 transition-colors duration-300 group-hover:bg-indigo-600 group-hover:text-white">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <h5 className="mt-4 text-[15px] font-bold text-slate-950">{title}</h5>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{text}</p>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </section>
    </motion.div>
  );
};
