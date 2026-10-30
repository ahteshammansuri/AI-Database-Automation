import React from "react";
import { KeyRound } from "lucide-react";
import { FieldError } from "../ui/kit";
import { DatePicker } from "../ui/DatePicker";
import { TimePicker } from "../ui/TimePicker";
import { Select2 } from "../ui/Select2";
import { todayIn } from "../../lib/schedule";
import { LinkPicker } from "../links/LinkPicker";
import { ValuePicker } from "../links/ValuePicker";
import { humanize, linkSourceText, type LinkScope } from "../links/linkValue";
import type { DataColumn } from "./types";
import { isEditable } from "./types";

interface Props {
  /** Where linked rows and value choices are read from (the Data page, or publishing). */
  scope: LinkScope;
  table: string;
  columns: DataColumn[];
  values: Record<string, any>;
  onChange: (column: string, value: any) => void;
  errors: Record<string, string>;
  insert: boolean;
  /** Readable names of the current linked values (category_id 3 -> "Fashion"). */
  labels?: Record<string, Record<string, string>>;
  /** Offer adding new linked rows from this form (off inside the "new linked row" form itself). */
  allowCreateLinks?: boolean;
  /** List the columns the database fills under the form. */
  automaticNote?: boolean;
}

const KIND: Record<string, string> = {
  integer: "Whole number", decimal: "Number", boolean: "Yes / no", enum: "Choice", string: "Text", text: "Long text",
  date: "Date", time: "Time", timestamp_tz: "Date and time", timestamp_naive: "Date and time", json: "JSON",
};

export const fieldId = (column: string) => `row-field-${column}`;

export const RowForm: React.FC<Props> = ({ scope, table, columns, values, onChange, errors, insert, labels, allowCreateLinks = true, automaticNote = true }) => {
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
            input = (
              <LinkPicker id={fieldId(c.name)} scope={scope} table={table} column={c.name} value={v} onChange={(x) => onChange(c.name, x)}
                allowCreate={allowCreateLinks} invalid={!!err} describedBy={err ? `${fieldId(c.name)}-error` : undefined}
                initialLabel={v !== null && v !== undefined ? labels?.[c.name]?.[String(v)] : undefined} />
            );
          } else if (c.choices === "values") {
            input = (
              <ValuePicker id={fieldId(c.name)} scope={scope} table={table} column={c.name} value={v} onChange={(x) => onChange(c.name, x)}
                family={c.family} nullable={c.nullable} labels={c.value_labels} defaultValue={insert ? c.default : null} invalid={!!err} describedBy={err ? `${fieldId(c.name)}-error` : undefined} />
            );
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
              ...c.enum.map((o) => ({ value: o, label: c.value_labels?.[o] ?? o, badge: c.value_labels?.[o] ? o : undefined })),
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
              <label htmlFor={fieldId(c.name)} className="da-label flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>{humanize(c.name)}</span>
                <span className="font-mono text-[11px] font-normal text-slate-400">{c.name}</span>
                {required && <span className="rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">Required</span>}
                <span className="ml-auto text-[11px] font-normal text-slate-400" title={c.link?.reason ?? undefined}>
                  {c.link ? <>Links to <span className="font-mono">{c.link.table}</span>{c.link.source && c.link.source !== "declared" ? ` · ${linkSourceText(c.link.source).toLowerCase()}` : ""}</>
                    : c.choices === "values" ? "Choice" : KIND[c.family] ?? c.type}
                  {c.max_length && ["string"].includes(c.family) && !c.choices ? ` · max ${c.max_length}` : ""}
                </span>
              </label>
              {input}
              <FieldError id={fieldId(c.name)} message={err} />
              {!err && c.comment && <p className="da-help">{c.comment}</p>}
            </div>
          );
        })}
      </div>
      {automaticNote && automatic.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Filled by the database: {automatic.map((c) => <code key={c.name} className="mx-0.5 rounded bg-white px-1">{c.name}</code>)}</span>
        </p>
      )}
    </div>
  );
};
