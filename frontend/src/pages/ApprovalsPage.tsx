import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, Eye, ArrowRight, Edit3, Send, RotateCcw, Save, FileText, Calendar, Database, RefreshCw, Workflow } from "lucide-react";
import { api } from "../services/api";
import { ContentPreview } from "../components/content/ContentPreview";
import { formatInstant } from "../lib/schedule";
import { Card, EmptyState, FieldError, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { draftPayloadErrors, draftRelationColumns, focusFirstError, invalid, rules, serverFieldErrors, validateField, type FieldErrors } from "../lib/validation";

/** Input id for an edited draft column, so its message sits under it. */
const draftFieldId = (key: string) => `approval-field-${key}`;
import { SpotlightCard } from "../components/landing/primitives";
import { useToast } from "../context/ToastContext";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useRefreshAfterOrbit } from "../hooks/useRefreshAfterOrbit";
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
  // Messages under each edited column, and under the "send back" notes.
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [rejectError, setRejectError] = useState<string | null>(null);

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
  useRefreshAfterOrbit(["approve_content_version", "reject_content_version"], () => { loadData(); });

  useOrbitSurface("approvals.list", () => {
    const find = (row?: string) => approvals.find((a) => String(a.id) === String(row));
    // The same two choices as the review buttons: approve for the scheduled time, or publish now.
    const approveCall = (publishNow: boolean) => ({
      target: (row?: string) => `approvals.row.${row}`,
      run: async (row?: string) => {
        const item = find(row);
        if (!item) return { success: false, message: `No draft ${row} waiting for approval.` };
        try {
          setIsPublishing(true);
          const payload = selectedItem && String(selectedItem.id) === String(row) ? editPayload : item.payload;
          const res: any = await api.portalApprove(item.id, { publish_now: publishNow, payload });
          setSelectedItem(null);
          loadData();
          return {
            success: true,
            message: res?.message || (publishNow ? "Approved and published." : "Approved; it publishes at its scheduled time."),
            resource: { type: "ContentVersion", id: item.id },
          };
        } catch (err: any) {
          return { success: false, message: err.message || "Approval failed." };
        } finally {
          setIsPublishing(false);
        }
      },
    });
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
        refresh: { run: async () => { await loadData(); return { success: true, message: "Approval queue reloaded." }; } },
        open: {
          target: (row) => `approvals.row.${row}`,
          run: (row) => {
            const item = find(row);
            if (!item) return { success: false, message: `No draft ${row} waiting for approval.` };
            openReviewModal(item);
            return { success: true, message: "Draft opened for review.", data: { payload: item.payload } };
          },
        },
        approve: approveCall(false),
        approve_publish_now: approveCall(true),
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
    setEditErrors({});
    setActiveTab("preview");
  };

  /** Same checks the server applies to an edited draft; problems are shown under their fields on the Edit tab. */
  const checkDraft = (): boolean => {
    const meta = (selectedItem as any)?.meta;
    const found = draftPayloadErrors(editPayload, meta?.write_plan?.columns, draftRelationColumns(meta));
    return showDraftErrors(found);
  };
  const showDraftErrors = (found: FieldErrors): boolean => {
    setEditErrors(found);
    if (!Object.keys(found).length) return true;
    setActiveTab("edit");
    setTimeout(() => focusFirstError(found, draftFieldId), 60);
    return false;
  };
  /** A 422 for the draft ("payload.<column>") placed under the columns; other failures go to a toast. */
  const draftServerErrors = (err: any): boolean => {
    const fields = serverFieldErrors(err, {}, Object.keys(editPayload));
    const placed = Object.fromEntries(Object.entries(fields).filter(([k]) => k in editPayload));
    if (!Object.keys(placed).length) return false;
    showDraftErrors(placed);
    return true;
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setEditPayload((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveEdits = async () => {
    if (!selectedItem || !checkDraft()) return;
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
      if (!draftServerErrors(err)) toast.error("Failed to save changes", err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (publishNow: boolean) => {
    if (!selectedItem || !checkDraft()) return;
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
      if (!draftServerErrors(err)) toast.error("Approval Failed", err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    const problem = validateField("feedback", { feedback: rejectFeedback }, { feedback: [rules.maxLength(2000, "Notes")] });
    setRejectError(problem);
    if (problem) {
      document.getElementById("reject-notes")?.focus();
      return;
    }
    try {
      setIsRejecting(true);
      const res = await api.portalReject(selectedItem.id, rejectFeedback.trim() || undefined);
      toast.info("Regeneration Dispatched", res.message || "AI is generating a revised version.");
      setShowRejectModal(false);
      setRejectFeedback("");
      setSelectedItem(null);
      loadData();
    } catch (err: any) {
      const msg = serverFieldErrors(err).feedback;
      if (msg) setRejectError(msg);
      else toast.error("Rejection Failed", err.message);
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div id="approvals-list-anchor" className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Automate"
        title="Approvals"
        description="Drafts waiting for a person's OK. Edit them, approve them for their scheduled time, publish now, or send them back with notes."
        actions={
          <>
            {approvals.length > 0 && <span className="da-chip da-chip-amber px-3 py-1 text-[12px]">{approvals.length} waiting</span>}
            <button type="button" onClick={loadData} className="da-btn da-btn-secondary">
              <RefreshCw className={`h-4 w-4 text-slate-500 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </>
        }
      />

      {loading ? (
        <Card><Loading label="Checking for drafts to review…" /></Card>
      ) : approvals.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All caught up"
          description="Every draft has been approved, published or handled. New drafts appear here as soon as an automation writes them."
          action={<Link to="/automations" className="da-btn da-btn-secondary">View automations <ArrowRight className="h-3.5 w-3.5" /></Link>}
        />
      ) : (
        <div className="space-y-4">
          {approvals.map((item, idx) => {
            const execution = item.execution;
            const payload = item.payload || {};
            const title = payload.title || payload.name || `Generated run #${execution?.id || item.id}`;
            const excerpt = payload.excerpt || payload.description || "Structured content waiting for a reviewer.";
            const targetTable = execution?.automation?.target_table || "target table";
            const pubTime = execution?.publication_time ? new Date(execution.publication_time) : null;
            const fieldCount = Object.keys(payload).length;

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: Math.min(idx, 8) * 0.05, ease: [0.16, 1, 0.3, 1] }}
                ref={(el: HTMLDivElement | null) =>
                  el ? orbitTargets.register(`approvals.row.${item.id}`, el) : orbitTargets.unregister(`approvals.row.${item.id}`)
                }
              >
                <SpotlightCard className="shadow-soft">
                  <div className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row">
                    <div className="relative hidden h-28 w-40 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 md:block">
                      <div className="absolute inset-0 landing-grid opacity-40" />
                      <FileText className="absolute bottom-3 left-3 h-6 w-6 text-white/90" />
                      <span className="absolute right-2 top-2 rounded-full bg-black/25 px-2 py-0.5 text-[10.5px] font-semibold text-white">v{item.version_number}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="da-chip da-chip-amber">Needs review</span>
                        <span className="da-chip da-chip-slate">Run #{execution?.id || item.id}</span>
                        <span className="da-chip da-chip-slate">Version {item.version_number}</span>
                        <span className="da-chip da-chip-indigo font-mono">{targetTable}</span>
                      </div>
                      <h3 className="mt-3 text-[17px] font-bold tracking-[-0.02em] text-slate-950">{title}</h3>
                      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-slate-600">{excerpt}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-slate-500">
                        <span className="flex items-center gap-1.5"><Workflow className="h-3.5 w-3.5 text-slate-400" /> {execution?.automation?.name || "Content pipeline"}</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-amber-500" />
                          Publishes <strong className="font-semibold text-slate-800">{pubTime ? `${pubTime.toLocaleDateString()} · ${pubTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "right after approval"}</strong>
                        </span>
                        <span>{fieldCount} fields ready</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.keys(payload).slice(0, 5).map((k) => (
                          <span key={k} className="max-w-[220px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                            {k}: {String(payload[k]).slice(0, 24)}
                          </span>
                        ))}
                        {fieldCount > 5 && <span className="px-1.5 py-0.5 font-mono text-[11px] text-slate-400">+{fieldCount - 5} more</span>}
                      </div>
                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => openReviewModal(item)} className="da-btn da-btn-secondary">
                          <Edit3 className="h-3.5 w-3.5 text-indigo-600" /> Review & edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSelectedItem(item); handleApprove(false); }}
                          className="da-btn border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                        >
                          <Calendar className="h-3.5 w-3.5" /> Approve for schedule
                        </button>
                        <button type="button" onClick={() => { setSelectedItem(item); handleApprove(true); }} className="da-btn da-btn-primary">
                          <Send className="h-3.5 w-3.5" /> Publish now
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSelectedItem(item); setShowRejectModal(true); }}
                          className="da-btn da-btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Send back
                        </button>
                        <span className="ml-auto hidden truncate font-mono text-[11px] text-slate-400 lg:inline">
                          {execution?.idempotency_key ? `key ${String(execution.idempotency_key).slice(0, 18)}…` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Review & edit */}
      <ModalShell
        open={!!selectedItem && !showRejectModal}
        onClose={() => setSelectedItem(null)}
        size="xl"
        icon={Edit3}
        title="Review & edit before publishing"
        description={selectedItem ? `Version ${selectedItem.version_number} · writes into ${selectedItem.execution?.automation?.target_table || "the target table"}` : undefined}
        footer={
          <>
            <button type="button" onClick={handleSaveEdits} disabled={isSaving} className="da-btn da-btn-secondary mr-auto">
              <Save className="h-3.5 w-3.5 text-slate-500" /> {isSaving ? "Saving…" : "Save edits"}
            </button>
            <button type="button" onClick={() => handleApprove(false)} disabled={isPublishing} className="da-btn border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100">
              <Calendar className="h-3.5 w-3.5" /> Approve for schedule
            </button>
            <button type="button" onClick={() => handleApprove(true)} disabled={isPublishing} className="da-btn da-btn-primary">
              <Send className="h-3.5 w-3.5" /> {isPublishing ? "Publishing…" : "Publish now"}
            </button>
          </>
        }
      >
        {selectedItem && (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-[13px] text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-indigo-600" />
                <span>
                  <strong>Publishes</strong>{" "}
                  {selectedItem.execution?.publication_time
                    ? formatInstant(selectedItem.execution.publication_time, (selectedItem.execution?.automation as any)?.timezone || "UTC", { withZone: true })
                    : "right after approval"}
                </span>
              </span>
              <span className="text-[12px] text-indigo-700">Edits change this draft only; nothing is written until it is published.</span>
            </div>

            <div className="da-tabs" role="tablist">
              {([["edit", "Edit fields", Edit3], ["preview", "Preview", Eye], ["json", "Database payload", Database]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id as any)}
                  className={`da-tab ${activeTab === id ? "da-tab-active" : ""}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            {activeTab === "edit" && (
              <div className="space-y-4">
                {(editPayload.title !== undefined || editPayload.name !== undefined) && (
                  <div>
                    {(() => {
                      const key = editPayload.title !== undefined ? "title" : "name";
                      return (
                        <>
                          <label className="da-label" htmlFor={draftFieldId(key)}>Title</label>
                          <input
                            id={draftFieldId(key)}
                            type="text"
                            value={editPayload[key] ?? ""}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            aria-invalid={!!editErrors[key]}
                            aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                            className={`da-input font-semibold${invalid(editErrors[key])}`}
                          />
                          <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                        </>
                      );
                    })()}
                  </div>
                )}
                {editPayload.slug !== undefined && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-[12.5px] font-semibold text-slate-700" htmlFor={draftFieldId("slug")}>URL slug</label>
                      <button
                        type="button"
                        onClick={() => {
                          const t = editPayload.title || editPayload.name || "";
                          handleFieldChange("slug", t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
                        }}
                        className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        Regenerate from title
                      </button>
                    </div>
                    <input id={draftFieldId("slug")} type="text" value={editPayload.slug ?? ""} onChange={(e) => handleFieldChange("slug", e.target.value)}
                      aria-invalid={!!editErrors.slug} aria-describedby={editErrors.slug ? `${draftFieldId("slug")}-error` : undefined}
                      className={`da-input font-mono${invalid(editErrors.slug)}`} />
                    <FieldError id={draftFieldId("slug")} message={editErrors.slug} />
                  </div>
                )}
                {(editPayload.excerpt !== undefined || editPayload.description !== undefined) && (
                  <div>
                    {(() => {
                      const key = editPayload.excerpt !== undefined ? "excerpt" : "description";
                      return (
                        <>
                          <label className="da-label" htmlFor={draftFieldId(key)}>Summary</label>
                          <textarea
                            id={draftFieldId(key)}
                            rows={3}
                            value={editPayload[key] ?? ""}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            aria-invalid={!!editErrors[key]}
                            aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                            className={`da-input leading-relaxed${invalid(editErrors[key])}`}
                          />
                          <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                        </>
                      );
                    })()}
                  </div>
                )}
                {(editPayload.content !== undefined || editPayload.body !== undefined) && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-[12.5px] font-semibold text-slate-700">Content (Markdown or HTML)</label>
                      <span className="font-mono text-[11.5px] text-slate-400">
                        {(editPayload.content || editPayload.body || "").split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>
                    {(() => {
                      const key = editPayload.content !== undefined ? "content" : "body";
                      return (
                        <>
                          <textarea
                            id={draftFieldId(key)}
                            rows={10}
                            aria-label="Content"
                            value={editPayload[key] ?? ""}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            aria-invalid={!!editErrors[key]}
                            aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                            className={`da-input leading-relaxed${invalid(editErrors[key])}`}
                          />
                          <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                        </>
                      );
                    })()}
                  </div>
                )}
                <div className="border-t border-slate-100 pt-4">
                  <div className="da-eyebrow mb-3">Other columns</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Object.keys(editPayload)
                      .filter((k) => !["title", "name", "slug", "excerpt", "description", "content", "body"].includes(k))
                      .map((key) => (
                        <div key={key}>
                          <label className="mb-1 block font-mono text-[12px] font-semibold text-slate-600" htmlFor={draftFieldId(key)}>{key}</label>
                          <input
                            id={draftFieldId(key)}
                            type="text"
                            value={typeof editPayload[key] === "object" && editPayload[key] !== null ? JSON.stringify(editPayload[key]) : String(editPayload[key] ?? "")}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            aria-invalid={!!editErrors[key]}
                            aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                            className={`da-input py-2${invalid(editErrors[key])}`}
                          />
                          <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "preview" && (
              <ContentPreview
                payload={editPayload}
                meta={(selectedItem as any).meta}
                targetTable={selectedItem.execution?.automation?.target_table}
                timezone={(selectedItem.execution?.automation as any)?.timezone || "UTC"}
                publicationTime={selectedItem.execution?.publication_time}
              />
            )}

            {activeTab === "json" && (
              <pre className="max-h-96 overflow-auto rounded-2xl bg-ink p-5 font-mono text-[12px] leading-relaxed text-slate-200">
                {JSON.stringify(editPayload, null, 2)}
              </pre>
            )}
          </div>
        )}
      </ModalShell>

      {/* Send back with notes */}
      <ModalShell
        open={showRejectModal && !!selectedItem}
        onClose={() => { setShowRejectModal(false); setRejectError(null); }}
        size="sm"
        icon={RotateCcw}
        tone="rose"
        title="Send back with notes"
        description={selectedItem ? `Version ${selectedItem.version_number} will be rewritten using your notes.` : undefined}
        footer={
          <>
            <button type="button" onClick={() => { setShowRejectModal(false); setRejectError(null); }} className="da-btn da-btn-ghost">Cancel</button>
            <button type="button" onClick={handleReject} disabled={isRejecting} className="da-btn da-btn-danger">
              {isRejecting ? "Sending…" : "Send back and rewrite"}
            </button>
          </>
        }
      >
        <label className="da-label" htmlFor="reject-notes">What should change?</label>
        <textarea
          id="reject-notes"
          rows={5}
          placeholder="e.g. Make the tone more technical and go deeper on indexing strategies."
          value={rejectFeedback}
          onChange={(e) => { setRejectFeedback(e.target.value); setRejectError(null); }}
          aria-invalid={!!rejectError}
          aria-describedby={rejectError ? "reject-notes-error" : undefined}
          className={`da-input${invalid(rejectError)}`}
        />
        <FieldError id="reject-notes" message={rejectError} />
        {!rejectError && <p className="da-help">Optional, up to 2,000 characters. Leave empty to ask for a general rewrite.</p>}
      </ModalShell>
    </div>
  );
};
