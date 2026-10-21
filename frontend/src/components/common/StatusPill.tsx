import React from "react";
import { humanStatus } from "./statusText";

interface StatusPillProps {
  status?: string | null;
  size?: "sm" | "md";
}

const GOOD = ["PUBLISHED", "CONNECTED", "ALLOWLISTED", "ACTIVE", "INDEXED", "APPROVED", "SUCCEEDED", "COMPLETED", "SUCCESS", "HEALTHY", "OK"];
const WAIT = ["PENDING_APPROVAL", "REVIEW_NEEDED", "PAUSED", "PARTIAL_SUCCESS", "WAITING_FOR_INPUT", "WAITING_FOR_APPROVAL", "PENDING", "DRAFT", "STALE"];
const BAD = ["FAILED", "REJECTED", "RESTRICTED", "DISABLED", "CONNECTION_ERROR", "ERROR", "CANCELLED", "EXPIRED", "BLOCKED"];
const BUSY = ["EXECUTING", "SCHEDULED", "IN_PROGRESS", "GENERATING", "RUNNING", "QUEUED", "PUBLISHING", "INDEXING", "PROCESSING"];

export const StatusPill: React.FC<StatusPillProps> = ({ status, size = "md" }) => {
  const s = (status || "ACTIVE").toString().toUpperCase();

  let tone = "bg-slate-50 text-slate-600 border-slate-200";
  let dot = "bg-slate-400";
  let live = false;
  if (GOOD.includes(s)) {
    tone = "bg-emerald-50 text-emerald-700 border-emerald-200";
    dot = "bg-emerald-500";
  } else if (WAIT.includes(s)) {
    tone = "bg-amber-50 text-amber-700 border-amber-200";
    dot = "bg-amber-500";
  } else if (BAD.includes(s)) {
    tone = "bg-rose-50 text-rose-700 border-rose-200";
    dot = "bg-rose-500";
  } else if (BUSY.includes(s)) {
    tone = "bg-sky-50 text-sky-700 border-sky-200";
    dot = "bg-sky-500";
    live = true;
  }

  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]";

  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold ${sizeClasses} ${tone}`}>
      <span className="relative flex h-1.5 w-1.5">
        {live && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
      {humanStatus(s)}
    </span>
  );
};
