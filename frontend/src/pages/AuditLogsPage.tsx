import { useOrbitSurface } from "../hooks/useOrbitSurface";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, RefreshCw, ShieldCheck, Search, Filter, Eye, X } from "lucide-react";
import { api } from "../services/api";

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Audit & Compliance
            </span>
            <span className="text-xs text-slate-400">• Immutable Security Ledger</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Audit Trail & Security Logs</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable log of all connection mutations, schema tests, executions, and approval decisions
          </p>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={fetchLogs}
            disabled={loading}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600" : "text-slate-500"}`} />
            <span>Refresh Ledger</span>
          </motion.button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 text-xs">
        {["ALL", "CONNECTION", "SCHEMA", "AUTOMATION", "APPROVAL"].map((cat) => (
          <motion.button
            key={cat}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setFilterAction(cat)}
            className={`px-3 py-1.5 rounded-xl font-semibold transition-all ${
              filterAction === cat
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {cat === "ALL" ? "All Events" : cat}
          </motion.button>
        ))}
      </div>

      {/* Audit Log Table */}
      <motion.div
        whileHover={{ y: -1 }}
        className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Timestamp</th>
                <th className="px-5 py-3.5">Action</th>
                <th className="px-5 py-3.5">Resource</th>
                <th className="px-5 py-3.5">Resource ID</th>
                <th className="px-5 py-3.5">IP Address</th>
                <th className="px-5 py-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Loading audit ledger entries...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                    No matching audit records found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition group">
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-900">
                      {log.resource_type}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 font-mono">
                      {log.resource_id || "—"}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 font-mono">
                      {log.ip_address || "127.0.0.1"}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {log.metadata ? (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setSelectedMeta(log.metadata)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-lg text-[11px] font-semibold transition inline-flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Inspect</span>
                        </motion.button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Metadata Detail Modal */}
      <AnimatePresence>
        {selectedMeta && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedMeta(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-base font-bold text-slate-900">Audit Record Metadata</h3>
                </div>
                <button
                  onClick={() => setSelectedMeta(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <pre className="p-4 bg-slate-900 text-emerald-300 font-mono text-xs rounded-xl overflow-x-auto max-h-80 leading-relaxed border border-slate-800">
                {JSON.stringify(selectedMeta, null, 2)}
              </pre>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setSelectedMeta(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
