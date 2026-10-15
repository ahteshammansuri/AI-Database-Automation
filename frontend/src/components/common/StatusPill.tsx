import React from "react";

interface StatusPillProps {
  status?: string | null;
  size?: "sm" | "md";
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, size = "md" }) => {
  const safeStatus = (status || "ACTIVE").toString();
  const s = safeStatus.toUpperCase();

  let colorStyles = "bg-slate-100 text-slate-700 border-slate-200";

  if (s === "PUBLISHED" || s === "CONNECTED" || s === "ALLOWLISTED" || s === "ACTIVE" || s === "INDEXED" || s === "APPROVED") {
    colorStyles = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (s === "PENDING_APPROVAL" || s === "GENERATING" || s === "REVIEW_NEEDED" || s === "PAUSED") {
    colorStyles = "bg-amber-50 text-amber-700 border-amber-200";
  } else if (s === "FAILED" || s === "REJECTED" || s === "RESTRICTED" || s === "DISABLED" || s === "CONNECTION_ERROR") {
    colorStyles = "bg-rose-50 text-rose-700 border-rose-200";
  } else if (s === "EXECUTING" || s === "SCHEDULED" || s === "IN_PROGRESS") {
    colorStyles = "bg-sky-50 text-sky-700 border-sky-200";
  }

  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs font-medium";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${sizeClasses} ${colorStyles}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {safeStatus}
    </span>
  );
};
