import React, { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Cpu, GitBranch, Image as ImageIcon, KeyRound, Link2, Lock, Settings2, Sparkles } from "lucide-react";
import { SearchableSelect } from "../common/SearchableSelect";
import { SearchableRelationshipSelect } from "../common/SearchableRelationshipSelect";
import { DatePicker } from "../ui/DatePicker";
import { TimePicker } from "../ui/TimePicker";
import { FieldPlan, Mapping, Mode, PlanColumn, explain, groupColumns, mappingFor, modeOf, modeOptions } from "./fieldPlan";
import { todayIn } from "../../lib/schedule";

interface Props {
  plan: FieldPlan;
  mappings: Record<string, Mapping>;
  onChange: (column: string, mapping: Mapping) => void;
  problems: Record<string, string>;
  connectionId: number;
  manual: boolean;
  length: string;
  format: string;
  timezone: string;
}

const KIND_LABEL: Record<string, string> = {
  title: "Title", summary: "Summary", body: "Long text", image: "Image", slug: "URL slug", meta_title: "SEO title",
  meta_description: "SEO description", keywords: "Keywords", datetime: "Date/time", enum: "Choice", boolean: "Yes/No",
  number: "Number", url: "Link", contact: "Contact", json: "JSON", text: "Text",
};

const ColumnRow: React.FC<{ col: PlanColumn } & Omit<Props, "plan" | "problems"> & { titleColumn: string | null; problem?: string }> = ({
  col, mappings, onChange, connectionId, manual, length, format, timezone, titleColumn, problem,
}) => {
  const m = mappings[col.name];
  const mode = modeOf(m, col);
  const options = modeOptions(col).filter((o) => !manual || !["AI", "AI_CREATE", "AI_REUSE"].includes(o.value));
  const setMode = (next: Mode) => onChange(col.name, mappingFor(next, col, m, titleColumn));
  const setValue = (v: any) => onChange(col.name, { ...(m ?? mappingFor("FIXED", col, undefined, titleColumn)), fixed_value: v });

  const isAi = mode === "AI" || mode === "AI_CREATE" || mode === "AI_REUSE";
  const Icon = col.relation ? Link2 : col.kind === "image" ? ImageIcon : isAi ? Cpu : Settings2;

  return (
    <div className={`rounded-xl border p-3 sm:p-4 transition ${problem ? "border-rose-300 bg-rose-50/40" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${isAi ? "text-indigo-600" : "text-slate-400"}`} />
            <span className="truncate font-mono text-xs font-bold text-slate-900">{col.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{KIND_LABEL[col.kind] ?? col.kind}</span>
            <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{col.type}</span>
            {col.required && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Required</span>}
            {col.is_unique && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Unique</span>}
            {col.relation && (
              <span className="inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                <GitBranch className="h-2.5 w-2.5" /> {col.relation.table}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className={`grid gap-2 ${needsValueEditor(mode, col) ? "sm:grid-cols-2" : ""}`}>
            <SearchableSelect
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={options.map((o) => ({ value: o.value, label: o.label }))}
              showSearch={false}
              placeholder="How is it filled?"
            />
            {needsValueEditor(mode, col) && (
              <ValueEditor col={col} mode={mode} value={m?.fixed_value} onChange={setValue} connectionId={connectionId} timezone={timezone} />
            )}
          </div>
          <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${problem ? "text-rose-700" : "text-slate-500"}`}>
            {problem ? <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> : <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-indigo-400" />}
            <span>{problem ?? explain(col, m, { titleColumn, length, format, manual })}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

function needsValueEditor(mode: Mode, col: PlanColumn) {
  return mode === "FIXED" || mode === "FIXED_REL";
}

const ValueEditor: React.FC<{ col: PlanColumn; mode: Mode; value: any; onChange: (v: any) => void; connectionId: number; timezone: string }> = ({
  col, mode, value, onChange, connectionId, timezone,
}) => {
  if (mode === "FIXED_REL" && col.relation) {
    return (
      <SearchableRelationshipSelect
        connectionId={connectionId}
        targetTable={col.relation.table}
        value={value ?? null}
        onChange={(v) => onChange(v)}
        placeholder={`Search ${col.relation.table}…`}
      />
    );
  }
  if (col.kind === "enum") {
    return (
      <SearchableSelect
        value={value ?? col.enum_values[0]}
        onChange={(v) => onChange(String(v))}
        options={col.enum_values.map((v) => ({ value: v, label: v }))}
        showSearch={col.enum_values.length > 6}
      />
    );
  }
  if (col.kind === "boolean") {
    const on = Number(value) === 1;
    return (
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={col.name}>
        {[{ v: 1, l: "Yes / On" }, { v: 0, l: "No / Off" }].map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={(o.v === 1) === on}
            onClick={() => onChange(o.v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${(o.v === 1) === on ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    );
  }
  if (col.kind === "datetime") {
    const [d, t] = String(value || "").split(/[ T]/);
    const today = todayIn(timezone);
    return (
      <div className="grid grid-cols-2 gap-2">
        <DatePicker value={d || null} today={today} onChange={(nd) => onChange(nd ? `${nd} ${(t || "09:00").slice(0, 5)}:00` : "")} ariaLabel={`${col.name} date`} />
        <TimePicker value={(t || "09:00").slice(0, 5)} onChange={(nt) => onChange(`${d || today} ${nt}:00`)} ariaLabel={`${col.name} time`} />
      </div>
    );
  }
  const isNumber = col.kind === "number";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type={isNumber ? "number" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(isNumber ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        maxLength={col.max_length ?? undefined}
        placeholder={col.kind === "image" ? "https://…" : "Value"}
        aria-label={`${col.name} value`}
        className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      {col.kind === "image" && /^https?:\/\//.test(String(value || "")) && (
        <img src={String(value)} alt="" className="h-9 w-14 shrink-0 rounded-lg border border-slate-200 object-cover" />
      )}
    </div>
  );
};

export const FieldMappingStep: React.FC<Props> = (props) => {
  const { plan, mappings, problems } = props;
  const groups = groupColumns(plan, mappings);
  const [showOther, setShowOther] = useState(Object.keys(problems).some((c) => groups.other.some((o) => o.name === c)));
  const titleColumn = plan.title_column;

  const aiCount = plan.columns.filter((c) => ["AI", "AI_CREATE", "AI_REUSE"].includes(modeOf(mappings[c.name], c)) && !c.is_secret).length;
  const imageCount = plan.columns.filter((c) => c.kind === "image" && modeOf(mappings[c.name], c) === "AI").length;
  const parentCreates = groups.relations.filter((c) => modeOf(mappings[c.name], c) === "AI_CREATE");
  const otherProblems = groups.other.filter((c) => problems[c.name]).length;

  const row = (c: PlanColumn) => <ColumnRow key={c.name} col={c} {...props} titleColumn={titleColumn} problem={problems[c.name]} />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Columns filled", String(plan.columns.filter((c) => !c.is_secret && !["EMPTY", "DEFAULT"].includes(modeOf(mappings[c.name], c))).length)],
          ["Written by AI", String(aiCount)],
          ["Images", String(imageCount)],
          ["Linked tables", String(groups.relations.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</span>
            <span className="text-base font-extrabold text-slate-900">{v}</span>
          </div>
        ))}
      </div>

      {groups.content.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-800">Content</h4>
          {groups.content.map(row)}
        </section>
      )}

      {groups.relations.length > 0 && (
        <section className="space-y-2">
          <div>
            <h4 className="text-xs font-bold text-slate-800">Linked records (foreign keys)</h4>
            <p className="mt-0.5 text-[11px] text-slate-500">
              These columns point at rows in other tables. Each run fills them in the right order: any new parent row
              {parentCreates.length > 0 ? ` (${parentCreates.map((c) => c.relation!.table).join(", ")})` : ""} is created first, then the new {plan.table} row stores its id.
              Protected tables such as users are only ever linked, never created.
            </p>
          </div>
          {groups.relations.map(row)}
        </section>
      )}

      {groups.other.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowOther((s) => !s)}
            aria-expanded={showOther}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-left"
          >
            <span className="text-xs font-bold text-slate-800">
              Other columns ({groups.other.length})
              <span className="ml-1 font-normal text-slate-500">
                {otherProblems > 0 ? `· ${otherProblems} need${otherProblems === 1 ? "s" : ""} attention` : "· filled automatically with safe defaults"}
              </span>
            </span>
            {showOther ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </button>
          {(showOther || otherProblems > 0) && groups.other.map(row)}
        </section>
      )}

      {groups.secret.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Protected columns are never written: {groups.secret.map((c) => <code key={c.name} className="mx-0.5 rounded bg-white px-1">{c.name}</code>)}
          </span>
        </p>
      )}
      {plan.primary_key && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <KeyRound className="h-3 w-3" /> <code>{plan.primary_key}</code> is assigned by the database.
        </p>
      )}
    </div>
  );
};
