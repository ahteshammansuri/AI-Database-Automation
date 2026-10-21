import { useOrbitSurface } from "../hooks/useOrbitSurface";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, ShieldCheck, Eye } from "lucide-react";
import { Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { api } from "../services/api";
import { orbitTargets } from "../services/orbitTargets";

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [selectedMeta, setSelectedMeta] = useState<any | null>(null);

  // Orbit surface: filter and read the audit trail.
  useOrbitSurface("audit.page", () => ({
    describe: () => logs.slice(0, 20).map((l: any) => ({ id: l.id, action: l.action, resource: l.resource_type, at: l.created_at })),
    fields: {
      action_filter: {
        get: () => filterAction,
        set: (v) => { const f = String(v).toUpperCase(); if (!["ALL", "CONNECTION", "SCHEMA", "AUTOMATION", "APPROVAL"].includes(f)) return "Use ALL, CONNECTION, SCHEMA, AUTOMATION or APPROVAL."; setFilterAction(f); return null; },
        options: () => ["ALL", "CONNECTION", "SCHEMA", "AUTOMATION", "APPROVAL"].map((v) => ({ value: v, label: v })),
      },
    },
    actions: {
      refresh: { run: async () => { await fetchLogs(); return { success: true, message: "Audit log reloaded." }; } },
      inspect: {
        target: (row) => `audit.row.${row}`,
        run: (row) => {
          const log = logs.find((l: any) => String(l.id) === String(row));
          if (!log) return { success: false, message: `Entry ${row} is not in the loaded list; use get_audit_log_entry for older entries.` };
          setSelectedMeta(log.metadata);
          return { success: true, message: "Entry details opened.", data: { action: log.action, resource: log.resource_type, resource_id: log.resource_id, at: log.created_at } };
        },
      },
    },
  }));

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await api.listAuditLogs() as any;
      setLogs(Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []));
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filterAction === "ALL") return true;
    return log.action?.includes(filterAction);
  });

  const actionTone = (action: string) =>
    /FAIL|ERROR|DENIED|BLOCK/.test(action) ? "da-chip-rose"
      : /DELETE|REMOVE|REJECT/.test(action) ? "da-chip-amber"
        : /PUBLISH|APPROV|COMMIT|CREATED|SAVED/.test(action) ? "da-chip-emerald"
          : "da-chip-indigo";

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Audit log"
        description="A permanent record of connection changes, schema scans, runs, approvals and data changes in your workspace."
        actions={
          <button type="button" onClick={fetchLogs} disabled={loading} className="da-btn da-btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-indigo-600" : "text-slate-500"}`} /> Refresh
          </button>
        }
      />

      <div className="da-tabs" role="tablist" aria-label="Event type">
        {["ALL", "CONNECTION", "SCHEMA", "AUTOMATION", "APPROVAL"].map((cat) => (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={filterAction === cat}
            onClick={() => setFilterAction(cat)}
            className={`da-tab ${filterAction === cat ? "da-tab-active" : ""}`}
          >
            {cat === "ALL" ? "All events" : cat.charAt(0) + cat.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="da-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="da-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Resource</th>
                <th>ID</th>
                <th>IP address</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6}><Loading label="Loading the audit log…" className="py-14" /></td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-400">No matching events.</td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    ref={(el) => (el ? orbitTargets.register(`audit.row.${log.id}`, el) : orbitTargets.unregister(`audit.row.${log.id}`))}
                  >
                    <td className="whitespace-nowrap font-mono text-[12.5px] text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="whitespace-nowrap"><span className={`da-chip ${actionTone(String(log.action || ""))} font-mono`}>{log.action}</span></td>
                    <td className="whitespace-nowrap font-semibold text-slate-900">{log.resource_type}</td>
                    <td className="whitespace-nowrap font-mono text-slate-500">{log.resource_id || "—"}</td>
                    <td className="whitespace-nowrap font-mono text-slate-500">{log.ip_address || "—"}</td>
                    <td className="text-right">
                      {log.metadata ? (
                        <button type="button" onClick={() => setSelectedMeta(log.metadata)} className="da-btn da-btn-secondary da-btn-sm">
                          <Eye className="h-3.5 w-3.5" /> Inspect
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ModalShell
        open={!!selectedMeta}
        onClose={() => setSelectedMeta(null)}
        icon={ShieldCheck}
        title="Event details"
        description="Recorded metadata for this audit entry."
        footer={<button type="button" onClick={() => setSelectedMeta(null)} className="da-btn da-btn-secondary">Close</button>}
      >
        <pre className="max-h-96 overflow-auto rounded-2xl bg-ink p-5 font-mono text-[12px] leading-relaxed text-emerald-300">
          {JSON.stringify(selectedMeta, null, 2)}
        </pre>
      </ModalShell>
    </motion.div>
  );
};
