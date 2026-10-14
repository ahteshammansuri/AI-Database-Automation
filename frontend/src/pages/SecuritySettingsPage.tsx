import React from "react";
import { motion } from "framer-motion";
import {
  ShieldAlert,
  Lock,
  CheckCircle2,
  Key,
  ShieldCheck,
  Ban,
  FileCheck2,
  Fingerprint,
  Cpu
} from "lucide-react";

export const SecuritySettingsPage: React.FC = () => {
  const forbiddenVerbs = [
    "DELETE",
    "DROP",
    "TRUNCATE",
    "ALTER",
    "CREATE",
    "RENAME",
    "GRANT",
    "REVOKE",
    "RAW_SQL_STRINGS"
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-5xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active Backend Enforcer
            </span>
            <span className="text-xs text-slate-400">• Zero Destructive Operations</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Security Model & Guardrails</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Deterministic backend policies protecting customer databases from unauthorized, malicious, or destructive mutations
          </p>
        </div>

        <div className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="font-semibold text-slate-900">SOC-2 & Zero-Trust Ready</span>
        </div>
      </div>

      {/* Forbidden Commands Banner with micro-animations */}
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="bg-rose-50/70 border border-rose-200 rounded-2xl p-6 space-y-4 shadow-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-rose-950 flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            Absolute Non-Negotiable Database Guardrails
          </h3>
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-200/60 text-rose-800">
            Enforced at Executor Boundary
          </span>
        </div>

        <p className="text-xs text-rose-900 leading-relaxed">
          The customer database execution service strictly prohibits destructive SQL verbs. No model prompt, user configuration, or injection attack can execute:
        </p>

        <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs">
          {forbiddenVerbs.map((kw) => (
            <motion.span
              key={kw}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="px-3 py-1 bg-white text-rose-700 border border-rose-200 rounded-lg font-bold shadow-2xs cursor-default flex items-center gap-1.5"
            >
              <Ban className="w-3 h-3 text-rose-500" />
              <span>{kw}</span>
            </motion.span>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Permitted Operations */}
        <motion.div
          whileHover={{ y: -3, borderColor: "#cbd5e1" }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0 shadow-2xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">Permitted Operations</h4>
              <p className="text-[11px] text-slate-500">Explicit allowlist only</p>
            </div>
          </div>

          <ul className="text-xs space-y-3 text-slate-600">
            <li className="flex items-start gap-2.5 p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
              <span className="text-emerald-600 font-bold mt-0.5">•</span>
              <div>
                <strong className="text-slate-900">Read-Only Introspection:</strong>
                <p className="text-[11px] text-slate-500 mt-0.5">Queries `information_schema` to parse tables, columns, constraints, and enums safely without touching table row contents.</p>
              </div>
            </li>
            <li className="flex items-start gap-2.5 p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
              <span className="text-emerald-600 font-bold mt-0.5">•</span>
              <div>
                <strong className="text-slate-900">Parameterized INSERT:</strong>
                <p className="text-[11px] text-slate-500 mt-0.5">Writes only to user-allowlisted tables and allowlisted column definitions using prepared statements.</p>
              </div>
            </li>
            <li className="flex items-start gap-2.5 p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
              <span className="text-emerald-600 font-bold mt-0.5">•</span>
              <div>
                <strong className="text-slate-900">Scoped Parameterized UPDATE:</strong>
                <p className="text-[11px] text-slate-500 mt-0.5">Restricted to allowlisted fields on identified records by specific primary key. Accidental mass updates are structurally impossible.</p>
              </div>
            </li>
          </ul>
        </motion.div>

        {/* Default-Deny Classifications */}
        <motion.div
          whileHover={{ y: -3, borderColor: "#cbd5e1" }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 shadow-2xs">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">Default-Deny Classifications</h4>
              <p className="text-[11px] text-slate-500">Automatic schema sensitivity filters</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Tables matching sensitive patterns are flagged <strong className="text-rose-600 font-semibold">RESTRICTED</strong> automatically and blocked from all automated target writes:
          </p>

          <div className="space-y-2 text-xs font-mono">
            <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl">
              <div className="font-bold text-slate-800 font-sans mb-1 flex items-center gap-1.5">
                <Fingerprint className="w-3.5 h-3.5 text-indigo-600" />
                <span>Credentials & Authentication</span>
              </div>
              <code className="text-[11px] text-slate-600">users, passwords, credentials, tokens, api_keys</code>
            </div>

            <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl">
              <div className="font-bold text-slate-800 font-sans mb-1 flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Financial & Commerce</span>
              </div>
              <code className="text-[11px] text-slate-600">payments, billing, orders, transactions, cards, wallets</code>
            </div>

            <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl">
              <div className="font-bold text-slate-800 font-sans mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                <span>Security & Audits</span>
              </div>
              <code className="text-[11px] text-slate-600">audit_logs, permissions, roles, access_logs</code>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Approval Token Security */}
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xs"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0 shadow-2xs">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">Email Approval & Token Security</h4>
            <p className="text-[11px] text-slate-500">Cryptographically verifiable human-in-the-loop decisions</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600 pt-1">
          <motion.div
            whileHover={{ y: -2, borderColor: "#cbd5e1" }}
            className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-1.5 transition"
          >
            <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-600" />
              HMAC-SHA256 Signed
            </h5>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Tokens are cryptographically bound to specific automation IDs, run IDs, and version numbers.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -2, borderColor: "#cbd5e1" }}
            className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-1.5 transition"
          >
            <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              Single-Use Invalidation
            </h5>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Once consumed, tokens are invalidated immediately in the platform database to prevent replay attacks.
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -2, borderColor: "#cbd5e1" }}
            className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-1.5 transition"
          >
            <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-600" />
              Anti-Crawler Guard
            </h5>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              GET requests render a preview page only. State mutations require an explicit authenticated POST user action.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
};
