import React, { useEffect, useState } from "react";
import { ListFilter, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import { FormAlert, ModalShell } from "../ui/kit";

interface Props {
  open: boolean;
  connectionId: number;
  table: string;
  column: string;
  onClose: () => void;
  onSaved: (labels: Record<string, string>, message: string) => void;
}

interface Row { value: string; count: number | null; label: string }

/**
 * Names for the values a status-like column stores (1 = Published, 0 = Draft): every form then offers the names, and
 * tables and previews show them. Values in use are listed with how many rows hold each; others can be added.
 */
export const ValueNamesEditor: React.FC<Props> = ({ open, connectionId, table, column, onClose, onSaved }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    api.columnValues({ connectionId, context: "publish" }, table, column)
      .then((res) => setRows(res.values.map((v) => ({ value: String(v.value), count: v.count, label: v.label ?? "" }))))
      .catch((e: any) => { setRows([]); setError(e.message || "The values in use could not be read."); });
  }, [open, connectionId, table, column]);

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    setError(null);
    try {
      const labels = Object.fromEntries(rows.filter((r) => r.label.trim()).map((r) => [r.value, r.label.trim()]));
      const res = await api.setValueLabels(connectionId, table, column, labels);
      onSaved(res.labels ?? labels, res.message);
    } catch (e: any) {
      setError(e.message || "The names could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const v = newValue.trim();
    if (!v || !rows || rows.some((r) => r.value === v)) return;
    setRows([...rows, { value: v, count: 0, label: "" }]);
    setNewValue("");
  };

  return (
    <ModalShell open={open} onClose={onClose} size="md" icon={ListFilter} title={<>Name the values of <span className="font-mono">{table}.{column}</span></>}
      description="Forms then offer these names instead of bare values, and tables show them. The stored values do not change."
      footer={
        <>
          <button type="button" onClick={onClose} className="da-btn da-btn-ghost">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !rows} className="da-btn da-btn-primary">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save names</button>
        </>
      }>
      <div className="space-y-3">
        <FormAlert message={error} onClose={() => setError(null)} />
        {!rows ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the values in use…</p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-[13px] text-slate-500">No values stored yet. Add the values this column can hold.</p>}
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {rows.map((r, i) => (
                <li key={r.value} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px] font-semibold text-slate-900">{r.value}</span>
                    <span className="text-[11px] text-slate-400">{r.count === null ? "" : r.count === 0 ? "not used yet" : `${r.count.toLocaleString()} row${r.count === 1 ? "" : "s"}`}</span>
                  </span>
                  <input value={r.label} maxLength={60} placeholder="Name, e.g. Published" aria-label={`Name for ${r.value}`}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="da-input py-1.5 text-[13px]" />
                  {r.count === 0 ? (
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="da-icon-btn h-8 w-8" aria-label={`Remove ${r.value}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  ) : <span className="w-8" />}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
                placeholder="Another value, e.g. 2" aria-label="Another value" maxLength={64} className="da-input flex-1 py-1.5 text-[13px]" />
              <button type="button" onClick={add} className="da-btn da-btn-secondary da-btn-sm"><Plus className="h-3.5 w-3.5" /> Add value</button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
};
