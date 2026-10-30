import React, { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, GitBranch, Loader2, SearchCheck, Sparkles, XCircle } from "lucide-react";
import { api } from "../../services/api";
import type { SchemaTable } from "../../types";
import { FieldError, FormAlert, ModalShell } from "../ui/kit";
import { Select2 } from "../ui/Select2";
import { LinkSourceBadge } from "./RelationshipMap";

interface Props {
  open: boolean;
  connectionId: number;
  table: SchemaTable;
  column: string;
  all: SchemaTable[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

type Mode = "auto" | "link" | "none";

/**
 * Where one column points, as the owner decides it: what was found (automatic), a table they choose, or not a link.
 * A check against the data shows how many stored values exist in each candidate table before saving.
 */
export const LinkEditor: React.FC<Props> = ({ open, connectionId, table, column, all, onClose, onSaved }) => {
  const current = (table.relationships || []).find((r) => (r.foreign_key || r.constrained_column) === column);
  const col = (table.columns || []).find((c) => c.name === column);
  const setting = col?.link_setting ?? "auto";
  const [mode, setMode] = useState<Mode>(setting);
  const [refTable, setRefTable] = useState<string>(current?.referenced_table ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ref_table: string; verdict: string; message: string }[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(setting);
    setRefTable(current?.referenced_table ?? "");
    setError(null);
    setFieldError(null);
    setCheck(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table.name, column]);

  const declared = current?.source === "declared" || (current && !current.source);
  const targets = all.filter((t) => t.columns.some((c) => c.is_primary_key) && t.data_class !== "blocked");
  const candidates = Array.from(new Set([refTable, current?.referenced_table, ...(current?.alternatives ?? [])].filter(Boolean) as string[])).slice(0, 4);

  const runCheck = async () => {
    if (!candidates.length) return;
    setChecking(true);
    setError(null);
    try {
      setCheck((await api.checkLink(connectionId, table.name, column, candidates)).results);
    } catch (e: any) {
      setError(e.message || "The data could not be checked.");
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (mode === "link" && !refTable) {
      setFieldError("Choose the table this column points to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.setColumnLink(connectionId, table.name, column, mode === "link" ? { mode, ref_table: refTable } : { mode });
      onSaved(res.message);
    } catch (e: any) {
      const f = e.errors?.ref_table?.[0] ?? e.errors?.ref_column?.[0];
      if (f) setFieldError(f);
      setError(e.message || "The link could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const option = (value: Mode, title: string, help: React.ReactNode, icon: React.ElementType) => {
    const Icon = icon;
    const on = mode === value;
    return (
      <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${on ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 hover:border-slate-300"}`}>
        <input type="radio" name="link-mode" value={value} checked={on} onChange={() => setMode(value)} className="mt-1 accent-indigo-600" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-900"><Icon className="h-4 w-4 text-indigo-500" /> {title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-600">{help}</span>
        </span>
      </label>
    );
  };

  return (
    <ModalShell open={open} onClose={onClose} size="md" icon={GitBranch} title={<>Where does <span className="font-mono">{table.name}.{column}</span> point?</>}
      description="Every form uses this to list rows by name and to check values before saving. Nothing changes in your database."
      footer={!declared ? (
        <>
          <button type="button" onClick={onClose} className="da-btn da-btn-ghost">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="da-btn da-btn-primary">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
        </>
      ) : <button type="button" onClick={onClose} className="da-btn da-btn-primary">Close</button>}>
      <div className="space-y-3">
        <FormAlert message={error} onClose={() => setError(null)} />
        {current ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[12.5px] text-slate-600">
            <p className="flex flex-wrap items-center gap-1.5">
              Now: <span className="font-mono font-semibold text-slate-900">{current.referenced_table}.{current.referenced_column}</span> <LinkSourceBadge relation={current} />
            </p>
            {current.reason && <p className="mt-1 leading-relaxed">{current.reason}</p>}
          </div>
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[12.5px] text-slate-600">Now: <strong>not a link</strong>. {setting === "none" ? "You set this." : "No table matched the name."}</p>
        )}

        {declared ? (
          <p className="text-[12.5px] text-slate-600">The database itself declares this link (a foreign key), so it is always used and cannot be changed here.</p>
        ) : (
          <>
            {option("auto", "Automatic", "Use the link found from the column name (or none when nothing matches). Updates itself when tables change.", Sparkles)}
            {option("link", "Points to a table I choose", (
              <span className="mt-1.5 block" onClick={(e) => e.preventDefault()}>
                <Select2 id="link-ref-table" value={refTable} onChange={(v) => { setRefTable(String(v)); setMode("link"); setFieldError(null); setCheck(null); }}
                  options={targets.map((t) => ({ value: t.name, label: t.name, badge: t.name === current?.referenced_table ? "now" : current?.alternatives?.includes(t.name) ? "possible" : undefined }))}
                  placeholder="Choose a table…" invalid={!!fieldError} showSearch />
                <FieldError id="link-ref-table" message={fieldError} />
                <span className="mt-1 block text-[11.5px] text-slate-500">{column} then holds the key (id) of a row in that table.</span>
              </span>
            ), GitBranch)}
            {option("none", "Not a link", `${column} is a plain value: forms show a normal field for it.`, CircleSlash)}

            {candidates.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] text-slate-600">Not sure? Compare the values stored in {column} with each table.</p>
                  <button type="button" onClick={runCheck} disabled={checking} className="da-btn da-btn-secondary da-btn-sm">
                    {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />} Check with my data
                  </button>
                </div>
                {check && (
                  <ul className="mt-2 space-y-1 text-[12.5px]">
                    {check.map((r) => (
                      <li key={r.ref_table} className="flex items-center gap-1.5">
                        {r.verdict === "matches" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : r.verdict === "empty" ? <CircleSlash className="h-3.5 w-3.5 text-slate-400" /> : <XCircle className={`h-3.5 w-3.5 ${r.verdict === "partly" ? "text-amber-500" : "text-rose-500"}`} />}
                        <span className="font-mono text-slate-800">{r.ref_table}</span>
                        <span className="text-slate-500">{r.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
};
