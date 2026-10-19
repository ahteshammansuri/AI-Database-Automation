import React from "react";
import { motion } from "framer-motion";
import { Ban, Bot, CheckCircle2, Key, Lock, Network, ShieldAlert, ShieldCheck } from "lucide-react";
import { useOrbitSurface } from "../hooks/useOrbitSurface";

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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-5xl mx-auto space-y-6"
    >
      <div className="pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Enforced by the backend
          </span>
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Security Model & Guardrails</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          What can and cannot happen to your databases. These rules run on the server; the AI never decides them.
        </p>
      </div>

      <section className="bg-rose-50/70 border border-rose-200 rounded-2xl p-5 sm:p-6 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-rose-950 flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </span>
          Never possible
        </h3>
        <p className="text-xs text-rose-900 leading-relaxed">
          No prompt, setting or request can run these against a connected database:
        </p>
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          {NEVER_ALLOWED.map((kw) => (
            <span key={kw} className="px-3 py-1 bg-white text-rose-700 border border-rose-200 rounded-lg font-bold shadow-2xs flex items-center gap-1.5">
              <Ban className="w-3 h-3 text-rose-500" />
              {kw}
            </span>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-slate-900">What is allowed, and how</h4>
              <p className="text-[11px] text-slate-500">Each connection starts read-only</p>
            </div>
          </div>
          <ul className="text-xs space-y-3 text-slate-600">
            {OPERATIONS.map((op) => (
              <li key={op.name} className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                <strong className="text-slate-900">{op.name}</strong>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{op.rule}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-slate-900">Sensitive tables and columns</h4>
              <p className="text-[11px] text-slate-500">Restricted by default</p>
            </div>
          </div>
          <ul className="text-xs space-y-3 text-slate-600">
            {TABLE_RULES.map((r) => (
              <li key={r.label} className="p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                <strong className="text-slate-900">{r.label}</strong>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{r.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROTECTIONS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <h5 className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <Icon className="w-4 h-4 text-indigo-600 shrink-0" />
              {title}
            </h5>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{text}</p>
          </div>
        ))}
      </section>
    </motion.div>
  );
};
