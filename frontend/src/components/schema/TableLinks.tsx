import React from "react";
import { ArrowDownLeft, ArrowUpRight, Link as LinkIcon, TableProperties } from "lucide-react";
import type { SchemaTable } from "../../types";
import { incomingLinks } from "./schemaFacts";

interface Props {
  table: SchemaTable;
  all: SchemaTable[];
  onOpen: (name: string) => void;
}

/** One linked table; opens it when it is in this snapshot. */
const Item: React.FC<{ target: string; known: boolean; onOpen: (name: string) => void; detail: string; children: React.ReactNode }> = ({ target, known, onOpen, detail, children }) =>
  known ? (
    <button type="button" onClick={() => onOpen(target)}
      className="group flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40">
      <TableProperties className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 group-hover:text-indigo-500" />
      <span className="min-w-0">
        <span className="block text-[13px] text-slate-800">{children}</span>
        <span className="block font-mono text-[11.5px] text-slate-500">{detail}</span>
      </span>
    </button>
  ) : (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
      <TableProperties className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0">
        <span className="block text-[13px] text-slate-800">{children}</span>
        <span className="block font-mono text-[11.5px] text-slate-500">{detail} · not in this snapshot</span>
      </span>
    </div>
  );

/** Which tables this one points to, and which point to it, in plain words; each link opens that table. */
export const TableLinks: React.FC<Props> = ({ table, all, onOpen }) => {
  const outgoing = table.relationships || [];
  const incoming = incomingLinks(table, all);
  const known = new Set(all.map((t) => t.name));

  if (outgoing.length === 0 && incoming.length === 0) {
    return (
      <div>
        <h4 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-slate-900"><LinkIcon className="h-4 w-4 text-indigo-600" /> Links to other tables</h4>
        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-[13px] text-slate-500">
          This table stands alone: it does not point to other tables, and no table points to it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-slate-900">
        <LinkIcon className="h-4 w-4 text-indigo-600" /> Links to other tables · {outgoing.length + incoming.length}
      </h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section aria-label="Tables this table points to">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            <ArrowUpRight className="h-3.5 w-3.5" /> Each row belongs to
          </p>
          {outgoing.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">Nothing: rows here do not point to other tables.</p>
          ) : (
            <div className="space-y-2">
              {outgoing.map((r) => {
                const col = r.foreign_key || r.constrained_column || "";
                const optional = (table.columns || []).find((c) => c.name === col)?.nullable;
                return (
                  <Item key={`${col}-${r.referenced_table}`} target={r.referenced_table} known={known.has(r.referenced_table)} onOpen={onOpen} detail={`${col} → ${r.referenced_table}.${r.referenced_column}`}>
                    one row in <strong>{r.referenced_table}</strong>{optional ? <span className="text-slate-500"> (optional)</span> : null}
                  </Item>
                );
              })}
              <p className="text-[12px] leading-relaxed text-slate-500">
                When an automation adds a row here, it fills these links for you: it uses an existing row of the linked table, or creates one first and uses its new id when you choose that in the builder.
              </p>
            </div>
          )}
        </section>
        <section aria-label="Tables that point to this table">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            <ArrowDownLeft className="h-3.5 w-3.5" /> Used by
          </p>
          {incoming.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">No other table points to rows here.</p>
          ) : (
            <div className="space-y-2">
              {incoming.map((l) => (
                <Item key={`${l.table}-${l.column}`} target={l.table} known={known.has(l.table)} onOpen={onOpen} detail={`${l.table}.${l.column} → ${table.name}.${l.referenced_column}`}>
                  rows in <strong>{l.table}</strong> point here
                </Item>
              ))}
              <p className="text-[12px] leading-relaxed text-slate-500">Before a row here is deleted, you see how many of these rows depend on it.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
