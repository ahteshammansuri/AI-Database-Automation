import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, Eye, ArrowRight, Edit3, Send, RotateCcw, Save, FileText, Calendar, Database, RefreshCw, Workflow, Sparkles, Loader2, History, Hourglass } from "lucide-react";
import { api } from "../services/api";
import { ContentPreview } from "../components/content/ContentPreview";
import { WysiwygEditor } from "../components/content/WysiwygEditor";
import { looksLikeHtml } from "../components/content/RichText";
import { formatInstant, relativeFromNow } from "../lib/schedule";
import { Card, EmptyState, FieldError, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { draftPayloadErrors, draftRelationColumns, focusFirstError, invalid, rules, serverFieldErrors, validateField, type FieldErrors } from "../lib/validation";

/** Input id for an edited draft column, so its message sits under it. */
const draftFieldId = (key: string) => `approval-field-${key}`;
import { SpotlightCard } from "../components/landing/primitives";
import { useToast } from "../context/ToastContext";
import { useLiveEvents } from "../context/LiveEventsContext";
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
      operation_mode?: string;
      timezone?: string;
      timeout_policy?: string;
      connection?: { id: number; name: string; database_name?: string };
    };
    /** Every version of this run (without content), oldest first. */
    versions?: { id: number; version_number: number; status: string; rejection_feedback?: string | null; created_at: string }[];
  };
}

/** What happens at the publication time when nobody has decided. */
const DEADLINE_TEXT: Record<string, string> = {
  KEEP_DRAFT: "If nobody decides by then, nothing is written and the draft is kept.",
  AUTO_PUBLISH_LATEST: "If nobody decides by then, this version is published automatically.",
  CANCEL: "If nobody decides by then, the run is cancelled and nothing is written.",
};

