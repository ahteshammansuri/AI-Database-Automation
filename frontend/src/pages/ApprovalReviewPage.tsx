import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  ShieldCheck,
  FileText,
  AlertCircle,
  Send
} from "lucide-react";
import { api } from "../services/api";

export const ApprovalReviewPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getApprovalPreview(token);
        setPreview(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchPreview();
  }, [token]);

  const handleAction = async (actionType: "APPROVE" | "REJECT") => {
    if (!token) return;
    try {
      setIsSubmitting(true);
      setError(null);
      const res = await api.submitApprovalAction(token, actionType, feedback);
      setResult(res);
    } catch (err: any) {
      setError(`Action failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-500">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-3"
        >
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto shadow-sm" />
          <p className="text-xs font-semibold text-slate-700">Verifying cryptographic approval token...</p>
          <p className="text-[11px] text-slate-400">Validating HMAC-SHA256 signature and timestamp</p>
        </motion.div>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm"
        >
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-2xs">
            <XCircle className="w-7 h-7" />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Invalid or Expired Link</h3>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 pt-2"
          >
            <span>Return to Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm"
        >
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-2xs">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Decision Recorded</h3>
          <p className="text-xs text-slate-600 font-medium leading-relaxed">{result.message}</p>
          {result.next_step && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 font-mono text-left">
              <strong className="text-slate-900">Next Action:</strong> {result.next_step}
            </div>
          )}
          <Link
            to="/executions"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition"
          >
            <span>View in Executions Log</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      </div>
    );
  }

  const payload = preview?.payload || {};
  const isApproveAction = preview?.action === "APPROVE";

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Info */}
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  isApproveAction ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                  Action: {preview?.action}
                </span>
                <span className="text-xs text-slate-500 font-medium">Version #{preview?.version_number || 1}</span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">{preview?.automation_name}</h2>
            </div>
            <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              Deadline: {preview?.scheduled_publication_time ? new Date(preview.scheduled_publication_time).toLocaleString() : "Immediate"}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Single-use cryptographic HMAC token valid until {new Date(preview?.expires_at).toLocaleString()}</span>
          </div>
        </motion.div>

        {/* Content Preview */}
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4"
        >
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Generated Draft Payload</span>
            <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-2">{payload.title}</h3>
            {payload.excerpt && (
              <p className="text-xs text-slate-600 italic bg-slate-50/80 p-4 rounded-xl border border-slate-200 leading-relaxed">
                {payload.excerpt}
              </p>
            )}
          </div>

          {payload.content && (
            <div className="border border-slate-200 bg-slate-50/50 rounded-xl p-5 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap max-h-96 overflow-y-auto">
              {payload.content}
            </div>
          )}
        </motion.div>

        {/* Interactive Action Submission */}
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4"
        >
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isApproveAction ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Approve Publication</h4>
                <p className="text-xs text-slate-500 mt-0.5">Locks version #{preview?.version_number || 1} and schedules target database insertion</p>
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleAction("APPROVE")}
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Processing Decision...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm Approval</span>
                  </>
                )}
              </motion.button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Reject Draft & Request Regeneration</h4>
                <p className="text-xs text-slate-500 mt-0.5">Provide feedback. The local model will ingest your notes and regenerate a revised draft.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Editorial Revision Feedback</label>
                <textarea
                  rows={3}
                  required
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g. Please emphasize zero-downtime database strategies and add practical code examples..."
                  className="w-full bg-slate-50/50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600 focus:bg-white transition"
                />
              </div>

              <div className="flex justify-end">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleAction("REJECT")}
                  disabled={isSubmitting || !feedback.trim()}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting Feedback...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Reject & Regenerate Version</span>
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
};
