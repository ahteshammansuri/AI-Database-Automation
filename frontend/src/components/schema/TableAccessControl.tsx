import React, { useState } from "react";
import { Eye, Loader2, PencilLine, ShieldAlert } from "lucide-react";
import { api } from "../../services/api";
import { FormAlert, ModalShell } from "../ui/kit";

interface Props {
  connectionId: number;
  table: string;
  /** Current class on this connection and the class without the owner's override. */
  dataClass: string;
  defaultClass: string;
  connectionMode?: string | null;
  onChanged: (dataClass: string) => void;
}

const LABEL: Record<string, string> = { read_only: "View only", writable: "Editable" };

/**
 * The connection owner chooses whether this table's rows may be changed (Data page and automations), or goes back
 * to the default. Unlocking a table that is view only by default (orders, payments, permissions, audit) asks first.
 */
export const TableAccessControl: React.FC<Props> = ({ connectionId, table, dataClass, defaultClass, connectionMode, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const save = async (access: "read_only" | "writable" | "default") => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setTableAccess(connectionId, table, access);
      onChanged(res.data_class);
      setConfirmUnlock(false);
    } catch (e: any) {
      setError(e.message || "The access could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const choose = (access: "read_only" | "writable") => {
    if (access === dataClass) return;
    if (access === "writable" && defaultClass === "read_only") {
      setConfirmUnlock(true);
      return;
    }
    void save(access === defaultClass ? "default" : access);
  };

  const overridden = dataClass !== defaultClass;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-800">Rows of this table on this connection</p>
          <p className="text-[12px] text-slate-500">
            Default: {LABEL[defaultClass] ?? defaultClass}
            {defaultClass === "read_only" && " (financial, order, permission or audit data)"}
            {overridden && <> · <button type="button" onClick={() => save("default")} disabled={busy} className="font-semibold text-indigo-600 hover:underline disabled:opacity-50">Back to default</button></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" aria-label="Saving" />}
          <div className="da-tabs" role="radiogroup" aria-label={`Access to ${table}`}>
            {(["read_only", "writable"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={dataClass === k} disabled={busy} onClick={() => choose(k)}
                className={`da-tab ${dataClass === k ? "da-tab-active" : ""}`}>
                {k === "read_only" ? <Eye className="h-3.5 w-3.5" /> : <PencilLine className="h-3.5 w-3.5" />} {LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {dataClass === "writable" && connectionMode === "read_only" && (
        <p className="mt-2 text-[12px] text-amber-700">The connection itself is read-only, so nothing is written until you change its access mode on the Connections page.</p>
      )}
      <FormAlert message={error} onClose={() => setError(null)} />

      <ModalShell
        open={confirmUnlock}
        onClose={() => !busy && setConfirmUnlock(false)}
        size="sm"
        icon={ShieldAlert}
        tone="amber"
        title={`Allow changes to ${table}?`}
        description="This table holds data that is view only by default."
        footer={
          <>
            <button type="button" onClick={() => setConfirmUnlock(false)} disabled={busy} className="da-btn da-btn-ghost">Keep view only</button>
            <button type="button" onClick={() => save("writable")} disabled={busy} className="da-btn da-btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />} Allow changes
            </button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
          <li>Rows can then be added and edited on the Data page, each change previewed and confirmed first.</li>
          <li>Deleting still needs the connection's delete mode, a typed confirmation and a backup.</li>
          <li>Secret columns stay hidden and are never written. The change is recorded in your audit log.</li>
        </ul>
      </ModalShell>
    </div>
  );
};