const MEDIA_KEY = /(^|_)(image|img|banner|thumbnail|thumb|photo|cover)(_url|_path|_src)?$/i;
/** The first image the draft would publish, for the card thumbnail. */
const draftImage = (payload: Record<string, any>): string | null => {
  for (const [k, v] of Object.entries(payload || {})) {
    if (MEDIA_KEY.test(k) && typeof v === "string" && /^(https?:\/\/|\/)/.test(v)) return v;
  }
  return null;
};
const labelFor = (k: string) => {
  const w = k.replace(/_id$/i, "").replace(/_/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : k;
};
const plain = (v: any) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

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
  // "Send back" from a card: cancelling closes everything instead of leaving the review open.
  const [rejectFromCard, setRejectFromCard] = useState(false);

  // Runs whose draft was sent back and is being rewritten (they come back here when the new version is ready).
  const [rewriting, setRewriting] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadData = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const [res, regen] = await Promise.all([
        api.listApprovals(),
        api.listExecutions(1, 20, "REGENERATING").catch(() => null),
      ]);
      setApprovals(Array.isArray(res) ? res : (res as any)?.data || []);
      const list = Array.isArray(regen?.data) ? regen.data : Array.isArray(regen) ? regen : [];
      setRewriting(list);
    } catch (err: any) {
      toast.error("The approval queue could not be loaded", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // New drafts, rewrites and publications arrive as live events; refresh quietly (debounced).
  const { addListener } = useLiveEvents();
  const refreshTimer = useRef<number | null>(null);
  useEffect(() => addListener((e) => {
    if (!/^execution\./.test(e.event_name)) return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => loadData(true), 600);
  }), [addListener]);

  // ---- Orbit surface: same API calls as the review modal (row = draft id) ---------------------
  useRefreshAfterOrbit(["approve_content_version", "reject_content_version"], () => { loadData(); });

  useOrbitSurface("approvals.list", () => {
    const find = (row?: string) => approvals.find((a) => String(a.id) === String(row));
    // The same two choices as the review buttons: approve for the scheduled time, or publish now.
    const approveCall = (publishNow: boolean) => ({
      target: (row?: string) => `approvals.row.${row}`,
      run: async (row?: string) => {
        const item = find(row);
        if (!item) return { success: false, missing: true, message: `No draft ${row} waiting for approval.` };
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
            if (!item) return { success: false, missing: true, message: `No draft ${row} waiting for approval.` };
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
            if (!item) return { success: false, missing: true, message: `No draft ${row} waiting for approval.` };
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
      toast.success("Edits saved", "The draft was updated. Nothing is published until you approve it.");
      // Update local state
      setApprovals((prev) =>
        prev.map((a) => (a.id === selectedItem.id ? { ...a, payload: editPayload } : a))
      );
      setSelectedItem((prev) => (prev ? { ...prev, payload: editPayload } : null));
    } catch (err: any) {
      if (!draftServerErrors(err)) toast.error("Edits not saved", err.message);
    } finally {
      setIsSaving(false);
    }
  };

  /** Approve the open draft (with its edits), or a card's draft as it is. */
  const handleApprove = async (publishNow: boolean, item?: PendingApprovalItem) => {
    const target = item ?? selectedItem;
    if (!target) return;
    if (!item && !checkDraft()) return;
    const payload = item ? item.payload : editPayload;
    try {
      setIsPublishing(true);
      setBusyId(target.id);
      const res = await api.portalApprove(target.id, { publish_now: publishNow, payload });
      toast.success(publishNow ? "Publishing now" : "Approved", res.message || (publishNow ? "The row is being written to your database." : "It publishes at its scheduled time."));
      setSelectedItem(null);
      loadData(true);
    } catch (err: any) {
      if (item) {
        toast.error("Not approved", err.message);
        openReviewModal(item);
      } else if (!draftServerErrors(err)) {
        toast.error("Not approved", err.message);
      }
    } finally {
      setIsPublishing(false);
      setBusyId(null);
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
      toast.info("Sent back", res.message || "A new version is being written with your notes. It appears here when it is ready.");
      setShowRejectModal(false);
      setRejectFromCard(false);
      setRejectFeedback("");
      setSelectedItem(null);
      loadData(true);
    } catch (err: any) {
      const msg = serverFieldErrors(err).feedback;
      if (msg) setRejectError(msg);
      else toast.error("Not sent back", err.message);
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
            <button type="button" onClick={() => loadData()} className="da-btn da-btn-secondary">
              <RefreshCw className={`h-4 w-4 text-slate-500 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </>
        }
      />

      {loading ? (
        <Card><Loading label="Checking for drafts to review…" /></Card>
      ) : approvals.length === 0 && rewriting.length === 0 ? (
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
            const automation = execution?.automation;
            const payload = item.payload || {};
            const title = plain(payload.title || payload.name || payload.headline) || `Draft of run #${execution?.id ?? item.id}`;
            const excerpt = plain(payload.excerpt || payload.summary || payload.short_description || payload.description || payload.content);
            const image = draftImage(payload);
            const tz = automation?.timezone || "UTC";
            const pub = execution?.publication_time;
            const overdue = !!pub && new Date(pub).getTime() < Date.now();
            const earlier = (execution?.versions || []).filter((v) => v.version_number < item.version_number);
            const lastNotes = [...earlier].reverse().find((v) => v.rejection_feedback)?.rejection_feedback;
            const fields = Object.keys(payload).filter((k) => !k.startsWith("__"));
            const busy = busyId === item.id;

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
                    {image ? (
                      <img src={image} alt="" className="hidden h-28 w-40 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 object-cover md:block" />
                    ) : (
                      <div className="hidden h-28 w-40 shrink-0 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-300 md:grid">
                        <FileText className="h-7 w-7" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="da-chip da-chip-amber">Needs your decision</span>
                        {item.version_number > 1 && <span className="da-chip da-chip-violet">Version {item.version_number} (rewritten)</span>}
                        {automation?.target_table && <span className="da-chip da-chip-indigo font-mono">{automation.target_table}</span>}
                        {automation?.connection?.name && <span className="da-chip da-chip-slate">{automation.connection.name}</span>}
                      </div>
                      <h3 className="mt-3 text-[17px] font-bold tracking-[-0.02em] text-slate-950">{title}</h3>
                      {excerpt && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-slate-600">{excerpt}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-slate-500">
                        <span className="flex items-center gap-1.5"><Workflow className="h-3.5 w-3.5 text-slate-400" /> {automation?.name || "Automation"} · run #{execution?.id}</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className={`h-3.5 w-3.5 ${overdue ? "text-rose-500" : "text-amber-500"}`} />
                          {pub ? (
                            <>Publishes <strong className="font-semibold text-slate-800">{formatInstant(pub, tz, { withZone: true })}</strong> ({overdue ? "time has passed" : relativeFromNow(pub)})</>
                          ) : (
                            <>Publishes right after approval</>
                          )}
                        </span>
                        <span>{fields.length} field{fields.length === 1 ? "" : "s"}</span>
                      </div>
                      {pub && automation?.timeout_policy && DEADLINE_TEXT[automation.timeout_policy] && (
                        <p className="mt-1.5 text-[12px] text-slate-500">{overdue ? "The publication time has passed: approve to publish it now, or send it back." : DEADLINE_TEXT[automation.timeout_policy]}</p>
                      )}
                      {lastNotes && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-[12.5px] text-violet-900">
                          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>Rewritten after your notes: “{lastNotes}”</span>
                        </p>
                      )}
                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => openReviewModal(item)} disabled={busy} className="da-btn da-btn-primary">
                          <Eye className="h-3.5 w-3.5" /> Review
                        </button>
                        {pub && !overdue && (
                          <button type="button" onClick={() => handleApprove(false, item)} disabled={busy}
                            className="da-btn border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />} Approve for {formatInstant(pub, tz)}
                          </button>
                        )}
                        <button type="button" onClick={() => handleApprove(true, item)} disabled={busy} className="da-btn da-btn-secondary">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Publish now
                        </button>
                        <button type="button" onClick={() => { openReviewModal(item); setRejectFromCard(true); setShowRejectModal(true); }} disabled={busy}
                          className="da-btn da-btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                          <RotateCcw className="h-3.5 w-3.5" /> Send back
                        </button>
                      </div>
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            );
          })}

          {rewriting.length > 0 && (
            <div className="da-card p-5">
              <h3 className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><Hourglass className="h-4 w-4 text-violet-600" /> Being rewritten · {rewriting.length}</h3>
              <p className="mt-0.5 text-[12.5px] text-slate-500">Sent back with notes. The new version appears above when it is ready; you also get an email if the automation sends one.</p>
              <ul className="mt-3 divide-y divide-slate-100">
                {rewriting.map((e: any) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2 text-slate-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                      {e.automation?.name ?? "Automation"} · run #{e.id}
                    </span>
                    <Link to={`/executions?id=${e.id}`} className="text-[12.5px] font-semibold text-indigo-600 hover:underline">Follow progress</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Review & edit */}
      <ModalShell
        open={!!selectedItem && !showRejectModal}
        onClose={() => setSelectedItem(null)}
        size="xl"
        icon={Edit3}
        title="Review before publishing"
        description={selectedItem ? `Version ${selectedItem.version_number} · writes into ${selectedItem.execution?.automation?.target_table || "the target table"}` : undefined}
        footer={
          <>
            <button type="button" onClick={handleSaveEdits} disabled={isSaving} className="da-btn da-btn-secondary mr-auto">
              <Save className="h-3.5 w-3.5 text-slate-500" /> {isSaving ? "Saving…" : "Save edits"}
            </button>
            {selectedItem?.execution?.publication_time && new Date(selectedItem.execution.publication_time).getTime() > Date.now() && (
              <button type="button" onClick={() => handleApprove(false)} disabled={isPublishing} className="da-btn border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100">
                <Calendar className="h-3.5 w-3.5" /> Approve for {formatInstant(selectedItem.execution.publication_time, selectedItem.execution.automation?.timezone || "UTC")}
              </button>
            )}
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
              {([["edit", "Edit fields", Edit3], ["preview", "Preview", Eye], ["json", "Raw values", Database]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id as any)}
                  className={`da-tab ${activeTab === id ? "da-tab-active" : ""}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            {activeTab === "edit" && (() => {
              // Intelligently identify candidate keys
              const titleKey = ["title", "name", "headline", "subject", "heading"].find((k) => editPayload[k] !== undefined);
              const slugKey = ["slug", "url_slug"].find((k) => editPayload[k] !== undefined);

              // Candidate for body: explicit content/body field, or description if no explicit body field is defined
              const explicitBodyKey = ["content", "body", "article", "post_content", "html", "long_description", "text"].find((k) => editPayload[k] !== undefined);
              const bodyKey = explicitBodyKey || (editPayload.description !== undefined ? "description" : undefined);

              // Summary: excerpt or summary, or description if description wasn't used as the body
              const summaryKey = ["excerpt", "summary", "short_description", "intro", "teaser", "lead", "abstract", "snippet"].find((k) => editPayload[k] !== undefined)
                || (editPayload.description !== undefined && bodyKey !== "description" ? "description" : undefined);

              const handledKeys = new Set([titleKey, slugKey, summaryKey, bodyKey].filter(Boolean) as string[]);
              const otherKeys = Object.keys(editPayload).filter((k) => !handledKeys.has(k) && !k.startsWith("__"));

              return (
                <div className="space-y-5">
                  {/* Title */}
                  {titleKey && (
                    <div>
                      <label className="da-label" htmlFor={draftFieldId(titleKey)}>Title</label>
                      <input
                        id={draftFieldId(titleKey)}
                        type="text"
                        value={editPayload[titleKey] ?? ""}
                        onChange={(e) => handleFieldChange(titleKey, e.target.value)}
                        aria-invalid={!!editErrors[titleKey]}
                        aria-describedby={editErrors[titleKey] ? `${draftFieldId(titleKey)}-error` : undefined}
                        className={`da-input font-semibold text-slate-900${invalid(editErrors[titleKey])}`}
                      />
                      <FieldError id={draftFieldId(titleKey)} message={editErrors[titleKey]} />
                    </div>
                  )}

                  {/* Slug */}
                  {slugKey && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-[12.5px] font-semibold text-slate-700" htmlFor={draftFieldId(slugKey)}>URL slug</label>
                        <button
                          type="button"
                          onClick={() => {
                            const t = titleKey ? editPayload[titleKey] || "" : "";
                            handleFieldChange(slugKey, t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
                          }}
                          className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Regenerate from title
                        </button>
                      </div>
                      <input
                        id={draftFieldId(slugKey)}
                        type="text"
                        value={editPayload[slugKey] ?? ""}
                        onChange={(e) => handleFieldChange(slugKey, e.target.value)}
                        aria-invalid={!!editErrors[slugKey]}
                        aria-describedby={editErrors[slugKey] ? `${draftFieldId(slugKey)}-error` : undefined}
                        className={`da-input font-mono${invalid(editErrors[slugKey])}`}
                      />
                      <FieldError id={draftFieldId(slugKey)} message={editErrors[slugKey]} />
                    </div>
                  )}

                  {/* Summary / Excerpt (if present) */}
                  {summaryKey && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="da-label mb-0" htmlFor={draftFieldId(summaryKey)}>Summary / Excerpt</label>
                        <span className="font-mono text-[11px] text-slate-400">
                          {String(editPayload[summaryKey] ?? "").length} chars
                        </span>
                      </div>
                      {looksLikeHtml(String(editPayload[summaryKey] ?? "")) ? (
                        <WysiwygEditor
                          id={draftFieldId(summaryKey)}
                          value={String(editPayload[summaryKey] ?? "")}
                          onChange={(val) => handleFieldChange(summaryKey, val)}
                          minHeight="140px"
                          compact
                          error={editErrors[summaryKey]}
                        />
                      ) : (
                        <textarea
                          id={draftFieldId(summaryKey)}
                          rows={3}
                          value={editPayload[summaryKey] ?? ""}
                          onChange={(e) => handleFieldChange(summaryKey, e.target.value)}
                          aria-invalid={!!editErrors[summaryKey]}
                          aria-describedby={editErrors[summaryKey] ? `${draftFieldId(summaryKey)}-error` : undefined}
                          className={`da-input leading-relaxed${invalid(editErrors[summaryKey])}`}
                        />
                      )}
                      <FieldError id={draftFieldId(summaryKey)} message={editErrors[summaryKey]} />
                    </div>
                  )}

                  {/* Main Article Content / Body (WYSIWYG Editor) */}
                  {bodyKey && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <label className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5" htmlFor={draftFieldId(bodyKey)}>
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                            <span>{labelFor(bodyKey)}</span>
                          </label>
                          <p className="text-[12px] text-slate-500">Format headings and links directly, or switch to the HTML source.</p>
                        </div>
                      </div>

                      <WysiwygEditor
                        id={draftFieldId(bodyKey)}
                        value={String(editPayload[bodyKey] ?? "")}
                        onChange={(val) => handleFieldChange(bodyKey, val)}
                        minHeight="320px"
                        maxHeight="600px"
                        error={editErrors[bodyKey]}
                      />
                      <FieldError id={draftFieldId(bodyKey)} message={editErrors[bodyKey]} />
                    </div>
                  )}

                  {/* Other columns */}
                  {otherKeys.length > 0 && (
                    <div className="border-t border-slate-100 pt-4">
                      <div className="da-eyebrow mb-3">Other columns</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {otherKeys.map((key) => {
                          const val = editPayload[key];
                          const isLong = typeof val === "string" && (val.length > 150 || looksLikeHtml(val));

                          if (isLong) {
                            return (
                              <div key={key} className="sm:col-span-2">
                                <label className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px] font-semibold text-slate-700" htmlFor={draftFieldId(key)}>
                                  {labelFor(key)} <span className="font-mono text-[10.5px] font-normal text-slate-400">{key}</span>
                                </label>
                                {looksLikeHtml(val) ? (
                                  <WysiwygEditor
                                    id={draftFieldId(key)}
                                    value={val}
                                    onChange={(newVal) => handleFieldChange(key, newVal)}
                                    minHeight="180px"
                                    compact
                                    error={editErrors[key]}
                                  />
                                ) : (
                                  <textarea
                                    id={draftFieldId(key)}
                                    rows={4}
                                    value={val}
                                    onChange={(e) => handleFieldChange(key, e.target.value)}
                                    aria-invalid={!!editErrors[key]}
                                    aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                                    className={`da-input text-xs font-mono${invalid(editErrors[key])}`}
                                  />
                                )}
                                <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                              </div>
                            );
                          }

                          return (
                            <div key={key}>
                              <label className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px] font-semibold text-slate-700" htmlFor={draftFieldId(key)}>
                                {labelFor(key)} <span className="font-mono text-[10.5px] font-normal text-slate-400">{key}</span>
                              </label>
                              <input
                                id={draftFieldId(key)}
                                type="text"
                                value={typeof val === "object" && val !== null ? JSON.stringify(val) : String(val ?? "")}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                aria-invalid={!!editErrors[key]}
                                aria-describedby={editErrors[key] ? `${draftFieldId(key)}-error` : undefined}
                                className={`da-input py-2${invalid(editErrors[key])}`}
                              />
                              <FieldError id={draftFieldId(key)} message={editErrors[key]} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

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
        onClose={() => { setShowRejectModal(false); setRejectError(null); if (rejectFromCard) { setSelectedItem(null); setRejectFromCard(false); } }}
        size="sm"
        icon={RotateCcw}
        tone="rose"
        title="Send back with notes"
        description={selectedItem ? `Version ${selectedItem.version_number} will be rewritten using your notes.` : undefined}
        footer={
          <>
            <button type="button" onClick={() => { setShowRejectModal(false); setRejectError(null); if (rejectFromCard) { setSelectedItem(null); setRejectFromCard(false); } }} className="da-btn da-btn-ghost">Cancel</button>
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
