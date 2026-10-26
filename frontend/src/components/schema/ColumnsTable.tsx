import React, { useState } from "react";
import { EyeOff, Key, Link as LinkIcon, Lock, Search } from "lucide-react";
import type { SchemaTable } from "../../types";
import { addRule, requiredColumns } from "./schemaFacts";

interface Props {
  table: SchemaTable;
  onOpenTable: (name: string) => void;
}

const TONE: Record<string, string> = {
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  slate: "bg-slate-50 text-slate-600 ring-slate-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

/** Every column: its type, what adding a row needs, where it links, allowed values and protection. */
export const ColumnsTable: React.FC<Props> = ({ table, onOpenTable }) => {
  const [filter, setFilter] = useState("");
  const columns = table.columns || [];
  const links = new Map((table.relationships || []).map((r) => [r.foreign_key || r.constrained_column || "", r]));
  const required = requiredColumns(table);
  const q = filter.trim().toLowerCase();
  const shown = q ? columns.filter((c) => c.name.toLowerCase().includes(q) || (c.type || c.data_type || "").toLowerCase().includes(q)) : columns;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-bold text-slate-900">Columns · {columns.length}</h4>
          {required.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-slate-500">
              A new row needs: {required.map((c, i) => <React.Fragment key={c.name}>{i > 0 && ", "}<span className="font-mono font-semibold text-slate-700">{c.name}</span></React.Fragment>)}
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] text-slate-500">Every column can be left empty or has a default when a row is added.</p>
          )}
        </div>
        {columns.length > 10 && (
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a column…" aria-label="Find a column" className="da-input py-1.5 pl-8 text-[13px]" />
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="da-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>When a row is added</th>
              <th>Links to</th>
              <th>Allowed values</th>
            </tr>
          </thead>
          <tbody className="text-[12.5px]">
            {shown.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">No column matches “{filter}”.</td></tr>
            )}
            {shown.map((col) => {
              const rule = addRule(col);
              const link = links.get(col.name);
              return (
                <tr key={col.name}>
                  <td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-semibold text-slate-900">{col.name}</span>
                      {col.is_primary_key && <span title="Primary key: identifies each row"><Key className="h-3 w-3 text-amber-500" /></span>}
                      {col.is_unique && !col.is_primary_key && <span className="da-chip da-chip-violet px-1.5 text-[10.5px]" title="No two rows may share a value">Unique</span>}
                      {col.sensitivity === "secret" && (
                        <span className="da-chip da-chip-rose px-1.5 text-[10.5px]" title="Secret values (passwords, tokens, card numbers) are never shown, sent to AI or written.">
                          <Lock className="h-3 w-3" /> Secret
                        </span>
                      )}
                      {col.sensitivity === "pii" && (
                        <span className="da-chip da-chip-amber px-1.5 text-[10.5px]" title="Personal data is masked in the Data page; revealing it is recorded in your audit log.">
                          <EyeOff className="h-3 w-3" /> Personal
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="font-mono font-medium text-indigo-600">{col.type || col.data_type}</td>
                  <td>
                    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${TONE[rule.tone]}`} title={rule.title}>
                      {rule.label.length > 40 ? `${rule.label.slice(0, 40)}…` : rule.label}
                    </span>
                  </td>
                  <td>
                    {link ? (
                      <button type="button" onClick={() => onOpenTable(link.referenced_table)} className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-indigo-700 hover:underline" title={`Open ${link.referenced_table}`}>
                        <LinkIcon className="h-3 w-3" /> {link.referenced_table}.{link.referenced_column}
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="text-slate-500">
                    {col.enum_values && col.enum_values.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {col.enum_values.map((v) => <span key={v} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-700">{v}</span>)}
                      </span>
                    ) : col.max_length ? (
                      <span>Up to {Number(col.max_length).toLocaleString()} characters</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
