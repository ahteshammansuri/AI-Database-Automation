import React, { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Link2, Loader2, PlusCircle, Save, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import { FieldError, FormAlert, ModalShell } from "../ui/kit";
import type { ChangePreview, DataColumn } from "./types";
import { DataCell } from "./DataCell";

interface Props {
  preview: ChangePreview | null;
  columns: DataColumn[];
  onClose: () => void;
  /** Called after the change was written, with the server's result (includes the change id for Undo). */
  onDone: (result: any, preview: ChangePreview) => void;
}

const show = (v: any) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** What a change will do, shown before anything is written; the customer confirms (deletes need the typed phrase). */
export const ChangeConfirmModal: React.FC<Props> = ({ preview, columns, onClose, onDone }) => {
  const [phrase, setPhrase] = useState("");
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (preview && !busy) api.dataCancel(preview.change_request_id).catch(() => {});
    setPhrase("");
    setError(null);
    setPhraseError(null);
    onClose();
  };

  const confirm = async () => {
    if (!preview) return;
    if (preview.action === "delete" && phrase.trim() !== preview.confirmation_phrase) {
      setPhraseError(`Type exactly: ${preview.confirmation_phrase}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.dataConfirm(preview.change_request_id, preview.action === "delete" ? phrase.trim() : undefined);
      setPhrase("");
      onDone(res, preview);
    } catch (e: any) {
      setError(e.message || "The change could not be written. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  if (!preview) return null;
  const rows = preview.rows ?? preview.preview_rows ?? [];
  const newParents = preview.new_parents ?? [];
  const newFor = (row: number, col: string) => newParents.find((p) => p.row === row && p.column === col);
  const editLabels = preview.action === "update" ? (preview.labels as Record<string, { before?: string | null; after?: string | null }> | undefined) : undefined;
  const shownCols = columns.filter((c) => rows.some((r) => c.name in r));
  const Icon = preview.action === "insert" ? PlusCircle : preview.action === "update" ? Save : Trash2;
  const title = preview.action === "insert" ? `Add ${preview.affected_count} row${preview.affected_count === 1 ? "" : "s"} to ${preview.table}?`
    : preview.action === "update" ? `Save this change to ${preview.table}?` : `Delete ${preview.affected_count} row${preview.affected_count === 1 ? "" : "s"} from ${preview.table}?`;

  return (
    <ModalShell
      open={!!preview}
      onClose={close}
      size={preview.action === "insert" && shownCols.length > 4 ? "xl" : "lg"}
      icon={Icon}
      tone={preview.action === "delete" ? "rose" : "indigo"}
      title={title}
      description={preview.action === "insert" ? "Nothing has been written yet. Every value below passed the table's checks."
        : preview.action === "update" ? "Only this row changes. You can undo it afterwards."
        : "This removes the row. A backup is kept so it can be restored with Undo."}
      footer={
        <>
          <button type="button" onClick={close} disabled={busy} className="da-btn da-btn-ghost">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className={`da-btn ${preview.action === "delete" ? "da-btn-danger" : "da-btn-primary"}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            {busy ? "Writing…" : preview.action === "insert" ? `Add ${preview.affected_count} row${preview.affected_count === 1 ? "" : "s"}` : preview.action === "update" ? "Save change" : "Delete"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormAlert message={error} onClose={() => setError(null)} />

        {preview.action === "insert" && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>{shownCols.map((c) => <th key={c.name} className="whitespace-nowrap px-3 py-2 font-semibold">{c.name}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    {shownCols.map((c) => {
                      const fresh = c.link ? newFor(i, c.name) : undefined;
                      return (
                        <td key={c.name} className="px-3 py-2 align-top text-slate-700">
                          {fresh ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[12px] font-semibold text-indigo-800">
                              <Sparkles className="h-3 w-3" /> {fresh.label} <span className="font-normal text-indigo-500">(new)</span>
                            </span>
                          ) : (
                            <DataCell col={c} value={r[c.name]} label={c.link && r[c.name] !== null ? (preview.labels?.[c.name]?.[String(r[c.name])] ?? undefined) : undefined} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {preview.action === "update" && preview.diff_summary && (
          <ul className="space-y-1.5">
            {Object.entries(preview.diff_summary).map(([col, d]) => {
              const column = columns.find((c) => c.name === col);
              const named = (v: any, label?: string | null) => (label ? `${label} (#${show(v)})` : column?.value_labels?.[String(v)] ? `${column.value_labels[String(v)]} (${show(v)})` : show(v));
              return (
                <li key={col} className="grid grid-cols-[minmax(0,9rem)_1fr] items-start gap-3 rounded-xl border border-slate-200 px-3 py-2 text-[13px]">
                  <span className="truncate font-mono text-[12px] font-semibold text-slate-700">{col}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-all text-slate-500 line-through decoration-rose-300">{named(d.before, editLabels?.[col]?.before)}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-all font-semibold text-emerald-700">{named(d.after, editLabels?.[col]?.after)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {newParents.length > 0 && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-[12.5px] text-indigo-950">
            <p className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-indigo-600" /> Also added first, in the same step</p>
            <ul className="mt-1.5 space-y-1">
              {newParents.map((p) => (
                <li key={p.key}>
                  A new {p.thing} <strong>{p.label}</strong> in <span className="font-mono">{p.table}</span>
                  {p.columns.length > 1 && <span className="text-indigo-800/70"> ({p.columns.map((c, i) => `${c}: ${show(p.values[i])}`).join(", ")})</span>}
                  , linked through <span className="font-mono">{p.column}</span>.
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11.5px] text-indigo-800/80">If anything fails, neither is saved. Undo removes both while nothing else uses the new row.</p>
          </div>
        )}
        {(preview.reused ?? []).length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12.5px] text-slate-700">
            {(preview.reused ?? []).map((r) => (
              <p key={`${r.row}-${r.column}`} className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-slate-400" /> “{r.label}” already exists in <span className="font-mono">{r.table}</span> (#{String(r.id)}), so that one is used.</p>
            ))}
          </div>
        )}

        {preview.action === "delete" && (
          <div className="space-y-3">
            {preview.impact_analysis && preview.impact_analysis.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Other rows point at this one</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.impact_analysis.map((i) => (
                    <li key={`${i.child_table}.${i.foreign_key_column}`}>
                      {i.dependent_row_count} row(s) in <strong>{i.child_table}</strong> ({i.foreign_key_column});{" "}
                      {i.enforced === false
                        ? "the database does not enforce this link, so they would keep pointing at a row that no longer exists. Change them first, or Undo afterwards."
                        : i.cascade_action === "CASCADE" ? "the database will delete them too." : i.cascade_action === "SET NULL" ? "the database will empty their link." : "the database will refuse the delete while they exist."}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[12.5px] text-slate-600"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No other rows point at this one.</p>
            )}
            <div>
              <label htmlFor="delete-phrase" className="da-label">Type <code className="rounded bg-slate-100 px-1">{preview.confirmation_phrase}</code> to confirm</label>
              <input id="delete-phrase" value={phrase} onChange={(e) => { setPhrase(e.target.value); setPhraseError(null); }} autoComplete="off"
                className={`da-input font-mono${phraseError ? " da-input-invalid" : ""}`} aria-invalid={!!phraseError} aria-describedby={phraseError ? "delete-phrase-error" : undefined} />
              <FieldError id="delete-phrase" message={phraseError} />
            </div>
          </div>
        )}

        {preview.dropped && preview.dropped.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] text-slate-600">
            <p className="font-semibold text-slate-800">{preview.dropped.length} proposed row{preview.dropped.length === 1 ? " was" : "s were"} left out because they failed a check:</p>
            <ul className="mt-1 space-y-0.5">
              {preview.dropped.slice(0, 6).map((d) => <li key={d.row}>Row {d.row}: {Object.entries(d.errors).map(([c, m]) => `${c}: ${m}`).join("; ")}</li>)}
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
