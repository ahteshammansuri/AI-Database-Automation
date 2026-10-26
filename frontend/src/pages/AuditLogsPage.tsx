import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { RefreshCw, ShieldCheck, Download, Search, ArrowRight, Bot, CheckCircle2, XCircle, Loader2, ChevronDown, ExternalLink } from "lucide-react";
import { EmptyState, FormAlert, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { api } from "../services/api";
import { orbitTargets } from "../services/orbitTargets";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useToast } from "../context/ToastContext";
import { humanStatus } from "../components/common/statusText";
import { formatInstant, defaultTimeZone, relativeFromNow } from "../lib/schedule";
import { CATEGORY_LABEL, categoryOf, describe, linkFor, toneOf, type AuditEntry } from "../components/audit/describeAudit";

type Tab = "all" | keyof typeof CATEGORY_LABEL;
const TABS: Tab[] = ["all", "connections", "automations", "approvals", "data", "ai", "account", "orbit"];

interface OrbitCall {
  id: number;
  at: string;
  request: string | null;
  task_id: number;
  tool: string;
  args: Record<string, any> | null;
  status: string;
  outcome: string | null;
  resource_refs: Record<string, any> | null;
  changed_something: boolean;
  verified: boolean;
  error_category: string | null;
  duration_ms: number | null;
}

const show = (v: any): string =>
  v === null || v === undefined || v === "" ? "empty"
    : Array.isArray(v) && v.every((x) => typeof x !== "object") ? v.join(", ")
      : typeof v === "object" ? JSON.stringify(v) : String(v);

