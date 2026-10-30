import React from "react";
import { ArrowLeft, ArrowRight, Link as LinkIcon, PencilLine, ShieldCheck, Sparkles, TableProperties, UserCheck } from "lucide-react";
import type { SchemaRelationship, SchemaTable } from "../../types";
import { formatRows, incomingLinks, thingOf, unlinkedIdColumns } from "./schemaFacts";

interface Props {
  table: SchemaTable;
  all: SchemaTable[];
  onOpen: (name: string) => void;
  /** Change where a column of this table points (detected and owner links; declared keys are fixed). */
  onEditLink: (column: string) => void;
}

/** How a link was found, as a badge: declared by the database, detected from the name, or set by the owner. */
export const LinkSourceBadge: React.FC<{ relation: SchemaRelationship; compact?: boolean }> = ({ relation, compact }) => {
  const src = relation.source ?? "declared";
  const map = {
    declared: { cls: "da-chip-emerald", icon: ShieldCheck, text: compact ? "Declared" : "Declared · enforced by the database" },
    detected: { cls: "da-chip-amber", icon: Sparkles, text: compact ? "Detected" : "Detected from the name" },
    owner: { cls: "da-chip-violet", icon: UserCheck, text: "Set by you" },
  } as const;
  const b = map[src] ?? map.declared;
  return (
    <span className={`da-chip ${b.cls} max-w-full whitespace-normal px-1.5 py-0 text-[10.5px] leading-snug`} title={relation.reason}>
      <b.icon className="h-3 w-3" /> {b.text}
    </span>
  );
};

/** A table or column name that may wrap after its underscores ("product_<wbr>categories"). */
const Name: React.FC<{ text: string }> = ({ text }) => (
  <>{text.split(/(?<=[_.])/).map((part, i) => <React.Fragment key={i}>{i > 0 && <wbr />}{part}</React.Fragment>)}</>
);

const Connector: React.FC<{ relation: SchemaRelationship; column: string; dir: "in" | "out" }> = ({ relation, column, dir }) => (
  <div className="hidden w-20 shrink-0 flex-col items-center justify-center px-1 xl:flex" aria-hidden>
    <span className="mb-0.5 max-w-full truncate font-mono text-[10.5px] text-slate-500">{column}</span>
    <span className="flex w-full items-center">
      {dir === "in" && <ArrowLeft className="-mr-1 h-3.5 w-3.5 shrink-0 text-indigo-400" />}
      <span className={`h-0 flex-1 border-t-2 ${relation.source === "declared" || !relation.source ? "border-indigo-300" : "border-dashed border-amber-300"}`} />
      {dir === "out" && <ArrowRight className="-ml-1 h-3.5 w-3.5 shrink-0 text-indigo-400" />}
    </span>
  </div>
);

/**
 * The tables around one table, as a small map: the tables each row belongs to (left), the table itself (middle) and
 * the tables whose rows point at it (right). Every link says how it was found, in plain words, and opens the other
 * table; detected links can be confirmed or corrected.
 */
