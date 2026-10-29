import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, Link2, Loader2, Search } from "lucide-react";
import { api } from "../../services/api";
import { FieldError } from "../ui/kit";
import { DatePicker } from "../ui/DatePicker";
import { TimePicker } from "../ui/TimePicker";
import { Select2 } from "../ui/Select2";
import { todayIn } from "../../lib/schedule";
import type { DataColumn } from "./types";
import { isEditable } from "./types";

interface Props {
  connectionId: number;
  table: string;
  columns: DataColumn[];
  values: Record<string, any>;
  onChange: (column: string, value: any) => void;
  errors: Record<string, string>;
  insert: boolean;
  /** Readable names of the current linked values (category_id 3 -> "Fashion"). */
  labels?: Record<string, Record<string, string>>;
}

const KIND: Record<string, string> = {
  integer: "Whole number", decimal: "Number", boolean: "Yes / no", enum: "Choice", string: "Text", text: "Long text",
  date: "Date", time: "Time", timestamp_tz: "Date and time", timestamp_naive: "Date and time", json: "JSON",
};

export const fieldId = (column: string) => `row-field-${column}`;

/** Search the linked table by its readable name and pick a row (stores its id). */
const LinkSelect: React.FC<{ connectionId: number; table: string; col: DataColumn; value: any; label?: string; invalid: boolean; onChange: (v: any) => void }> = ({
  connectionId, table, col, value, label, invalid, onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<{ id: any; label: string | null }[]>([]);
  const [picked, setPicked] = useState<string | null>(label ?? null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.dataLinkOptions(connectionId, table, col.name, q);
        setOptions(res?.options ?? []);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, q, connectionId, table, col.name]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button type="button" id={fieldId(col.name)} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${fieldId(col.name)}-error` : undefined}
        className={`da-input flex items-center justify-between gap-2 text-left${invalid ? " da-input-invalid" : ""}`}>
        <span className={`flex min-w-0 items-center gap-1.5 ${value === null || value === "" || value === undefined ? "text-slate-400" : "text-slate-900"}`}>
          <Link2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          <span className="truncate">{value === null || value === "" || value === undefined ? `Choose from ${col.link!.table}…` : `${picked ?? ""} #${value}`.trim()}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-lift">
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${col.link!.table}…`}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-[13px] focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading ? <p className="flex items-center gap-1.5 px-2 py-2 text-[12.5px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</p>
              : options.length === 0 ? <p className="px-2 py-2 text-[12.5px] text-slate-500">No rows found in {col.link!.table}.</p>
              : options.map((o) => (
                <button key={String(o.id)} type="button" onClick={() => { onChange(o.id); setPicked(o.label); setOpen(false); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-indigo-50 ${String(o.id) === String(value) ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-700"}`}>
                  <span className="truncate">{o.label ?? `Row ${o.id}`}</span><span className="shrink-0 font-mono text-[11px] text-slate-400">#{String(o.id)}</span>
                </button>
              ))}
            {col.nullable && (
              <button type="button" onClick={() => { onChange(null); setPicked(null); setOpen(false); }} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] text-slate-500 hover:bg-slate-50">Leave empty</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const RowForm: React.FC<Props> = ({ connectionId, table, columns, values, onChange, errors, insert, labels }) => {
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const editable = columns.filter((c) => isEditable(c, insert));
  const automatic = columns.filter((c) => !isEditable(c, insert));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {editable.map((c) => {
          const err = errors[c.name];
          const v = values[c.name];
          const required = !c.nullable && c.default === null && !c.auto;
          const wide = ["text", "json"].includes(c.family) || (c.max_length ?? 0) > 120;
          const common = { id: fieldId(c.name), "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${fieldId(c.name)}-error` : undefined };
          const cls = `da-input${err ? " da-input-invalid" : ""}`;
          let input: React.ReactNode;
          if (c.link) {
            input = <LinkSelect connectionId={connectionId} table={table} col={c} value={v} label={v !== null && v !== undefined ? labels?.[c.name]?.[String(v)] : undefined} invalid={!!err} onChange={(x) => onChange(c.name, x)} />;
          } else if (c.family === "boolean") {
            const on = v === 1 || v === "1" || v === true;
            input = (
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={c.name} id={fieldId(c.name)}>
                {[{ x: 1, l: "Yes" }, { x: 0, l: "No" }].map((o) => (
                  <button key={o.x} type="button" role="radio" aria-checked={(o.x === 1) === on && v !== null && v !== undefined && v !== ""} onClick={() => onChange(c.name, o.x)}
                    className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition ${(o.x === 1) === on && v !== null && v !== undefined && v !== "" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}>{o.l}</button>
                ))}
              </div>
            );
          } else if (c.enum.length && c.family === "enum") {
            const enumOptions = [
              ...(c.nullable ? [{ value: "", label: "Empty (NULL)" }] : []),
              ...c.enum.map((o) => ({ value: o, label: o })),
            ];
            input = (
              <Select2
                id={fieldId(c.name)}
                value={v ?? ""}
                onChange={(val) => onChange(c.name, val === "" ? null : val)}
                options={enumOptions}
                placeholder={c.nullable ? "Empty" : "Choose…"}
                invalid={!!err}
                showSearch={c.enum.length > 5}
              />
            );
          } else if (c.family === "date") {
            input = <DatePicker value={v ? String(v).slice(0, 10) : null} today={today} onChange={(d) => onChange(c.name, d || null)} ariaLabel={c.name} />;
          } else if (c.family === "time") {
            input = <TimePicker value={v ? String(v).slice(0, 5) : "09:00"} onChange={(t) => onChange(c.name, t)} ariaLabel={c.name} />;
          } else if (c.family === "timestamp_tz" || c.family === "timestamp_naive") {
            const [d, t] = String(v ?? "").split(/[ T]/);
            input = (
              <div className="grid grid-cols-2 gap-2">
                <DatePicker value={d || null} today={today} onChange={(nd) => onChange(c.name, nd ? `${nd} ${(t || "09:00").slice(0, 5)}:00` : null)} ariaLabel={`${c.name} date`} />
                <TimePicker value={(t || "09:00").slice(0, 5)} onChange={(nt) => onChange(c.name, `${d || today} ${nt}:00`)} ariaLabel={`${c.name} time`} />
              </div>
            );
          } else if (c.family === "text" || c.family === "json") {
            input = <textarea {...common} rows={c.family === "json" ? 4 : 3} value={v ?? ""} onChange={(e) => onChange(c.name, e.target.value)} className={`${cls} ${c.family === "json" ? "font-mono text-[12.5px]" : ""}`} />;
          } else {
            input = (
              <input {...common} type={["integer", "decimal"].includes(c.family) ? "text" : "text"} inputMode={c.family === "integer" ? "numeric" : c.family === "decimal" ? "decimal" : undefined}
                value={v ?? ""} maxLength={c.max_length ?? undefined} onChange={(e) => onChange(c.name, e.target.value)} className={cls} />
            );
          }
          return (
            <div key={c.name} className={wide ? "sm:col-span-2" : ""}>
              <label htmlFor={fieldId(c.name)} className="da-label flex items-center gap-1.5">
                <span className="font-mono">{c.name}</span>
                {required && <span className="rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">Required</span>}
                <span className="ml-auto text-[11px] font-normal text-slate-400">{c.link ? `Links to ${c.link.table}` : KIND[c.family] ?? c.type}{c.max_length && ["string"].includes(c.family) ? ` · max ${c.max_length}` : ""}</span>
              </label>
              {input}
              <FieldError id={fieldId(c.name)} message={err} />
              {!err && c.comment && <p className="da-help">{c.comment}</p>}
            </div>
          );
        })}
      </div>
      {automatic.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Filled by the database: {automatic.map((c) => <code key={c.name} className="mx-0.5 rounded bg-white px-1">{c.name}</code>)}</span>
        </p>
      )}
    </div>
  );
};
