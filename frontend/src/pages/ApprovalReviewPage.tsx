import React, { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, MessageSquare, Send, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../services/api";
import { ContentPreview } from "../components/content/ContentPreview";
import { formatInstant, relativeFromNow } from "../lib/schedule";
import { FieldError } from "../components/ui/kit";
import { invalid, rules, serverFieldErrors, validateField } from "../lib/validation";

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
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
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
    if (action === "REJECT") {
      const problem = validateField("feedback", { feedback }, {
        feedback: [rules.required("Feedback", "Tell the AI what to change before requesting a new version."), rules.maxLength(2000, "Feedback")],
      });
      setFeedbackError(problem);
      if (problem) {
        feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        feedbackRef.current?.focus({ preventScroll: true });
        return;
      }
    }
    try {
      setSubmitting(action);
      setError(null);
      const res = await api.submitApprovalAction(token, action, feedback.trim());
      setResult({ action, message: res?.message || (action === "APPROVE" ? "Approved." : "Feedback sent.") });
    } catch (err: any) {
      const fieldMsg = serverFieldErrors(err).feedback;
      if (fieldMsg) setFeedbackError(fieldMsg);
      else setError(err.message);
    } finally {
      setSubmitting(null);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas p-4">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 portal-canvas-grid" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="da-card relative w-full max-w-md space-y-4 p-7 text-center sm:p-9">
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
        <p className="da-panel p-3.5 text-[13px] text-slate-600">
          {approved
            ? data.publication_time && new Date(data.publication_time) > new Date()
              ? `It will be written to ${data.target_table} on ${formatInstant(data.publication_time, data.timezone || "UTC", { withZone: true })}.`
              : `It is being written to ${data.target_table} now.`
            : "A new version is being written with your feedback. You will get a new review email when it is ready."}
        </p>
        <Link to="/executions" className="da-btn da-btn-primary">
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
    <div className="min-h-screen bg-canvas">
      {/* Ink header, as on the landing page */}
      <div className="relative overflow-hidden bg-ink px-4 pb-24 pt-8 text-white sm:px-6">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -left-24 -top-32 h-96 w-96 rounded-full bg-indigo-600/35" />
          <div className="landing-blob absolute -right-20 top-0 h-80 w-80 rounded-full bg-violet-600/25" style={{ animationDelay: "-6s" }} />
          <div className="absolute inset-0 landing-grid" />
        </div>
        <div className="relative mx-auto max-w-3xl">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.8)]">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[16px] font-bold tracking-tight">DataAuto</span>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-semibold text-indigo-200">Review before publishing</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">Version {data.version_number}</span>
          </div>
          <h1 className="mt-4 text-[28px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[34px]">{data.automation_name}</h1>
        </div>
      </div>

      <div className="relative mx-auto -mt-16 max-w-3xl space-y-4 px-4 pb-12 sm:px-6">
        <header className="da-card grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <div className="flex items-start gap-3 rounded-2xl bg-slate-50/80 p-3.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <div className="text-[13px]">
              <p className="font-semibold text-slate-800">{data.publication_time ? formatInstant(data.publication_time, tz, { withZone: true }) : "No publication time"}</p>
              <p className="text-slate-500">{data.publication_time ? `Publishes ${relativeFromNow(data.publication_time)} into ${data.target_table}` : ""}</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl bg-slate-50/80 p-3.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-[13px] text-slate-600">{POLICY_TEXT[data.timeout_policy] ?? POLICY_TEXT.KEEP_DRAFT} This link works once and expires {formatInstant(data.expires_at, tz)}.</p>
          </div>
          {data.rejection_feedback && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 sm:col-span-2">Rewritten after feedback: “{data.rejection_feedback}”</p>
          )}
        </header>

        {closed && closedReason && (
          <div role="status" className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-xs">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>{closedReason} You can still see the content below.</span>
          </div>
        )}

        <section className="da-card p-3 sm:p-6">
          <ContentPreview payload={data.content_payload || {}} meta={data.meta} targetTable={data.target_table} timezone={tz} />
        </section>

        {!closed && (
          <section className="da-card space-y-5 p-5 sm:p-7">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">Looks good?</h2>
                <p className="text-[13px] text-slate-500">Approving locks exactly this version for publication.</p>
              </div>
              <button type="button" onClick={() => act("APPROVE")} disabled={!!submitting} className="da-btn da-btn-success px-6 py-2.5">
                {submitting === "APPROVE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve version {data.version_number}
              </button>
            </div>
            <div id="request-changes" className="space-y-2 border-t border-slate-100 pt-4">
              <label htmlFor="feedback" className="flex items-center gap-2 text-[16px] font-bold text-slate-950"><MessageSquare className="h-4 w-4 text-indigo-600" /> Request changes</label>
              <p className="text-[13px] text-slate-500">The AI rewrites it using your notes and sends you a new version to review.</p>
              <textarea
                id="feedback"
                ref={feedbackRef}
                rows={3}
                value={feedback}
                onChange={(e) => { setFeedback(e.target.value); setFeedbackError(null); }}
                placeholder="e.g. Make the title more specific, add a short example, and choose the Cloud category."
                aria-invalid={!!feedbackError}
                aria-describedby={feedbackError ? "feedback-error" : undefined}
                className={`da-input${invalid(feedbackError)}`}
              />
              <FieldError id="feedback" message={feedbackError} />
              <div className="flex justify-end">
                <button type="button" onClick={() => act("REJECT")} disabled={!!submitting} className="da-btn da-btn-secondary">
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