/** The customer's audit trail: plain sentences, what changed (before -> after), what Orbit did, and CSV export. */
export const AuditLogsPage: React.FC = () => {
  const tz = defaultTimeZone();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [calls, setCalls] = useState<OrbitCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [selectedCall, setSelectedCall] = useState<OrbitCall | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const seq = useRef(0);

  const isOrbit = tab === "orbit";
  const filters = { category: tab === "all" || isOrbit ? undefined : tab, search: search || undefined, from: from || undefined, to: to || undefined };

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = isOrbit ? await api.orbitActivity({ search: search || undefined, page }) : await api.listAuditLogs({ ...filters, page });
      if (mine !== seq.current) return;
      if (isOrbit) setCalls(res?.data ?? []);
      else setLogs(res?.data ?? []);
      setLastPage(res?.last_page ?? 1);
      setTotal(res?.total ?? 0);
    } catch (e: any) {
      if (mine === seq.current) setError(e.message || "The audit log could not be loaded.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, from, to, page]);

  useEffect(() => { void load(); }, [load]);

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportAuditLog(filters);
      toast.success("Exported", "The audit log was downloaded as a CSV file.");
    } catch (e: any) {
      toast.error("Not exported", e.message);
    } finally {
      setExporting(false);
    }
  };

  // Orbit surface: filter and read the audit trail.
  useOrbitSurface("audit.page", () => ({
    describe: () => (isOrbit
      ? calls.slice(0, 20).map((c) => ({ id: c.id, request: c.request, tool: c.tool, status: c.status, outcome: c.outcome, at: c.at }))
      : logs.slice(0, 20).map((l) => ({ id: l.id, what: describe(l), action: l.action, at: l.created_at }))),
    fields: {
      action_filter: {
        get: () => tab,
        set: (v) => {
          const f = String(v).toLowerCase() as Tab;
          if (!TABS.includes(f)) return `Use one of: ${TABS.join(", ")}.`;
          setTab(f);
          setPage(1);
          return null;
        },
        options: () => TABS.map((v) => ({ value: v, label: v === "all" ? "All events" : CATEGORY_LABEL[v] })),
      },
      search: { get: () => searchInput, set: (v) => { setSearchInput(String(v ?? "").slice(0, 100)); return null; } },
    },
    actions: {
      refresh: { run: async () => { await load(); return { success: true, message: "Audit log reloaded." }; } },
      inspect: {
        target: (row) => `audit.row.${row}`,
        run: (row) => {
          const log = logs.find((l) => String(l.id) === String(row));
          if (!log) return { success: false, message: `Entry ${row} is not in the loaded list; use get_audit_log_entry for older entries.` };
          setSelected(log);
          return { success: true, message: "Entry details opened.", data: { what: describe(log), action: log.action, at: log.created_at } };
        },
      },
    },
  }));

  const changes = selected?.metadata?.changes && typeof selected.metadata.changes === "object" ? Object.entries(selected.metadata.changes as Record<string, { from: any; to: any }>) : [];
  const otherMeta = selected?.metadata ? Object.entries(selected.metadata).filter(([k]) => k !== "changes") : [];
  const link = selected ? linkFor(selected) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Audit log"
        description="A permanent record of what happened in your workspace: connections, schema, automations, approvals, data changes, and every action Orbit took for you."
        actions={
          <>
            {!isOrbit && (
              <button type="button" onClick={exportCsv} disabled={exporting} className="da-btn da-btn-secondary">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-slate-500" />} Export CSV
              </button>
            )}
            <button type="button" onClick={() => load()} disabled={loading} className="da-btn da-btn-secondary">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-indigo-600" : "text-slate-500"}`} /> Refresh
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="da-tabs overflow-x-auto" role="tablist" aria-label="Event type">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setPage(1); }}
              className={`da-tab whitespace-nowrap ${tab === t ? "da-tab-active" : ""}`}>
              {t === "orbit" && <Bot className="h-3.5 w-3.5 text-violet-500" />}
              {t === "all" ? "All events" : CATEGORY_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} maxLength={100}
              placeholder={isOrbit ? "Search what you asked or the action…" : "Search actions or ids…"} aria-label="Search the audit log" className="da-input pl-10" />
          </div>
          {!isOrbit && (
            <>
              <label className="text-[12px] text-slate-500">From
                <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="da-input mt-1 py-2" />
              </label>
              <label className="text-[12px] text-slate-500">To
                <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="da-input mt-1 py-2" />
              </label>
              {(from || to) && <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="da-btn da-btn-ghost da-btn-sm">Clear dates</button>}
            </>
          )}
        </div>
      </div>

      <FormAlert message={error} onClose={() => setError(null)} />

      {isOrbit ? (
        <div className="da-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 text-[12.5px] text-slate-500">
            Each action Orbit took for you, with the request it answered. Orbit works through the same checks as the portal: secrets are never typed or read, and changes need your confirmation.
          </div>
          {loading && !calls.length ? <Loading label="Loading Orbit's activity…" className="py-14" /> : calls.length === 0 ? (
            <EmptyState icon={Bot} title="Orbit has not acted yet" description={search ? "Nothing matches that search." : "When you ask Orbit to do something, every step it takes is listed here."} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {calls.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelectedCall(c)} className="flex w-full flex-col gap-1.5 px-5 py-3.5 text-left transition hover:bg-slate-50/70 sm:flex-row sm:items-start sm:justify-between">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        {c.status === "succeeded" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : c.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                        <span className="text-[13.5px] font-semibold text-slate-900">{humanStatus(c.tool)}</span>
                        {c.changed_something && <span className="da-chip da-chip-amber px-2 text-[10.5px]">Changed something</span>}
                        {c.verified && <span className="da-chip da-chip-emerald px-2 text-[10.5px]">Verified</span>}
                      </span>
                      {c.outcome && <span className="mt-0.5 block text-[13px] text-slate-600">{c.outcome}</span>}
                      {c.request && <span className="mt-0.5 block truncate text-[12px] text-slate-400">You asked: “{c.request}”</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-slate-400" title={formatInstant(c.at, tz, { withZone: true })}>{relativeFromNow(c.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="da-card overflow-hidden">
          {loading && !logs.length ? <Loading label="Loading the audit log…" className="py-14" /> : logs.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No matching events" description={search || from || to ? "Try another search or date range." : "Events appear here as you use the workspace."} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {logs.map((log) => {
                const cat = categoryOf(log.action);
                const n = log.metadata?.changes ? Object.keys(log.metadata.changes).length : 0;
                return (
                  <li key={log.id} ref={(el) => (el ? orbitTargets.register(`audit.row.${log.id}`, el) : orbitTargets.unregister(`audit.row.${log.id}`))}>
                    <button type="button" onClick={() => { setSelected(log); setShowRaw(false); }}
                      className="flex w-full flex-col gap-1 px-5 py-3.5 text-left transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={`da-chip ${toneOf(log.action)} shrink-0 px-2 text-[10.5px]`}>{CATEGORY_LABEL[cat]}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-slate-900">{describe(log)}</span>
                          {n > 0 && <span className="block text-[12px] text-slate-500">{n} field{n === 1 ? "" : "s"} changed · see before and after</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] text-slate-400" title={formatInstant(log.created_at, tz, { withZone: true })}>{relativeFromNow(log.created_at)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-between text-[13px] text-slate-600">
          <span>{total.toLocaleString()} entries · page {page} of {lastPage}</span>
          <span className="space-x-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="da-btn da-btn-secondary da-btn-sm">Previous</button>
            <button type="button" disabled={page >= lastPage || loading} onClick={() => setPage(page + 1)} className="da-btn da-btn-secondary da-btn-sm">Next</button>
          </span>
        </div>
      )}

      <ModalShell
        open={!!selected}
        onClose={() => setSelected(null)}
        size="lg"
        icon={ShieldCheck}
        title={selected ? describe(selected) : ""}
        description={selected ? `${formatInstant(selected.created_at, tz, { withZone: true })}${selected.ip_address ? ` · from ${selected.ip_address}` : ""}` : undefined}
        footer={
          <>
            {link && <Link to={link.to} onClick={() => setSelected(null)} className="da-btn da-btn-secondary mr-auto"><ExternalLink className="h-3.5 w-3.5" /> {link.label}</Link>}
            <button type="button" onClick={() => setSelected(null)} className="da-btn da-btn-secondary">Close</button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4 text-[13px]">
            {changes.length > 0 && (
              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">What changed</h4>
                <ul className="space-y-1.5">
                  {changes.map(([field, d]) => (
                    <li key={field} className="grid grid-cols-1 gap-1 rounded-xl border border-slate-200 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
                      <span className="truncate font-mono text-[12px] font-semibold text-slate-700">{field}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="break-all text-slate-500 line-through decoration-rose-300">{show(d?.from)}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="break-all font-semibold text-emerald-700">{show(d?.to)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {otherMeta.length > 0 && (
              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">Details</h4>
                <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {otherMeta.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
                      <dt className="text-[12px] font-semibold text-slate-500">{humanStatus(k)}</dt>
                      <dd className="break-all text-slate-800">{typeof v === "boolean" ? (v ? "Yes" : "No") : show(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="text-[12px] text-slate-500">
              <span className="font-mono">{selected.action}</span>
              {selected.resource_type && <> · {selected.resource_type}{selected.resource_id ? ` #${selected.resource_id}` : ""}</>}
            </div>
            <button type="button" onClick={() => setShowRaw((s) => !s)} className="flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:underline">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRaw ? "rotate-180" : ""}`} /> {showRaw ? "Hide" : "Show"} the recorded data
            </button>
            {showRaw && (
              <pre className="max-h-72 overflow-auto rounded-2xl bg-ink p-4 font-mono text-[11.5px] leading-relaxed text-emerald-300">{JSON.stringify(selected.metadata ?? {}, null, 2)}</pre>
            )}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        size="lg"
        icon={Bot}
        title={selectedCall ? humanStatus(selectedCall.tool) : ""}
        description={selectedCall ? `${formatInstant(selectedCall.at, tz, { withZone: true })}${selectedCall.duration_ms != null ? ` · took ${(selectedCall.duration_ms / 1000).toFixed(1)} s` : ""}` : undefined}
        footer={<button type="button" onClick={() => setSelectedCall(null)} className="da-btn da-btn-secondary">Close</button>}
      >
        {selectedCall && (
          <div className="space-y-4 text-[13px]">
            {selectedCall.request && (
              <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="text-[12px] font-semibold text-slate-500">You asked</span><p className="text-slate-800">“{selectedCall.request}”</p></div>
            )}
            <div className="rounded-xl border border-slate-200 px-3 py-2">
              <span className="text-[12px] font-semibold text-slate-500">Result</span>
              <p className="text-slate-800">{selectedCall.outcome || humanStatus(selectedCall.status)}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                <span className={`da-chip ${selectedCall.status === "succeeded" ? "da-chip-emerald" : selectedCall.status === "running" ? "da-chip-indigo" : "da-chip-rose"} px-2 text-[10.5px]`}>{humanStatus(selectedCall.status)}</span>
                <span className="da-chip da-chip-slate px-2 text-[10.5px]">{selectedCall.changed_something ? "Changed something" : "Read only, nothing changed"}</span>
                {selectedCall.verified && <span className="da-chip da-chip-emerald px-2 text-[10.5px]">Checked afterwards</span>}
                {selectedCall.error_category && <span className="da-chip da-chip-rose px-2 text-[10.5px]">{humanStatus(selectedCall.error_category)}</span>}
              </p>
            </div>
            {selectedCall.args && Object.keys(selectedCall.args).length > 0 && (
              <div>
                <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">What Orbit used (secrets removed)</h4>
                <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {Object.entries(selectedCall.args).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
                      <dt className="text-[12px] font-semibold text-slate-500">{humanStatus(k)}</dt>
                      <dd className="break-all text-slate-800">{show(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {selectedCall.resource_refs?.execution_id && (
              <Link to={`/executions?id=${selectedCall.resource_refs.execution_id}`} onClick={() => setSelectedCall(null)} className="da-btn da-btn-secondary da-btn-sm">
                <ExternalLink className="h-3.5 w-3.5" /> Open run #{selectedCall.resource_refs.execution_id}
              </Link>
            )}
          </div>
        )}
      </ModalShell>
    </motion.div>
  );
};
