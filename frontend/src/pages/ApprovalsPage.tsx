import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  Eye,
  ArrowRight,
  ShieldCheck,
  Edit3,
  Send,
  RotateCcw,
  Save,
  Check,
  X,
  FileText,
  Calendar,
  Layers,
  Sparkles,
  AlertCircle,
  Database,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { useToast } from "../context/ToastContext";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";

interface PendingApprovalItem {
  id: number; // version id
  version_number: number;
  payload: Record<string, any>;
  status: string;
  rejection_feedback?: string;
  created_at: string;
  execution?: {
    id: number;
    automation_id: number;
    status: string;
    idempotency_key: string;
    publication_time?: string;
    automation?: {
      id: number;
      name: string;
      target_table: string;
      operation_mode: string;
    };
  };
}

export const ApprovalsPage: React.FC = () => {
  const { toast } = useToast();
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Live Editor & Review Modal State
  const [selectedItem, setSelectedItem] = useState<PendingApprovalItem | null>(null);
  const [activeTab, setActiveTab] = useState<"edit" | "preview" | "json">("edit");
  const [editPayload, setEditPayload] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      // Fetch from dedicated approvals endpoint
      const res = await api.listApprovals();
      let items: any[] = Array.isArray(res) ? res : (res as any)?.data || [];

      // If empty, also check executions endpoint for PENDING_APPROVAL runs
      if (items.length === 0) {
        const execRes = await api.listExecutions(1, 50, "PENDING_APPROVAL");
        const execs = Array.isArray(execRes?.data) ? execRes.data : Array.isArray(execRes) ? execRes : [];
        items = execs.map((e: any) => {
          const v = (e.versions && e.versions.length > 0) ? e.versions[0] : {};
          return {
            id: v.id || e.id,
            version_number: v.version_number || 1,
            payload: v.payload || e.payload || {},
            status: v.status || "PENDING_APPROVAL",
            created_at: v.created_at || e.created_at,
            execution: e,
          };
        });
      }

      setApprovals(items);
    } catch (err: any) {
      toast.error("Failed to load approvals", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ---- Orbit surface: same API calls as the review modal (row = draft id) ---------------------
  useOrbitSurface("approvals.list", () => {
    const find = (row?: string) => approvals.find((a) => String(a.id) === String(row));
    return {
      describe: () => approvals.map((a: any) => ({
        id: a.id, version: a.version_number, status: a.status, created_at: a.created_at,
        automation: a.execution?.automation?.name ?? a.automation_name ?? undefined,
        title: a.payload?.title ?? a.payload?.name ?? undefined,
      })),
      fields: {
        reject_feedback: { get: () => rejectFeedback, set: (v) => { setRejectFeedback(String(v ?? "").slice(0, 2000)); return null; } },
      },
      actions: {
        open: {
          target: (row) => `approvals.row.${row}`,
          run: (row) => {
            const item = find(row);
            if (!item) return { success: false, message: `No draft ${row} waiting for approval.` };
            openReviewModal(item);
            return { success: true, message: "Draft opened for review.", data: { payload: item.payload } };
          },
        },
        approve: {
          target: (row) => `approvals.row.${row}`,
          run: async (row) => {
            const item = find(row);
            if (!item) return { success: false, message: `No draft ${row} waiting for approval.` };
            try {
              setIsPublishing(true);
              const payload = selectedItem && String(selectedItem.id) === String(row) ? editPayload : item.payload;
              const res: any = await api.portalApprove(item.id, { publish_now: true, payload });
              setSelectedItem(null);
              loadData();
              return { success: true, message: res?.message || "Approved and published.", resource: { type: "ContentVersion", id: item.id } };
            } catch (err: any) {
              return { success: false, message: err.message || "Approval failed." };
            } finally {
              setIsPublishing(false);
            }
          },
        },
        reject: {
          target: (row) => `approvals.row.${row}`,
          run: async (row) => {
            const item = find(row);
            if (!item) return { success: false, message: `No draft ${row} waiting for approval.` };
            try {
              setIsRejecting(true);
              const res: any = await api.portalReject(item.id, rejectFeedback || undefined);
              setRejectFeedback("");
              setShowRejectModal(false);
              setSelectedItem(null);
              loadData();
              return { success: true, message: res?.message || "Rejected; a revised version is being generated.", resource: { type: "ContentVersion", id: item.id } };
            } catch (err: any) {
              return { success: false, message: err.message || "Rejection failed." };
            } finally {
              setIsRejecting(false);
            }
          },
        },
      },
    };
  });

  const openReviewModal = (item: PendingApprovalItem) => {
    setSelectedItem(item);
    setEditPayload({ ...(item.payload || {}) });
    setActiveTab("edit");
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditPayload((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveEdits = async () => {
    if (!selectedItem) return;
    try {
      setIsSaving(true);
      await api.updateApprovalPayload(selectedItem.id, editPayload);
      toast.success("Changes Saved", "Updated content payload recorded successfully.");
      // Update local state
      setApprovals((prev) =>
        prev.map((a) => (a.id === selectedItem.id ? { ...a, payload: editPayload } : a))
      );
      setSelectedItem((prev) => (prev ? { ...prev, payload: editPayload } : null));
    } catch (err: any) {
      toast.error("Failed to save changes", err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (publishNow: boolean) => {
    if (!selectedItem) return;
    try {
      setIsPublishing(true);
      const res = await api.portalApprove(selectedItem.id, {
        publish_now: publishNow,
        payload: editPayload,
      });
      toast.success(
        publishNow ? "Published Successfully!" : "Approved for Scheduled Publication",
        res.message || "Record status updated."
      );
      setSelectedItem(null);
      loadData();
    } catch (err: any) {
      toast.error("Approval Failed", err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      setIsRejecting(true);
      const res = await api.portalReject(selectedItem.id, rejectFeedback || undefined);
      toast.info("Regeneration Dispatched", res.message || "AI is generating a revised version.");
      setShowRejectModal(false);
      setRejectFeedback("");
      setSelectedItem(null);
      loadData();
    } catch (err: any) {
      toast.error("Rejection Failed", err.message);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div id="approvals-list-anchor" className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              Human-In-The-Loop Editorial Control
            </span>
            <span className="text-xs text-slate-500">• Live Pre-Publication Inspection</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Review & Approval Queue</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect, modify, and sign off on AI-generated content before scheduled database publication.
          </p>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-medium text-slate-700 transition shadow-2xs self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Checking pending editorial approvals...</p>
        </div>
      ) : approvals.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="py-16 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs p-8"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Queue is Clear</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
            All generated database mutations have either been approved, published, or handled.
          </p>
          <Link
            to="/automations"
            className="inline-flex items-center gap-1.5 px-4 py-2 mt-4 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold transition"
          >
            <span>View Active Automations</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {approvals.map((item) => {
            const execution = item.execution;
            const payload = item.payload || {};
            const title = payload.title || payload.name || `Generated Run #${execution?.id || item.id}`;
            const excerpt = payload.excerpt || payload.description || "Structured payload pending editorial confirmation.";
            const targetTable = execution?.automation?.target_table || "target table";
            const pubTime = execution?.publication_time ? new Date(execution.publication_time) : null;
            const fieldCount = Object.keys(payload).length;

            return (
              <motion.div
                key={item.id}
                ref={(el: HTMLDivElement | null) =>
                  el ? orbitTargets.register(`approvals.row.${item.id}`, el) : orbitTargets.unregister(`approvals.row.${item.id}`)
                }
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="bg-white border border-amber-200 hover:border-amber-300 rounded-2xl p-5 shadow-xs space-y-4 transition-all"
              >
                {/* Header Strip */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm">
                      Run #{execution?.id || item.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] bg-amber-50 text-amber-800 border border-amber-200 font-bold">
                      Version #{item.version_number}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Pipeline: <span className="font-semibold text-slate-800">{execution?.automation?.name || "Content Pipeline"}</span>
                    </span>
                    <span className="text-xs text-indigo-700 font-mono bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                      Table: {targetTable}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Target Publication:{" "}
                      <strong className="text-slate-800">
                        {pubTime ? pubTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " (" + pubTime.toLocaleDateString() + ")" : "Immediate"}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Content Summary Card */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      <span>{title}</span>
                    </h3>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {fieldCount} fields ready to write
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed font-sans line-clamp-2">
                    {excerpt}
                  </p>

                  {/* Badges for payload keys */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.keys(payload)
                      .slice(0, 5)
                      .map((k) => (
                        <span key={k} className="px-2 py-0.5 bg-white text-slate-600 text-[10px] rounded border border-slate-200 font-mono">
                          {k}: {String(payload[k]).slice(0, 20)}
                        </span>
                      ))}
                    {fieldCount > 5 && (
                      <span className="px-1.5 py-0.5 text-slate-400 text-[10px] font-mono">
                        +{fieldCount - 5} more
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    Idempotency: {execution?.idempotency_key || "auto-managed"}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Review & Edit */}
                    <button
                      type="button"
                      onClick={() => openReviewModal(item)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-semibold transition shadow-2xs"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Review & Edit Live Content</span>
                    </button>

                    {/* Quick Approve for Schedule */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItem(item);
                        handleApprove(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition shadow-2xs"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Approve for Schedule</span>
                    </button>

                    {/* Publish Now Immediately */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItem(item);
                        handleApprove(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Publish Now</span>
                    </button>

                    {/* Reject & Regenerate */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItem(item);
                        setShowRejectModal(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Live Editorial Review & In-Place Editor Modal */}
      <AnimatePresence>
        {selectedItem && !showRejectModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      Live Editorial Studio
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      Version #{selectedItem.version_number} • Target: {selectedItem.execution?.automation?.target_table || "blogs"}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    Review & Edit Content Before Publication
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg text-sm font-bold"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Publication Schedule Notice */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-xl flex items-center justify-between text-xs text-indigo-900">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    <strong>Scheduled Publication:</strong>{" "}
                    {selectedItem.execution?.publication_time
                      ? new Date(selectedItem.execution.publication_time).toLocaleString()
                      : "Immediate"}
                  </span>
                </div>
                <span className="text-[11px] font-medium text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-100">
                  Any changes saved here will be committed to MySQL
                </span>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-slate-200 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("edit")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "edit"
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 inline mr-1" />
                  Live Field Editor
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "preview"
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1" />
                  Article Preview
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("json")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === "json"
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Database className="w-3.5 h-3.5 inline mr-1" />
                  Raw Database Payload
                </button>
              </div>

              {/* Tab Content Area */}
              <div className="overflow-y-auto flex-1 pr-1 space-y-4 text-xs">
                {activeTab === "edit" && (
                  <div className="space-y-4">
                    {/* Primary Title Field */}
                    {(editPayload.title !== undefined || editPayload.name !== undefined) && (
                      <div>
                        <label className="block text-xs font-bold text-slate-800 mb-1">
                          Article Title / Name
                        </label>
                        <input
                          type="text"
                          value={editPayload.title !== undefined ? editPayload.title : editPayload.name}
                          onChange={(e) => {
                            if (editPayload.title !== undefined) handleFieldChange("title", e.target.value);
                            else handleFieldChange("name", e.target.value);
                          }}
                          className="w-full bg-slate-50/50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                        />
                      </div>
                    )}

                    {/* Slug Field */}
                    {editPayload.slug !== undefined && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-800">
                            URL Slug
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const title = editPayload.title || editPayload.name || "";
                              const slug = title
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, "-")
                                .replace(/^-+|-+$/g, "");
                              handleFieldChange("slug", slug);
                            }}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold"
                          >
                            Regenerate Slug from Title
                          </button>
                        </div>
                        <input
                          type="text"
                          value={editPayload.slug}
                          onChange={(e) => handleFieldChange("slug", e.target.value)}
                          className="w-full bg-slate-50/50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                        />
                      </div>
                    )}

                    {/* Excerpt / Summary Field */}
                    {(editPayload.excerpt !== undefined || editPayload.description !== undefined) && (
                      <div>
                        <label className="block text-xs font-bold text-slate-800 mb-1">
                          Excerpt / Summary Preview
                        </label>
                        <textarea
                          rows={3}
                          value={editPayload.excerpt !== undefined ? editPayload.excerpt : editPayload.description}
                          onChange={(e) => {
                            if (editPayload.excerpt !== undefined) handleFieldChange("excerpt", e.target.value);
                            else handleFieldChange("description", e.target.value);
                          }}
                          className="w-full bg-slate-50/50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition leading-relaxed"
                        />
                      </div>
                    )}

                    {/* Content / Body Field */}
                    {(editPayload.content !== undefined || editPayload.body !== undefined) && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-800">
                            Full Article Content (Markdown or HTML)
                          </label>
                          <span className="text-[10px] font-mono text-slate-400">
                            {(editPayload.content || editPayload.body || "").split(/\s+/).filter(Boolean).length} words
                          </span>
                        </div>
                        <textarea
                          rows={9}
                          value={editPayload.content !== undefined ? editPayload.content : editPayload.body}
                          onChange={(e) => {
                            if (editPayload.content !== undefined) handleFieldChange("content", e.target.value);
                            else handleFieldChange("body", e.target.value);
                          }}
                          className="w-full bg-slate-50/50 border border-slate-300 rounded-xl p-3 text-xs font-sans text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition leading-relaxed"
                        />
                      </div>
                    )}

                    {/* Dynamic Remaining Target Fields */}
                    <div className="pt-2 border-t border-slate-100">
                      <label className="block text-xs font-bold text-slate-800 mb-2">
                        Target Columns & Relational Metadata
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.keys(editPayload)
                          .filter(
                            (k) =>
                              !["title", "name", "slug", "excerpt", "description", "content", "body"].includes(k)
                          )
                          .map((key) => (
                            <div key={key}>
                              <label className="block text-[11px] font-semibold text-slate-600 font-mono mb-1">
                                {key}
                              </label>
                              <input
                                type="text"
                                value={
                                  typeof editPayload[key] === "object"
                                    ? JSON.stringify(editPayload[key])
                                    : String(editPayload[key] ?? "")
                                }
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:bg-white focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "preview" && (
                  <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">
                      {editPayload.title || editPayload.name || "Untitled Article"}
                    </h2>
                    {editPayload.slug && (
                      <p className="text-xs font-mono text-indigo-600">
                        Target Route: /{editPayload.slug}
                      </p>
                    )}
                    {(editPayload.excerpt || editPayload.description) && (
                      <p className="text-xs italic text-slate-600 border-l-2 border-indigo-500 pl-3">
                        {editPayload.excerpt || editPayload.description}
                      </p>
                    )}
                    <div className="pt-3 border-t border-slate-200 text-xs text-slate-800 leading-relaxed whitespace-pre-line font-sans">
                      {editPayload.content || editPayload.body || "No body content provided."}
                    </div>
                  </div>
                )}

                {activeTab === "json" && (
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-80">
                    {JSON.stringify(editPayload, null, 2)}
                  </pre>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition"
                >
                  <Save className="w-3.5 h-3.5 text-slate-600" />
                  <span>{isSaving ? "Saving..." : "Save Edits"}</span>
                </button>

                <div className="flex items-center gap-2">
                  {/* Approve for Scheduled Publication */}
                  <button
                    type="button"
                    onClick={() => handleApprove(false)}
                    disabled={isPublishing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition shadow-2xs"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Approve for Schedule</span>
                  </button>

                  {/* Publish Immediately */}
                  <button
                    type="button"
                    onClick={() => handleApprove(true)}
                    disabled={isPublishing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isPublishing ? "Publishing..." : "Publish Immediately"}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reject with Feedback Modal */}
      <AnimatePresence>
        {showRejectModal && selectedItem && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-rose-600" />
                  Reject & Regenerate Version #{selectedItem.version_number}
                </h3>
                <button onClick={() => setShowRejectModal(false)} className="text-slate-400 font-bold">
                  ✕
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <p className="text-slate-600">
                  Provide editorial feedback or specific revision instructions for the local AI model:
                </p>
                <textarea
                  rows={4}
                  placeholder="e.g. Please make the tone more technical and elaborate on database indexing strategies..."
                  value={rejectFeedback}
                  onChange={(e) => setRejectFeedback(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isRejecting}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                >
                  {isRejecting ? "Dispatching..." : "Submit & Regenerate"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
