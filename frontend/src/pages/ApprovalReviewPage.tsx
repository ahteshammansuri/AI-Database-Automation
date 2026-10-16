import React, { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, MessageSquare, Send, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../services/api";
import { ContentPreview } from "../components/content/ContentPreview";
import { formatInstant, relativeFromNow } from "../lib/schedule";

const POLICY_TEXT: Record<string, string> = {
  AUTO_PUBLISH_LATEST: "If nobody decides by then, this version will be published automatically.",
  KEEP_DRAFT: "If nobody decides by then, nothing is published; the draft is kept.",
  CANCEL: "If nobody decides by then, the run is cancelled and nothing is written.",
};

/**
 * Public page opened from the review email. Approving or rejecting needs a click here (POST with
 * the single-use token), so mail scanners that follow links can never publish anything.
 */
export const ApprovalReviewPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState<"APPROVE" | "REJECT" | null>(null);
  const [result, setResult] = useState<{ action: "APPROVE" | "REJECT"; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setLoading(true);
        setData(await api.getApprovalPreview(token));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!loading && location.hash === "#request-changes") {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      feedbackRef.current?.focus();
    }
  }, [loading, location.hash]);

  const act = async (action: "APPROVE" | "REJECT") => {
    if (!token) return;
    if (action === "REJECT" && !feedback.trim()) {
      setError("Tell the AI what to change before requesting a new version.");
      feedbackRef.current?.focus();
      return;
    }
    try {
      setSubmitting(action);
      setError(null);
      const res = await api.submitApprovalAction(token, action, feedback.trim());
      setResult({ action, message: res?.message || (action === "APPROVE" ? "Approved." : "Feedback sent.") });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(null);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {children}
      </motion.div>
    </div>
  );

  if (loading) {
    return shell(
      <>
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-xs font-semibold text-slate-700">Opening the draft…</p>
      </>
    );
  }

  if (!data) {
    return shell(
      <>
        <XCircle className="mx-auto h-10 w-10 text-rose-500" />
        <h1 className="text-lg font-extrabold text-slate-900">This review link does not work</h1>
        <p className="text-xs text-slate-500">{error || "The link is invalid."}</p>
        <Link to="/approvals" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600">Open Approvals in the portal <ArrowRight className="h-3.5 w-3.5" /></Link>
      </>
    );
  }

  if (result) {
    const approved = result.action === "APPROVE";
    return shell(
      <>
        <CheckCircle2 className={`mx-auto h-10 w-10 ${approved ? "text-emerald-600" : "text-indigo-600"}`} />
        <h1 className="text-lg font-extrabold text-slate-900">{approved ? "Approved" : "Changes requested"}</h1>
        <p className="text-xs text-slate-600">{result.message}</p>
        <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          {approved
            ? data.publication_time && new Date(data.publication_time) > new Date()
              ? `It will be written to ${data.target_table} on ${formatInstant(data.publication_time, data.timezone || "UTC", { withZone: true })}.`
              : `It is being written to ${data.target_table} now.`
            : "A new version is being written with your feedback. You will get a new review email when it is ready."}
        </p>
        <Link to="/executions" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700">
          Open execution history <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </>
    );
  }

  const tz = data.timezone || "UTC";
  const closed = !data.valid;
  const closedReason = data.is_used
    ? "A decision was already made with this link."
    : data.is_expired
    ? "This link has expired."
    : !data.reviewable
    ? `This draft is no longer waiting for review (the run is ${String(data.execution_status || "").toLowerCase().replace(/_/g, " ")}).`
    : null;

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">Review before publishing</span>
            <span className="text-xs text-slate-500">Version {data.version_number}</span>
          </div>
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">{data.automation_name}</h1>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <div>
                <p className="font-semibold text-slate-800">{data.publication_time ? formatInstant(data.publication_time, tz, { withZone: true }) : "No publication time"}</p>
                <p className="text-slate-500">{data.publication_time ? `Publishes ${relativeFromNow(data.publication_time)} into ${data.target_table}` : ""}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-slate-600">{POLICY_TEXT[data.timeout_policy] ?? POLICY_TEXT.KEEP_DRAFT} This link works once and expires {formatInstant(data.expires_at, tz)}.</p>
            </div>
          </div>
          {data.rejection_feedback && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Rewritten after feedback: “{data.rejection_feedback}”</p>
          )}
        </header>

        {closed && closedReason && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-slate-300 bg-white p-3.5 text-xs text-slate-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>{closedReason} You can still see the content below.</span>
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-5">
          <ContentPreview payload={data.content_payload || {}} meta={data.meta} targetTable={data.target_table} timezone={tz} />
        </section>

        {!closed && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Looks good?</h2>
                <p className="text-xs text-slate-500">Approving locks exactly this version for publication.</p>
              </div>
              <button type="button" onClick={() => act("APPROVE")} disabled={!!submitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60">
                {submitting === "APPROVE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve version {data.version_number}
              </button>
            </div>
            <div id="request-changes" className="space-y-2 border-t border-slate-100 pt-4">
              <label htmlFor="feedback" className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><MessageSquare className="h-4 w-4 text-indigo-600" /> Request changes</label>
              <p className="text-xs text-slate-500">The AI rewrites it using your notes and sends you a new version to review.</p>
              <textarea
                id="feedback"
                ref={feedbackRef}
                rows={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Make the title more specific, add a short example, and choose the Cloud category."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <div className="flex justify-end">
                <button type="button" onClick={() => act("REJECT")} disabled={!!submitting} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60">
                  {submitting === "REJECT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send feedback and rewrite
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
