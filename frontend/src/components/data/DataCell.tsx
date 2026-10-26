import React from "react";
import { Check, Link2, Minus } from "lucide-react";
import type { DataColumn } from "./types";

/** One value shown in the table: links by name, yes/no as icons, empty as a dash, long text shortened. */
export const DataCell: React.FC<{ col: DataColumn; value: any; label?: string; full?: boolean }> = ({ col, value, label, full }) => {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  if (col.family === "boolean") {
    const on = value === 1 || value === "1" || value === true;
    return on ? <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" /> : <Minus className="h-4 w-4 text-slate-300" aria-label="No" />;
  }
  if (col.link) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50/60 px-1.5 py-0.5 text-[12px] text-indigo-800">
        <Link2 className="h-3 w-3 shrink-0 text-indigo-400" />
        <span className="truncate">{label ?? `#${value}`}</span>
        {label && <span className="shrink-0 text-indigo-400">#{String(value)}</span>}
      </span>
    );
  }
  if (col.enum.length) return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-medium text-slate-700">{String(value)}</span>;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (["integer", "decimal"].includes(col.family)) return <span className="tabular-nums">{text}</span>;
  if (full) return <span className="whitespace-pre-wrap break-words">{text}</span>;
  return <span className="block max-w-[22rem] truncate" title={text.length > 60 ? text.slice(0, 400) : undefined}>{text}</span>;
};
