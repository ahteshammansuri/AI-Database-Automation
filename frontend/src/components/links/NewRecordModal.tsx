import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Lock, PlusCircle, Sparkles } from "lucide-react";
import { api } from "../../services/api";
import { FormAlert, ModalShell } from "../ui/kit";
import { RowForm, fieldId } from "../data/RowForm";
import { isEditable, type DataColumn } from "../data/types";
import { humanize, newLink, type CreateInfo, type LinkScope, type NewLink } from "./linkValue";

interface Props {
  open: boolean;
  scope: LinkScope;
  /** The linked table the new row goes into, and a friendly singular for it ("blog category"). */
  table: string;
  thing: string;
  /** Values already known (the name typed in the picker, or the new row being edited again). */
  prefill: Record<string, any>;
  onClose: () => void;
  /** The new row to add with the main row, or the id of an existing row with that name. */
  onDone: (value: NewLink | string | number) => void;
}

interface FormInfo {
  table: string;
  label_column: string | null;
  columns: DataColumn[];
  create: CreateInfo;
}

const required = (c: DataColumn) => !c.nullable && c.default === null && !c.auto;

/**
 * A new linked row entered with its details (a new user with name, email and phone), opened from a picker. Values are
 * checked on the server right away; nothing is written here: the row is added together with the row being edited
 * when that one is saved, in one transaction.
 */
export const NewRecordModal: React.FC<Props> = ({ open, scope, table, thing, prefill, onClose, onDone }) => {
  const [form, setForm] = useState<FormInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, any>>(prefill);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(prefill);
    setErrors({});
    setAlert(null);
    api.linkForm(scope, table).then((f) => setForm(f)).catch((e: any) => setLoadError(e.message || `The form for ${table} could not be loaded.`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table, scope.connectionId, scope.context]);

  const automatic = new Set(form?.create.automatic ?? []);
  const editable = (form?.columns ?? []).filter((c) => isEditable(c, true) && !automatic.has(c.name));
  const main = editable.filter((c) => c.name === form?.label_column || required(c));
  const optional = editable.filter((c) => !main.includes(c));
  const optionalFilled = optional.some((c) => values[c.name] !== undefined && values[c.name] !== "" && values[c.name] !== null);

  const submit = async () => {
    if (!form) return;
    const clean: Record<string, any> = {};
    for (const c of editable) {
      const v = values[c.name];
      if (v === undefined || (v === "" && !["string", "text"].includes(c.family))) continue;
      clean[c.name] = v;
    }
    setChecking(true);
    setErrors({});
    setAlert(null);
    try {
      const res = await api.validateLinkedRow(scope, table, clean);
      if (res.existing !== null && res.existing !== undefined) {
        onDone(res.existing);
        return;
      }
      const label = form.label_column ? String(clean[form.label_column] ?? res.label) : res.label;
      onDone(newLink(label, form.label_column, clean));
    } catch (e: any) {
      const rowErrors = e.data?.row_errors?.[0] ?? e.data?.row_errors?.["0"];
      if (rowErrors && Object.keys(rowErrors).length) {
        setErrors(rowErrors);
        if (optional.some((c) => rowErrors[c.name])) setMore(true);
        setTimeout(() => document.getElementById(fieldId(Object.keys(rowErrors)[0]))?.focus(), 50);
      } else {
        setAlert(e.message || "The values could not be checked.");
      }
    } finally {
      setChecking(false);
    }
  };

  const change = (col: string, v: any) => {
    setValues((p) => ({ ...p, [col]: v }));
    setErrors((p) => {
      const n = { ...p };
      delete n[col];
      return n;
    });
  };

  return (
    <ModalShell open={open} onClose={onClose} portal size="lg" icon={PlusCircle} title={`New ${thing}`}
      description={<>It is added to <span className="font-mono">{table}</span> together with the row you are editing, when you save that row. Nothing is written yet.</>}
      footer={
        <>
          <button type="button" onClick={onClose} className="da-btn da-btn-ghost">Cancel</button>
          <button type="button" onClick={submit} disabled={checking || !form?.create.allowed} className="da-btn da-btn-primary">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Use this new {thing}
          </button>
        </>
      }>
      {loadError ? (
        <FormAlert message={loadError} />
      ) : !form ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the form…</p>
      ) : !form.create.allowed ? (
        <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-600"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> {form.create.reason}</p>
      ) : (
        <div className="space-y-4">
          <FormAlert message={alert} onClose={() => setAlert(null)} />
          <RowForm scope={scope} table={table} insert columns={main} values={values} errors={errors} onChange={change} allowCreateLinks={false} automaticNote={false} />
          {automatic.size > 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
              Filled in for you: {[...automatic].map((c) => humanize(c)).join(", ")}.
            </p>
          )}
          {optional.length > 0 && (
            <div>
              <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more || optionalFilled}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                <span>More details <span className="font-normal text-slate-400">· {optional.length} optional</span></span>
                {more || optionalFilled ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {(more || optionalFilled) && (
                <div className="mt-3">
                  <RowForm scope={scope} table={table} insert columns={optional} values={values} errors={errors} onChange={change} allowCreateLinks={false} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
};
