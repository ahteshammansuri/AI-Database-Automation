import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { api } from "../../services/api";

export interface RelationOption { id: any; label: string }

interface Props {
  id: string;
  connectionId: number;
  /** Table the column links to, and a friendly singular for it ("category"). */
  refTable: string;
  thing: string;
  value: any;
  /** true: value is the name of a new row created first in refTable. */
  createNew: boolean;
  /** Whether a new linked row may be created (the linked table accepts writes). */
  canCreate: boolean;
  optional: boolean;
  invalid?: boolean;
  onChange: (value: any, createNew: boolean) => void;
  /** Options as loaded, so Orbit can offer the same choices. */
  onOptions?: (options: RelationOption[]) => void;
}

/**
 * A linked column (e.g. category_id): pick an existing row of the linked table by its name, or name a new one that
 * is created first, in the same transaction, and whose new id is stored here. Options are the customer's real rows.
 */
export const RelationPicker: React.FC<Props> = ({ id, connectionId, refTable, thing, value, createNew, canCreate, optional, invalid, onChange, onOptions }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [known, setKnown] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const reportOptions = useRef(onOptions);
  useEffect(() => { reportOptions.current = onOptions; });

  // Load (and search) the linked table's rows; debounced while typing.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await api.getLookupValues(connectionId, refTable, q.trim() || undefined);
        if (cancelled) return;
        const list = (Array.isArray(rows) ? rows : []).map((r: any) => ({ id: r.id, label: String(r.label ?? `#${r.id}`) }));
        setOptions(list);
        setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((o) => [String(o.id), o.label])) }));
        setFailed(null);
        if (!q.trim()) reportOptions.current?.(list);
      } catch (e: any) {
        if (!cancelled) setFailed(e.message || `The ${refTable} rows could not be loaded.`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [connectionId, refTable, q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const empty = !loading && !failed && !q && options.length === 0;
  const picked = !createNew && value !== null && value !== undefined && value !== "" ? known[String(value)] ?? `#${value}` : null;

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[12.5px]" role="radiogroup" aria-label={`How to fill ${thing}`}>
        <button type="button" role="radio" aria-checked={!createNew} onClick={() => createNew && onChange(null, false)}
          className={`rounded-lg px-3 py-1.5 font-semibold transition ${!createNew ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          Use an existing {thing}
        </button>
        {canCreate && (
          <button type="button" role="radio" aria-checked={createNew} onClick={() => !createNew && onChange("", true)}
            className={`rounded-lg px-3 py-1.5 font-semibold transition ${createNew ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <Plus className="mr-1 inline h-3.5 w-3.5" />Add a new {thing}
          </button>
        )}
      </div>

      {createNew ? (
        <div>
          <input id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value, true)} maxLength={190}
            placeholder={`Name of the new ${thing}`} aria-invalid={!!invalid} aria-describedby={invalid ? `${id}-error` : undefined}
            className={`da-input${invalid ? " da-input-invalid" : ""}`} />
          <p className="mt-1 text-[12px] text-slate-500">
            It is added to <span className="font-mono">{refTable}</span> first, then this row uses its new id. If a {thing} with this name already exists, that one is used instead. You see both rows in the review.
          </p>
        </div>
      ) : (
        <div ref={box} className="relative">
          <button id={id} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
            aria-invalid={!!invalid} aria-describedby={invalid ? `${id}-error` : undefined}
            className={`da-input flex items-center justify-between text-left${invalid ? " da-input-invalid" : ""}`}>
            <span className={picked ? "text-slate-900" : "text-slate-400"}>
              {picked ?? (loading ? `Loading ${refTable}…` : empty ? `No ${refTable} rows yet` : optional ? `None (leave empty)` : `Choose a ${thing}`)}
            </span>
            <span className="flex items-center gap-2">
              {picked && <span className="font-mono text-[11px] text-slate-400">#{value}</span>}
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </span>
          </button>
          {open && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg" role="listbox">
              <div className="relative border-b border-slate-100 p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${refTable}…`} className="da-input py-1.5 pl-8 text-[13px]" />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {optional && (
                  <button type="button" onClick={() => { onChange(null, false); setOpen(false); }} className="flex w-full items-center px-3 py-2 text-left text-[13px] text-slate-500 hover:bg-slate-50">
                    None (leave empty)
                  </button>
                )}
                {loading && <p className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>}
                {failed && <p className="px-3 py-2 text-[12.5px] text-rose-600">{failed}</p>}
                {!loading && !failed && options.length === 0 && <p className="px-3 py-2 text-[12.5px] text-slate-500">{q ? `No ${thing} matches “${q}”.` : `${refTable} has no rows yet.`}</p>}
                {options.map((o) => (
                  <button key={String(o.id)} type="button" role="option" aria-selected={String(o.id) === String(value)}
                    onClick={() => { onChange(o.id, false); setOpen(false); setQ(""); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-indigo-50/60">
                    <span className="truncate text-slate-800">{o.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-slate-400">
                      #{o.id}{String(o.id) === String(value) && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                    </span>
                  </button>
                ))}
                {canCreate && q.trim() && !loading && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
                  <button type="button" onClick={() => { onChange(q.trim(), true); setOpen(false); setQ(""); }}
                    className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50/60">
                    <Plus className="h-3.5 w-3.5" /> Add “{q.trim()}” as a new {thing}
                  </button>
                )}
              </div>
            </div>
          )}
          {empty && canCreate && (
            <p className="mt-1 text-[12px] text-slate-500">
              <button type="button" onClick={() => onChange("", true)} className="font-semibold text-indigo-600 hover:underline">Add a new {thing}</button> to link this row to.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
