import React, { useEffect, useState } from "react";
import { Check, ChevronDown, ListFilter, Loader2, Plus, Search } from "lucide-react";
import { api } from "../../services/api";
import { blankValue, fitsFamily, valueText, type LinkScope, type ValueChoices } from "./linkValue";
import { useDropdown } from "./useDropdown";

interface Props {
  id: string;
  scope: LinkScope;
  table: string;
  column: string;
  value: any;
  onChange: (value: any) => void;
  /** Column family (integer, string ...): a new typed value must fit it. */
  family: string;
  nullable: boolean;
  /** The owner's names for values ({"1": "Published"}); the list adds the names it loads. */
  labels?: Record<string, string> | null;
  /** The column's database default, used when the field is left empty. */
  defaultValue?: string | null;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * A status-like column (status, type, is_active ...) as a list of the values it already holds, named where the owner
 * named them and with how many rows use each, instead of a bare number box. Another value can still be typed when it
 * fits the column.
 */
export const ValuePicker: React.FC<Props> = ({ id, scope, table, column, value, onChange, family, nullable, labels, defaultValue, invalid, describedBy }) => {
  const dd = useDropdown<HTMLDivElement>(300);
  const [choices, setChoices] = useState<ValueChoices | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setChoices(null);
    setFailed(false);
  }, [scope.connectionId, table, column]);

  useEffect(() => {
    if (!dd.open || choices || failed) return;
    setLoading(true);
    api.columnValues(scope, table, column).then(setChoices).catch(() => setFailed(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dd.open, choices, failed, scope.connectionId, scope.context, table, column]);

  const names: Record<string, string> = { ...(labels ?? {}) };
  for (const c of choices?.values ?? []) if (c.label) names[String(c.value)] = c.label;

  const typed = q.trim();
  const list = (choices?.values ?? []).filter((c) => !typed || String(c.value).toLowerCase().includes(typed.toLowerCase()) || (c.label ?? "").toLowerCase().includes(typed.toLowerCase()));
  const exact = (choices?.values ?? []).some((c) => String(c.value) === typed);
  const pick = (v: any) => {
    onChange(v);
    dd.close();
    setQ("");
  };
  const typedValue = family === "integer" ? Number(typed) : typed;
  const shown = valueText(value, names);

  return (
    <div className="relative" ref={dd.box}>
      <button type="button" id={id} onClick={() => dd.toggle()} aria-haspopup="listbox" aria-expanded={dd.open}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className={`da-input flex items-center justify-between gap-2 text-left${invalid ? " da-input-invalid" : ""}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          <ListFilter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {blankValue(value) ? (
            <span className="truncate text-slate-400">
              {defaultValue !== null && defaultValue !== undefined && !/^(null|current_timestamp)/i.test(defaultValue) ? `Default: ${valueText(defaultValue.replace(/^'|'$/g, ""), names)}` : nullable ? "Empty" : "Choose…"}
            </span>
          ) : <span className="truncate text-slate-900">{shown}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {!blankValue(value) && shown !== String(value) && <span className="font-mono text-[11px] text-slate-400">{String(value)}</span>}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>

      {dd.open && (
        <div className={`absolute left-0 right-0 z-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lift ${dd.up ? "bottom-full mb-1.5" : "mt-1.5"}`}>
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Find or type a value for ${column}`}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); dd.close(); }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (list[0]) pick(list[0].value);
                  else if (fitsFamily(typed, family)) pick(typedValue);
                }
              }}
              placeholder="Find a value, or type another"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-[13px] focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="max-h-56 overflow-y-auto" role="listbox" aria-label={`Values of ${column}`}>
            {nullable && !typed && (
              <button type="button" role="option" aria-selected={blankValue(value)} onClick={() => pick(null)} className="flex w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-slate-500 hover:bg-slate-50">Empty</button>
            )}
            {loading && <p className="flex items-center gap-1.5 px-2 py-2 text-[12.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the values in use…</p>}
            {failed && <p className="px-2 py-2 text-[12.5px] text-slate-500">The values in use could not be read; type a value.</p>}
            {list.map((c) => {
              const selected = !blankValue(value) && String(c.value) === String(value);
              return (
                <button key={String(c.value)} type="button" role="option" aria-selected={selected} onClick={() => pick(c.value)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-indigo-50 ${selected ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-800"}`}>
                  <span className="truncate">{c.label ?? String(c.value)}</span>
                  {c.label && <span className="font-mono text-[11px] text-slate-400">{String(c.value)}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400">{c.count === null ? "" : c.count === 0 ? "not used yet" : `${c.count.toLocaleString()} row${c.count === 1 ? "" : "s"}`}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                </button>
              );
            })}
            {choices && !loading && list.length === 0 && !typed && <p className="px-2 py-2 text-[12.5px] text-slate-500">No values yet. Type the first one.</p>}
            {typed && !exact && fitsFamily(typed, family) && (
              <button type="button" onClick={() => pick(typedValue)} className="mt-1 flex w-full items-center gap-1.5 border-t border-slate-100 px-2 pt-2 text-left text-[13px] font-semibold text-indigo-700">
                <Plus className="h-3.5 w-3.5" /> Use “{typed}”
              </button>
            )}
            {typed && !fitsFamily(typed, family) && <p className="mt-1 border-t border-slate-100 px-2 pt-2 text-[12px] text-rose-600">{family === "integer" ? "This column holds whole numbers." : "This value does not fit the column."}</p>}
          </div>
          {choices && !choices.complete && <p className="mt-1.5 border-t border-slate-100 px-2 pt-1.5 text-[11px] text-slate-400">The most used values; others are possible.</p>}
        </div>
      )}
    </div>
  );
};