export const RelationshipMap: React.FC<Props> = ({ table, all, onOpen, onEditLink }) => {
  const byName = new Map(all.map((t) => [t.name, t]));
  const outgoing = table.relationships || [];
  const incoming = incomingLinks(table, all);
  const unlinked = unlinkedIdColumns(table);
  const counts = { declared: 0, detected: 0, owner: 0 };
  for (const r of [...outgoing, ...incoming.map((i) => i.relation)]) counts[(r.source ?? "declared") as keyof typeof counts]++;
  const me = thingOf(table.name);

  const card = (name: string, body: React.ReactNode, actions?: React.ReactNode) => {
    const other = byName.get(name);
    return (
      <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-3 transition-colors hover:border-indigo-200">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => other && onOpen(name)} disabled={!other}
            className="flex min-w-0 items-center gap-1.5 text-left font-mono text-[13px] font-semibold text-slate-900 hover:text-indigo-700 disabled:cursor-default disabled:hover:text-slate-900"
            title={other ? `Open ${name}` : `${name} is not in this snapshot`}>
            <TableProperties className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="[overflow-wrap:anywhere]"><Name text={name} /></span>
          </button>
          {actions}
        </div>
        <div className="mt-1 space-y-1 break-words text-[12px] leading-relaxed text-slate-600">{body}</div>
        {other && formatRows(other.approx_rows) && <p className="mt-1 text-[11px] text-slate-400">{formatRows(other.approx_rows)}</p>}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h4 className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
          <LinkIcon className="h-4 w-4 text-indigo-600" /> How {table.name} connects · {outgoing.length + incoming.length}
        </h4>
        {outgoing.length + incoming.length > 0 && (
          <p className="text-[12px] text-slate-500">
            {[counts.declared && `${counts.declared} declared by the database`, counts.detected && `${counts.detected} detected from column names`, counts.owner && `${counts.owner} set by you`].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {outgoing.length + incoming.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-[13px] text-slate-500">
          {table.name} stands alone: its rows do not point to other tables, and no table points to it.
        </p>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(8rem,11rem)_minmax(0,1fr)]">
          <section aria-label={`Tables each ${me} belongs to`} className="space-y-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Each {me} belongs to</p>
            {outgoing.length === 0 && <p className="text-[12.5px] text-slate-400">Nothing: rows here do not point to other tables.</p>}
            {outgoing.map((r) => {
              const col = r.foreign_key || r.constrained_column || "";
              const optional = (table.columns || []).find((c) => c.name === col)?.nullable;
              return (
                <div key={col} className="flex items-stretch">
                  {card(r.referenced_table, (
                    <>
                      <p>Each {me} {optional ? "may belong" : "belongs"} to one <strong>{thingOf(r.referenced_table)}</strong>{optional ? " (optional)" : ""}, stored in <span className="font-mono">{col}</span>.</p>
                      <div className="flex flex-wrap items-center gap-1.5"><LinkSourceBadge relation={r} /></div>
                      {r.source === "detected" && r.alternatives && r.alternatives.length > 0 && (
                        <p className="text-[11px] text-slate-400">Could also be: {r.alternatives.join(", ")}</p>
                      )}
                    </>
                  ), r.source !== "declared" && r.source !== undefined && (
                    <button type="button" onClick={() => onEditLink(col)} className="da-icon-btn h-7 w-7 shrink-0" title={`Change where ${col} points`} aria-label={`Change where ${col} points`}>
                      <PencilLine className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  <Connector relation={r} column={col} dir="out" />
                </div>
              );
            })}
          </section>

          <div className="order-first rounded-2xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-4 text-center xl:order-none xl:sticky xl:top-4">
            <TableProperties className="mx-auto h-5 w-5 text-indigo-500" />
            <p className="mt-1 break-all font-mono text-[14px] font-bold text-slate-950">{table.name}</p>
            {formatRows(table.approx_rows) && <p className="text-[11px] text-slate-500">{formatRows(table.approx_rows)}</p>}
            {table.label_column && <p className="mt-1.5 text-[11px] text-slate-500">Rows are named by <span className="font-mono text-slate-700">{table.label_column}</span></p>}
          </div>

          <section aria-label={`Tables that point to ${table.name}`} className="space-y-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Used by</p>
            {incoming.length === 0 && <p className="text-[12.5px] text-slate-400">No other table points to rows here.</p>}
            {incoming.map((l) => (
              <div key={`${l.table}.${l.column}`} className="flex items-stretch">
                <Connector relation={l.relation} column={l.column} dir="in" />
                {card(l.table, (
                  <>
                    <p>One {me} can have many <strong>{l.table.replace(/_/g, " ")}</strong>, through <span className="font-mono [overflow-wrap:anywhere]"><Name text={`${l.table}.${l.column}`} /></span>.</p>
                    <div className="flex flex-wrap items-center gap-1.5"><LinkSourceBadge relation={l.relation} /></div>
                  </>
                ))}
              </div>
            ))}
            {incoming.length > 0 && <p className="text-[11.5px] leading-relaxed text-slate-500">Before a row here is deleted, you see how many of these rows still point at it.</p>}
          </section>
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600">
          <p className="font-semibold text-slate-800">Columns named like a link, but not linked</p>
          <p className="mt-0.5">No table matched these names (or you said they are not links). If one of them does point to a table, set it so every form offers a list instead of a number.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unlinked.map((c) => (
              <button key={c.name} type="button" onClick={() => onEditLink(c.name)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[11.5px] text-slate-700 hover:border-indigo-300 hover:text-indigo-700">
                {c.name} <PencilLine className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">
        Every form shows these links as a list of names (never a number to type). A detected link is not enforced by the database, so the platform checks each value before it is saved.
      </p>
    </div>
  );
};
