import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Eye,
  Clock,
  CheckCircle,
  AlertCircle,
  Play,
  RotateCcw,
  XCircle,
  PauseCircle,
  PlayCircle,
  Send,
  Zap,
  Activity,
  Layers,
  ChevronRight,
  ShieldCheck,
  FileText,
  FileEdit,
  Save,
  Database,
  Image as ImageIcon,
  Cpu,
  BookOpen,
  Sparkles,
  ExternalLink,
  Tag,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useLiveEvents } from "../context/LiveEventsContext";
import { useToast } from "../context/ToastContext";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { useSearchParams } from "react-router-dom";
import { ContentPreview } from "../components/content/ContentPreview";
import { formatInstant, relativeFromNow } from "../lib/schedule";

const TRIGGER_LABEL: Record<string, string> = { SCHEDULE: "Scheduled", MANUAL: "Run now", MANUAL_PUBLISH: "Manual post" };

export const ExecutionsPage: React.FC = () => {
  const [executions, setExecutions] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<"preview" | "provenance" | "timeline" | "raw" | "edit_record">("preview");
  const [copiedJson, setCopiedJson] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [editRecordPayload, setEditRecordPayload] = useState<Record<string, any>>({});
  const [isUpdatingRecord, setIsUpdatingRecord] = useState(false);

  const { addListener } = useLiveEvents();
  const { toast, showAlert } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const automationFilter = searchParams.get("automation") ? Number(searchParams.get("automation")) : undefined;
  const [versionIdx, setVersionIdx] = useState<number>(0);

  const loadData = async (silent = false) => {
    try {
      if (!silent && executions.length === 0) setLoading(true);
      const res = await api.listExecutions(page, 15, selectedStatus || undefined, automationFilter);
      const items = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res)
        ? res
        : [];
      setExecutions(items);
      setTotalPages(res?.last_page || res?.total_pages || 1);
    } catch (err: any) {
      console.error(err);
      if (!silent) {
        toast.error("Failed to Load Executions", err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, selectedStatus, automationFilter]);

  // Subscribe to live SSE events to update table state in real time
  useEffect(() => {
    const unsubscribe = addListener((event) => {
      if (event.event_name?.startsWith("execution.")) {
        // Silently reload canonical execution rows
        loadData(true);
      }
    });
    return unsubscribe;
  }, [addListener, page, selectedStatus]);

  // ---- Orbit surface: the same API calls as the row buttons (row = execution id) --------------
  useOrbitSurface("executions.list", () => {
    const find = (row?: string) => executions.find((e: any) => String(e.id) === String(row));
    const rowCall = (verb: string, call: (id: number) => Promise<any>) => ({
      target: (row?: string) => `executions.row.${row}`,
      run: async (row?: string) => {
        if (!find(row)) return { success: false, message: `No run ${row} in the visible list (try the status filter or read_screen).` };
        try {
          setProcessingId(Number(row));
          const res: any = await call(Number(row));
          loadData(true);
          return { success: true, message: res?.message || `${verb} done.`, resource: { type: "AutomationExecution", id: Number(row) } };
        } catch (err: any) {
          return { success: false, message: err.message || `${verb} failed.` };
        } finally {
          setProcessingId(null);
        }
      },
    });
    return {
      describe: () => executions.map((e: any) => ({
        id: e.id, automation: e.automation?.name ?? e.automation_name ?? e.automation_id, status: e.status,
        created_at: e.created_at, error: e.error_message ? String(e.error_message).slice(0, 160) : undefined,
      })),
      fields: {
        status_filter: {
          get: () => selectedStatus,
          set: (v) => { setSelectedStatus(String(v ?? "")); setPage(1); return null; },
          options: () => ["", "PENDING_APPROVAL", "PUBLISHED", "FAILED", "REJECTED", "CANCELLED", "SCHEDULED"].map((v) => ({ value: v, label: v || "All" })),
        },
      },
      actions: {
        view: {
          target: (row) => `executions.row.${row}`,
          run: async (row) => {
            const e = find(row);
            if (!e) return { success: false, message: `No run ${row} in the visible list.` };
            await handleViewExecution(e);
            return { success: true, message: "Run details opened.", data: { status: e.status, error: e.error_message } };
          },
        },
        retry: rowCall("Retry", (id) => api.retryExecution(id)),
        cancel: rowCall("Cancel", (id) => api.cancelExecution(id)),
        pause: rowCall("Pause", (id) => api.pauseExecution(id)),
        resume: rowCall("Resume", (id) => api.resumeExecution(id)),
        publish_now: rowCall("Publish", (id) => api.publishNow(id)),
      },
    };
  });

  const handleViewExecution = async (execSummary: any) => {
    setSelectedExecution(execSummary);
    setActiveModalTab("preview");
    setVersionIdx(0);
    setCopiedJson(false);
    const initialPayload = execSummary?.versions?.[0]?.payload || execSummary?.payload || {};
    setEditRecordPayload(initialPayload);
    try {
      setLoadingDetail(true);
      const full = await api.getExecution(execSummary.id);
      setSelectedExecution(full);
      const fullPayload = full?.versions?.[0]?.payload || full?.payload || initialPayload;
      setEditRecordPayload(fullPayload);
    } catch (err: any) {
      console.error("Failed to load execution details", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleUpdatePublishedRecord = async () => {
    if (!selectedExecution?.id) return;
    try {
      setIsUpdatingRecord(true);
      toast.info("Updating Record", "Applying parameterized UPDATE to target database...");
      const res = await api.updatePublishedRecord(selectedExecution.id, editRecordPayload);
      toast.success("Record Updated", res.message || "Record successfully updated in MySQL!");
      setSelectedExecution(res.execution);
      loadData(true);
    } catch (err: any) {
      toast.error("Update Failed", err.message || "Failed to update record in target database.");
    } finally {
      setIsUpdatingRecord(false);
    }
  };

  const handlePublishNow = async (id: number) => {
    try {
      setProcessingId(id);
      toast.info("Publishing Record", `Dispatching immediate publication for run #${id}...`);
      const res = await api.publishNow(id);
      toast.success("Publication Dispatched", res.message || "Publishing job dispatched to queue worker.");
      loadData(true);
    } catch (err: any) {
      toast.error("Publishing Failed", err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRetry = async (id: number) => {
    try {
      setProcessingId(id);
      toast.info("Requeuing Job", `Submitting execution #${id} for retry...`);
      const res = await api.retryExecution(id);
      toast.success("Job Requeued", res.message || "Execution safely requeued for fair dispatch.");
      loadData(true);
    } catch (err: any) {
      toast.error("Retry Failed", err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = (id: number) => {
    showAlert({
      title: "Cancel Execution?",
      text: `Are you sure you want to cancel execution #${id} before target database write?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Cancel Job",
      cancelButtonText: "Keep Running",
      onConfirm: async () => {
        try {
          setProcessingId(id);
          const res = await api.cancelExecution(id);
          toast.success("Job Cancelled", res.message || "Execution cancelled safely.");
          loadData(true);
        } catch (err: any) {
          toast.error("Cancel Failed", err.message);
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  const handlePause = async (id: number) => {
    try {
      setProcessingId(id);
      const res = await api.pauseExecution(id);
      toast.info("Execution Paused", res.message || "Execution paused.");
      loadData(true);
    } catch (err: any) {
      toast.error("Pause Failed", err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleResume = async (id: number) => {
    try {
      setProcessingId(id);
      const res = await api.resumeExecution(id);
      toast.success("Execution Resumed", res.message || "Execution resumed and queued.");
      loadData(true);
    } catch (err: any) {
      toast.error("Resume Failed", err.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div id="executions-history-anchor" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Durable Queue Ledger
            </span>
            <span className="text-xs text-slate-500">• Equal Priority & Fair Dispatch</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Execution history</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every run: what was generated, when it publishes, and exactly what was written to your database.
          </p>
          {automationFilter && (
            <button
              type="button"
              onClick={() => { searchParams.delete("automation"); setSearchParams(searchParams); setPage(1); }}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Showing one automation · <span className="underline">show all</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs w-full sm:w-56">
          <span className="text-slate-500 font-medium shrink-0">Filter Status:</span>
          <SearchableSelect
            value={selectedStatus}
            onChange={(val) => {
              setSelectedStatus(String(val));
              setPage(1);
            }}
            placeholder="All Statuses"
            searchPlaceholder="Filter status..."
            allowClear={true}
            options={[
              { value: "", label: "All Statuses" },
              { value: "QUEUED", label: "QUEUED", badge: "wait" },
              { value: "RUNNING", label: "RUNNING", badge: "active" },
              { value: "GENERATING", label: "GENERATING", badge: "ai" },
              { value: "PENDING_APPROVAL", label: "PENDING_APPROVAL", badge: "review" },
              { value: "READY_TO_PUBLISH", label: "READY_TO_PUBLISH", badge: "held" },
              { value: "PUBLISHING", label: "PUBLISHING", badge: "atomic" },
              { value: "PUBLISHED", label: "PUBLISHED", badge: "done" },
              { value: "PAUSED", label: "PAUSED", badge: "held" },
              { value: "FAILED", label: "FAILED", badge: "error" },
              { value: "CANCELLED", label: "CANCELLED", badge: "abort" },
            ]}
          />
        </div>
      </div>

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between shadow-2xs ${
              actionMsg.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : actionMsg.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-indigo-50 border-indigo-200 text-indigo-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMsg.type === "success" ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{actionMsg.text}</span>
            </div>
            <button onClick={() => setActionMsg(null)} className="font-bold ml-4">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && executions.length === 0 ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading execution records...</p>
        </div>
      ) : executions.length === 0 ? (
        <div className="py-16 text-center bg-white border border-dashed border-slate-300 rounded-2xl shadow-xs p-8">
          <History className="w-10 h-10 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-900">No execution records found</h3>
          <p className="text-xs text-slate-500 mt-1">Run an automation or trigger manual publication to populate history.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3 sm:px-4">Run</th>
                  <th className="py-3 px-3 sm:px-4">Automation</th>
                  <th className="py-3 px-3 sm:px-4">Status</th>
                  <th className="py-3 px-3 sm:px-4 hidden md:table-cell">Publishes</th>
                  <th className="py-3 px-4 hidden xl:table-cell">Generation time</th>
                  <th className="py-3 px-4 hidden xl:table-cell">Retries</th>
                  <th className="py-3 px-4 hidden lg:table-cell">Record</th>
                  <th className="py-3 px-3 sm:px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {executions.map((e) => {
                  const isProcessing = processingId === e.id;
                  const queueWait = e.queue_wait_ms ? `${(e.queue_wait_ms / 1000).toFixed(2)}s` : "-";
                  const execDuration = e.execution_duration_ms ? `${(e.execution_duration_ms / 1000).toFixed(2)}s` : "-";

                  return (
                    <tr
                      key={e.id}
                      title={e.created_at ? `Created ${new Date(e.created_at).toLocaleString()}` : undefined}
                      ref={(el: HTMLTableRowElement | null) =>
                        el ? orbitTargets.register(`executions.row.${e.id}`, el) : orbitTargets.unregister(`executions.row.${e.id}`)
                      }
                      className="hover:bg-slate-50/70 transition-colors font-mono"
                    >
                      <td className="py-3 px-3 sm:px-4 align-top">
                        <span className="font-bold text-slate-900">#{e.id}</span>
                        <span className="block font-sans text-[10px] text-slate-400">{TRIGGER_LABEL[e.trigger_type] ?? "Run"}{e.occurrence_date ? ` · ${String(e.occurrence_date).slice(0, 10)}` : ""}</span>
                      </td>
                      <td className="py-3 px-3 sm:px-4 font-sans text-slate-800 font-medium align-top">
                        <span className="line-clamp-2">{e.automation?.name || `Automation #${e.automation_id}`}</span>
                        {e.automation?.target_table && <span className="block font-mono text-[10px] text-slate-400">{e.automation.target_table}</span>}
                      </td>
                      <td className="py-3 px-3 sm:px-4 font-sans align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={e.status} size="sm" />
                          {e.failure_category && (
                            <span className="text-[9px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-mono font-bold">
                              {e.failure_category}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-slate-600 font-sans text-[11px] hidden md:table-cell align-top">
                        {e.publication_time ? (
                          <>
                            <span className="block font-semibold text-slate-800">{formatInstant(e.published_at || e.publication_time, e.automation?.timezone || "UTC", { withYear: false })}</span>
                            <span className="text-slate-400">{e.published_at ? "published" : relativeFromNow(e.publication_time)}</span>
                          </>
                        ) : "-"}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px] hidden xl:table-cell align-top">{execDuration}<span className="block text-slate-400">wait {queueWait}</span></td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px] hidden xl:table-cell align-top">
                        {e.retry_count > 0 ? `${e.retry_count}/${e.max_retries || 3}` : "-"}
                      </td>
                      <td className="py-3 px-4 text-indigo-600 font-semibold hidden lg:table-cell align-top">
                        {e.target_record_id ? `#${e.target_record_id}` : "-"}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right font-sans align-top">
                        <div className="flex flex-wrap justify-end gap-1.5">
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleViewExecution(e)}
                          className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs inline-flex items-center gap-1 font-medium transition shadow-2xs"
                        >
                          <Eye className="w-3 h-3" /> View
                        </motion.button>

                        {/* Publish Now for Ready/Approved */}
                        {(e.status === "READY_TO_PUBLISH" || e.status === "APPROVED") && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isProcessing}
                            onClick={() => handlePublishNow(e.id)}
                            className="btn-primary-gradient px-2.5 py-1 text-white rounded-lg text-xs font-semibold shadow-xs"
                          >
                            Publish Now
                          </motion.button>
                        )}

                        {/* Retry for Failed/Cancelled */}
                        {(e.status === "FAILED" || e.status === "CANCELLED") && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isProcessing}
                            onClick={() => handleRetry(e.id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 shadow-2xs"
                          >
                            <RotateCcw className="w-3 h-3" /> Retry
                          </motion.button>
                        )}

                        {/* Pause for Queued */}
                        {e.status === "QUEUED" && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isProcessing}
                            onClick={() => handlePause(e.id)}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium inline-flex items-center gap-1 shadow-2xs"
                          >
                            <PauseCircle className="w-3 h-3" /> Pause
                          </motion.button>
                        )}

                        {/* Resume for Paused */}
                        {e.status === "PAUSED" && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isProcessing}
                            onClick={() => handleResume(e.id)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium inline-flex items-center gap-1 shadow-2xs"
                          >
                            <PlayCircle className="w-3 h-3" /> Resume
                          </motion.button>
                        )}

                        {/* Cancel for In-Flight before target commit */}
                        {["QUEUED", "RUNNING", "GENERATING", "PENDING_APPROVAL", "READY_TO_PUBLISH"].includes(e.status) && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            disabled={isProcessing}
                            onClick={() => handleCancel(e.id)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium"
                            title="Cancel execution before target write"
                          >
                            <XCircle className="w-3 h-3" />
                          </motion.button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-3 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>Page {page} of {totalPages}</span>
              <div className="space-x-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 bg-white border border-slate-200 disabled:opacity-40 rounded shadow-xs font-medium"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 bg-white border border-slate-200 disabled:opacity-40 rounded shadow-xs font-medium"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comprehensive Execution Inspector Modal with Visual Preview, RAG & Timeline */}
      <AnimatePresence>
        {selectedExecution && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[94vh] sm:max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex shrink-0 flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">
                        Execution Run #{selectedExecution.id}
                      </h3>
                      <StatusPill status={selectedExecution.status} size="sm" />
                      {loadingDetail && (
                        <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Pipeline: <span className="font-semibold text-slate-800">{selectedExecution.automation?.name || `Automation #${selectedExecution.automation_id}`}</span> • Target Table: <span className="font-mono text-indigo-600 font-semibold">{selectedExecution.automation?.target_table || "posts"}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={() => setSelectedExecution(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg font-bold text-sm transition"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Top Metrics Ribbon */}
              <div className="hidden shrink-0 grid-cols-2 sm:grid sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Target Record</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {selectedExecution.target_record_id ? `#${selectedExecution.target_record_id}` : "Pending Write"}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Queue Wait</span>
                  <span className="font-bold text-indigo-600 text-xs">
                    {selectedExecution.queue_wait_ms !== null && selectedExecution.queue_wait_ms !== undefined
                      ? `${(Math.max(0, selectedExecution.queue_wait_ms) / 1000).toFixed(2)}s`
                      : "-"}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Execution Duration</span>
                  <span className="font-bold text-emerald-600 text-xs">
                    {selectedExecution.execution_duration_ms !== null && selectedExecution.execution_duration_ms !== undefined
                      ? `${(selectedExecution.execution_duration_ms / 1000).toFixed(2)}s`
                      : "-"}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 truncate">
                  <span className="text-[10px] text-slate-400 uppercase font-sans font-bold block">Idempotency Key</span>
                  <span className="text-slate-700 text-[11px] truncate block" title={selectedExecution.idempotency_key}>
                    {selectedExecution.idempotency_key ? String(selectedExecution.idempotency_key).slice(0, 14) + "..." : "-"}
                  </span>
                </div>
              </div>

              {/* Navigation Tab Bar */}
              <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 pb-1 text-xs font-semibold overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveModalTab("preview")}
                  className={`px-3 py-1.5 rounded-xl transition flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                    activeModalTab === "preview"
                      ? "bg-indigo-600 text-white shadow-2xs font-bold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Content</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModalTab("provenance")}
                  className={`px-3 py-1.5 rounded-xl transition flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                    activeModalTab === "provenance"
                      ? "bg-indigo-600 text-white shadow-2xs font-bold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>AI & RAG Provenance</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModalTab("timeline")}
                  className={`px-3 py-1.5 rounded-xl transition flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                    activeModalTab === "timeline"
                      ? "bg-indigo-600 text-white shadow-2xs font-bold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Process Timeline ({((selectedExecution.timeline || selectedExecution.timeline_events) || []).length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModalTab("raw")}
                  className={`px-3 py-1.5 rounded-xl transition flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                    activeModalTab === "raw"
                      ? "bg-indigo-600 text-white shadow-2xs font-bold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Raw Technical JSON</span>
                </button>
                {selectedExecution.status === "PUBLISHED" && selectedExecution.target_record_id && (
                  <button
                    type="button"
                    onClick={() => setActiveModalTab("edit_record")}
                    className={`px-3 py-1.5 rounded-xl transition flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                      activeModalTab === "edit_record"
                        ? "bg-amber-600 text-white shadow-2xs font-bold"
                        : "text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200"
                    }`}
                  >
                    <FileEdit className="w-3.5 h-3.5" />
                    <span>Edit Published Record #{selectedExecution.target_record_id}</span>
                  </button>
                )}
              </div>

              {/* Tab Content Panes */}
              <div className="space-y-4 overflow-y-auto flex-1 min-h-0 text-xs pr-1">
                {selectedExecution.error_message && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
                    <strong className="flex items-center gap-1.5 text-rose-900">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      Execution Error {selectedExecution.failure_category && `(${selectedExecution.failure_category})`}:
                    </strong>
                    <p className="font-mono text-[11px] text-rose-800 leading-relaxed">
                      {selectedExecution.error_message}
                    </p>
                    {selectedExecution.status === "FAILED" && (
                      <button
                        type="button"
                        onClick={() => {
                          handleRetry(selectedExecution.id);
                          setSelectedExecution(null);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry Execution Now</span>
                      </button>
                    )}
                  </div>
                )}

                {(() => {
                  const payload =
                    selectedExecution.payload ||
                    selectedExecution.result_details?.payload ||
                    (selectedExecution.versions && selectedExecution.versions[0]?.payload) ||
                    (selectedExecution.result_details &&
                    typeof selectedExecution.result_details === "object" &&
                    !selectedExecution.result_details.table
                      ? selectedExecution.result_details
                      : null) ||
                    {};

                  const timelineEvents: any[] =
                    selectedExecution.timeline && selectedExecution.timeline.length > 0
                      ? selectedExecution.timeline
                      : selectedExecution.timeline_events || [];

                  // RAG provenance
                  const ragEvent = timelineEvents.find(
                    (t: any) => t.stage === "RAG_CONTEXT_RETRIEVED" || t.event === "RAG_CONTEXT_RETRIEVED"
                  );
                  const ragPassages = ragEvent?.metadata?.retrieved_passages || [];
                  const ragQuery = ragEvent?.metadata?.query || selectedExecution.automation?.prompt_context || "";

                  // AI provenance
                  const aiStartEvent = timelineEvents.find(
                    (t: any) => t.stage === "AI_INFERENCE_STARTED" || t.event === "AI_INFERENCE_STARTED"
                  );
                  const aiCompEvent = timelineEvents.find(
                    (t: any) => t.stage === "AI_INFERENCE_COMPLETED" || t.event === "AI_INFERENCE_COMPLETED"
                  );
                  const aiProvider =
                    aiStartEvent?.metadata?.provider ||
                    selectedExecution.automation?.ai_provider ||
                    "ollama";
                  const aiModel =
                    aiStartEvent?.metadata?.model ||
                    selectedExecution.automation?.ai_model ||
                    "llama3.2:1b";
                  const promptPreview =
                    aiStartEvent?.metadata?.prompt_preview ||
                    selectedExecution.automation?.prompt_context ||
                    "";
                  const aiLatency = aiCompEvent?.metadata?.latency_seconds;

                  // Relational resolutions
                  const relationResolutions: any[] =
                    (selectedExecution.relation_resolutions && selectedExecution.relation_resolutions.length > 0)
                      ? selectedExecution.relation_resolutions
                      : timelineEvents
                          .filter((t: any) => t.stage === "RELATION_RESOLVED")
                          .map((t: any) => t.metadata || { details: t.message });

                  // Banner image preview extraction
                  const bannerImg =
                    payload.banner ||
                    payload.meta_img ||
                    payload.image ||
                    payload.thumbnail ||
                    payload.cover ||
                    payload.photo ||
                    payload.featured_image;

                  // Filter technical keys out of standard attribute grid
                  const payloadKeys = Object.keys(payload).filter(
                    (k) =>
                      ![
                        "relation_resolutions",
                        "columns_written",
                        "success",
                        "table",
                        "record_id",
                        "operation",
                      ].includes(k)
                  );

                  // TAB 1: Rendered content, database write plan and provenance (shared preview)
                  if (activeModalTab === "preview") {
                    const versions: any[] = [...(selectedExecution.versions ?? [])].sort((a: any, b: any) => b.version_number - a.version_number);
                    const v = versions[versionIdx] ?? versions[0];
                    const vPayload = v?.payload ?? payload;
                    const tz = selectedExecution.automation?.timezone || "UTC";
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-2.5">
                            <span className="block text-[10px] font-bold uppercase text-slate-400">Generated</span>
                            <span className="block text-[11px] sm:text-xs font-semibold leading-snug text-slate-800">{selectedExecution.generation_completed_at ? formatInstant(selectedExecution.generation_completed_at, tz) : "Not yet"}</span>
                          </div>
                          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-2.5">
                            <span className="block text-[10px] font-bold uppercase text-slate-400">{selectedExecution.published_at ? "Published" : "Publishes"}</span>
                            <span className="block text-[11px] sm:text-xs font-semibold leading-snug text-slate-800">{selectedExecution.published_at ? formatInstant(selectedExecution.published_at, tz) : selectedExecution.publication_time ? formatInstant(selectedExecution.publication_time, tz) : "—"}</span>
                          </div>
                          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-2.5">
                            <span className="block text-[10px] font-bold uppercase text-slate-400">Written as</span>
                            <span className="block text-[11px] sm:text-xs font-semibold leading-snug text-slate-800 break-words">{selectedExecution.target_record_id ? `${selectedExecution.automation?.target_table ?? "row"} #${selectedExecution.target_record_id}` : "Not written yet"}</span>
                          </div>
                        </div>

                        {versions.length > 1 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-500">Version:</span>
                            {versions.map((ver: any, i: number) => (
                              <button
                                key={ver.id}
                                type="button"
                                onClick={() => setVersionIdx(i)}
                                className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${i === versionIdx ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"}`}
                              >
                                v{ver.version_number} · {String(ver.status).toLowerCase().replace(/_/g, " ")}
                              </button>
                            ))}
                          </div>
                        )}
                        {v?.rejection_feedback && (
                          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                            Written after reviewer feedback: “{v.rejection_feedback}”
                          </p>
                        )}

                        {v || Object.keys(vPayload || {}).length ? (
                          <ContentPreview
                            payload={vPayload || {}}
                            meta={v?.meta}
                            targetTable={selectedExecution.automation?.target_table}
                            timezone={tz}
                            publicationTime={selectedExecution.published_at ? null : selectedExecution.publication_time}
                            showStatusBanner={!selectedExecution.published_at}
                          />
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                            {["QUEUED", "GENERATING", "PENDING_GENERATION", "REGENERATING"].includes(selectedExecution.status)
                              ? "Content is being generated. This view updates when it is ready."
                              : "No content was generated for this run."}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // TAB 2: AI & RAG Provenance
                  if (activeModalTab === "provenance") {
                    return (
                      <div className="space-y-4">
                        {/* 1. Inference Engine Card */}
                        <div className="p-4 bg-gradient-to-r from-indigo-50/70 via-purple-50/40 to-slate-50 border border-indigo-200 rounded-2xl space-y-3 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-2xs">
                                <Cpu className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900">
                                  AI Generation Inference Basis
                                </h4>
                                <p className="text-[11px] text-slate-500">
                                  Configured model provider and prompt directions
                                </p>
                              </div>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase font-mono">
                              {aiProvider}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                            <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                              <span className="text-[10px] text-slate-400 block font-bold">Model Engine</span>
                              <span className="font-mono font-bold text-slate-900">{aiModel}</span>
                            </div>
                            <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                              <span className="text-[10px] text-slate-400 block font-bold">Generation Latency</span>
                              <span className="font-mono font-bold text-emerald-700">
                                {aiLatency ? `${Number(aiLatency).toFixed(2)}s` : "Normal execution"}
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                              <span className="text-[10px] text-slate-400 block font-bold">RAG Augmented</span>
                              <span className="font-bold text-indigo-700">
                                {ragPassages.length > 0
                                  ? `Yes (${ragPassages.length} passages)`
                                  : "Direct Prompt Context"}
                              </span>
                            </div>
                          </div>

                          {/* Prompt Context Box */}
                          {promptPreview && (
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                Prompt Instructions & Topic Brief:
                              </span>
                              <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                                {promptPreview}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 2. RAG Context Retrieval Details */}
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                              RAG Semantic Retrieval Passages ({ragPassages.length})
                            </h4>
                            {ragQuery && (
                              <span className="text-[11px] text-slate-500 font-mono">
                                Query: &quot;{ragQuery}&quot;
                              </span>
                            )}
                          </div>

                          {ragPassages.length > 0 ? (
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                              {ragPassages.map((p: any, i: number) => {
                                const scoreVal = p.score !== undefined ? p.score : 0.85;
                                const pct = Math.min(100, Math.max(0, scoreVal > 1 ? scoreVal : scoreVal * 100));

                                return (
                                  <div
                                    key={i}
                                    className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-indigo-900 text-[11px] flex items-center gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                                          #{i + 1}
                                        </span>
                                        Chunk #{p.chunk_id || i + 1} (Doc #{p.document_id || "KB"})
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                          <div
                                            className="h-full bg-emerald-500 rounded-full"
                                            style={{ width: `${pct}%` }}
                                          />
                                        </div>
                                        <span className="font-mono text-emerald-700 font-bold text-[11px]">
                                          {pct.toFixed(1)}% match
                                        </span>
                                      </div>
                                    </div>
                                    <p className="p-2 bg-white border border-slate-200 rounded-lg text-slate-700 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                                      {p.snippet || p.content || p.text}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
                              <BookOpen className="w-6 h-6 text-slate-300 mx-auto" />
                              <p className="text-slate-600 font-semibold text-xs">
                                No RAG documents were attached to this execution.
                              </p>
                              <p className="text-[11px] text-slate-400">
                                Content was synthesized directly from user-configured topic guidelines and schema constraints.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* 3. Target Database Relational Category Resolution */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5 text-indigo-600" />
                            Target Database Relational Category Resolution
                          </h4>

                          {relationResolutions.length > 0 ? (
                            <div className="space-y-2">
                              {relationResolutions.map((r: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="p-3 bg-white border border-slate-200 rounded-xl flex items-start justify-between gap-3 shadow-2xs"
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-slate-900 text-xs">
                                        {r.table || "categories"}
                                      </span>
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          r.action === "CREATED_NEW"
                                            ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                            : r.action === "MATCHED_EXISTING"
                                            ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                            : "bg-slate-100 text-slate-700"
                                        }`}
                                      >
                                        {r.action || "RESOLVED"}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-600">
                                      {r.details || `Resolved relational record in ${r.table}.`}
                                    </p>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <span className="text-[10px] text-slate-400 block font-bold">Resolved ID</span>
                                    <span className="font-mono font-bold text-emerald-700 text-xs">
                                      #{r.resolved_id ?? r.id ?? 1}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-xs">
                              Relational foreign keys used assigned fixed identifiers without requiring dynamic category row creation.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // TAB 3: Process Stage Timeline
                  if (activeModalTab === "timeline") {
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-1">
                          <h4 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                            <Clock className="w-3.5 h-3.5 text-indigo-600" />
                            Chronological Execution Stage Events
                          </h4>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {timelineEvents.length} recorded milestones
                          </span>
                        </div>

                        {timelineEvents.length > 0 ? (
                          <div className="relative border-l-2 border-indigo-200 ml-3 space-y-4 pl-4 py-1">
                            {timelineEvents.map((item: any, i: number) => {
                              const stageName = item.stage || item.event || "STAGE";
                              const isErr = stageName.includes("FAIL") || stageName.includes("ERROR");
                              const isSuccess =
                                stageName.includes("PUBLISH") ||
                                stageName.includes("COMMITTED") ||
                                stageName.includes("SUCCESS");

                              return (
                                <div key={i} className="relative group">
                                  {/* Dot badge */}
                                  <div
                                    className={`absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-2xs ${
                                      isErr
                                        ? "bg-rose-500"
                                        : isSuccess
                                        ? "bg-emerald-500"
                                        : "bg-indigo-600"
                                    }`}
                                  />

                                  <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl space-y-1 hover:border-indigo-200 transition">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-bold text-slate-900 font-mono text-[11px]">
                                        {stageName}
                                      </span>
                                      <span className="text-slate-400 font-mono text-[10px]">
                                        {item.timestamp
                                          ? new Date(item.timestamp).toLocaleString(undefined, {
                                              dateStyle: "short",
                                              timeStyle: "medium",
                                            })
                                          : ""}
                                      </span>
                                    </div>
                                    <p className="text-slate-600 text-[11px] leading-relaxed">
                                      {item.message || item.description}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-slate-500 text-xs">
                            No milestone events have been recorded yet for this execution.
                          </div>
                        )}
                      </div>
                    );
                  }

                  // TAB: Live In-Portal Published Record Editor
                  if (activeModalTab === "edit_record") {
                    const fields = Object.entries(editRecordPayload).filter(
                      ([k]) => !["id", "created_at", "updated_at", "password", "password_hash", "remember_token"].includes(k)
                    );
                    return (
                      <div className="space-y-4">
                        <div className="p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-xs space-y-1.5">
                          <div className="font-bold text-amber-900 flex items-center gap-1.5">
                            <Database className="w-4 h-4 text-amber-600" />
                            <span>Live Database Record #{selectedExecution.target_record_id} in '{selectedExecution.automation?.target_table || "target"}'</span>
                          </div>
                          <p className="text-amber-800 text-[11px] leading-relaxed">
                            Changes saved here execute a strictly scoped, parameterized single-row <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300">UPDATE</code> inside a database transaction. A new immutable version is automatically archived on the platform.
                          </p>
                        </div>

                        <div className="space-y-3 bg-white p-4 border border-slate-200 rounded-xl shadow-2xs">
                          {fields.map(([key, val]) => (
                            <div key={key} className="space-y-1">
                              <label className="text-[11px] font-bold text-slate-700 capitalize font-mono flex items-center justify-between">
                                <span>{key}</span>
                                <span className="text-slate-400 font-sans font-normal text-[10px]">Editable Field</span>
                              </label>
                              {typeof val === "string" && val.length > 80 ? (
                                <textarea
                                  value={val}
                                  onChange={(e) => setEditRecordPayload(prev => ({ ...prev, [key]: e.target.value }))}
                                  rows={4}
                                  className="w-full text-xs font-mono p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={val ?? ""}
                                  onChange={(e) => setEditRecordPayload(prev => ({ ...prev, [key]: e.target.value }))}
                                  className="w-full text-xs font-mono p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                                />
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="pt-2 flex items-center justify-between">
                          <span className="text-[11px] text-slate-500">
                            Connected DB: <strong className="text-slate-800 font-mono">{selectedExecution.automation?.connection?.database_name || "target_mysql"}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={handleUpdatePublishedRecord}
                            disabled={isUpdatingRecord}
                            className="btn-primary-gradient px-4 py-2 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                          >
                            {isUpdatingRecord ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                                <span>Committing UPDATE...</span>
                              </>
                            ) : (
                              <>
                                <Save className="w-3.5 h-3.5" />
                                <span>Save Changes & Update Target Database</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // TAB 4: Raw Technical JSON
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Target Payload & Runtime Execution State
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(selectedExecution, null, 2));
                            setCopiedJson(true);
                            setTimeout(() => setCopiedJson(false), 2000);
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1 shadow-2xs"
                        >
                          {copiedJson ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-700 font-bold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy JSON</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed border border-slate-800">
                        {JSON.stringify(selectedExecution, null, 2)}
                      </pre>
                    </div>
                  );
                })()}
              </div>

              {/* Modal Footer */}
              <div className="shrink-0 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono">
                  Execution Run ID #{selectedExecution.id}
                </span>
                <button
                  onClick={() => setSelectedExecution(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition"
                >
                  Close Inspector
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
