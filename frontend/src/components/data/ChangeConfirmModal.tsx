import React, { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, PlusCircle, Save, Trash2 } from "lucide-react";
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
                  <tr key={i}>{shownCols.map((c) => <td key={c.name} className="px-3 py-2 align-top text-slate-700"><DataCell col={c} value={r[c.name]} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {preview.action === "update" && preview.diff_summary && (
          <ul className="space-y-1.5">
            {Object.entries(preview.diff_summary).map(([col, d]) => (
              <li key={col} className="grid grid-cols-[minmax(0,9rem)_1fr] items-start gap-3 rounded-xl border border-slate-200 px-3 py-2 text-[13px]">
                <span className="truncate font-mono text-[12px] font-semibold text-slate-700">{col}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-all text-slate-500 line-through decoration-rose-300">{show(d.before)}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="break-all font-semibold text-emerald-700">{show(d.after)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {preview.action === "delete" && (
          <div className="space-y-3">
            {preview.impact_analysis && preview.impact_analysis.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Other rows point at this one</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.impact_analysis.map((i) => <li key={i.child_table}>{i.dependent_row_count} row(s) in <strong>{i.child_table}</strong> ({i.foreign_key_column}); the database will {i.cascade_action === "CASCADE" ? "delete them too" : "refuse the delete if they still exist"}.</li>)}
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
