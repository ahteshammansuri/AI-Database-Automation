import React, { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api, type ProgressEvent } from "../../services/api";
import { FieldError, FormAlert, ModalShell } from "../ui/kit";
import { WorkProgress, type StepStatus } from "../ui/WorkProgress";
import type { ChangePreview } from "./types";

interface Props {
  open: boolean;
  connectionId: number;
  table: string;
  maxRows: number;
  onClose: () => void;
  /** Valid rows are ready: the parent shows them for confirmation. */
  onReady: (preview: ChangePreview) => void;
}

const STEPS = [
  { key: "rules", label: "Read the table's columns and linked records" },
  { key: "write", label: "Your writing model creates the rows" },
  { key: "check", label: "Check every value (types, lengths, unique values, links)" },
];

/** AI sample rows: ask the customer's writing model for rows, check each one, then show them for confirmation. */
export const SampleRowsModal: React.FC<Props> = ({ open, connectionId, table, maxRows, onClose, onReady }) => {
  const [count, setCount] = useState(5);
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    if (!Number.isInteger(count) || count < 1 || count > maxRows) {
      setCountError(`Choose 1 to ${maxRows} rows.`);
      return;
    }
    setBusy(true);
    setError(null);
    setEvents([]);
    try {
      const res = await api.dataSampleRowsStream(connectionId, table, count, about.trim(), (e) => setEvents((p) => [...p, e]));
      onReady(res as ChangePreview);
    } catch (e: any) {
      const dropped = e.data?.dropped?.length ? ` ${e.data.dropped.length} proposed row(s) failed the checks.` : "";
      setError((e.message || "Sample rows could not be created.") + dropped);
    } finally {
      setBusy(false);
    }
  };

  const has = (s: string) => events.some((e) => e.stage === s);
  const status: Record<string, StepStatus> = {
    rules: has("RULES_READ") ? "done" : busy ? "active" : error ? "failed" : "pending",
    write: has("GENERATED") ? "done" : has("RULES_READ") ? (busy ? "active" : error ? "failed" : "pending") : "pending",
    check: has("VALIDATED") ? "done" : has("GENERATED") ? (busy ? "active" : error ? "failed" : "pending") : "pending",
  };
  const detail = (s: string) => events.find((e) => e.stage === s)?.message ?? null;

  return (
    <ModalShell
      open={open}
      onClose={() => !busy && onClose()}
      size="md"
      icon={Sparkles}
      title={`AI sample rows for ${table}`}
      description="Realistic rows written by your “Writing content” model. You see them before anything is added."
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="da-btn da-btn-ghost">Close</button>
          <button type="button" onClick={run} disabled={busy} className="da-btn da-btn-accent">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? "Creating…" : "Create rows"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormAlert message={error} onClose={() => setError(null)} />
        {busy || events.length ? (
          <WorkProgress
            title="Creating sample rows"
            steps={[
              { ...STEPS[0], detail: detail("RULES_READ") },
              { ...STEPS[1], detail: detail("GENERATED") ?? detail("GENERATING") },
              { ...STEPS[2], detail: detail("VALIDATED") },
            ]}
            status={status}
            seconds={seconds}
            latest={events.length ? events[events.length - 1].message : "Starting…"}
            hint="On a local model this usually takes 20 seconds to 2 minutes."
          />
        ) : null}
        {!busy && (
          <>
            <div>
              <label htmlFor="sample-count" className="da-label">How many rows</label>
              <div className="flex items-center gap-3">
                <input type="range" min={1} max={maxRows} value={count} onChange={(e) => { setCount(Number(e.target.value)); setCountError(null); }} className="flex-1 accent-indigo-600" aria-label="Rows" />
                <input id="sample-count" type="number" min={1} max={maxRows} value={count} onChange={(e) => { setCount(Number(e.target.value)); setCountError(null); }}
                  className={`da-input w-20 text-center${countError ? " da-input-invalid" : ""}`} aria-invalid={!!countError} aria-describedby={countError ? "sample-count-error" : undefined} />
              </div>
              <FieldError id="sample-count" message={countError} />
            </div>
            <div>
              <label htmlFor="sample-about" className="da-label">What should they be about? <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea id="sample-about" rows={2} maxLength={1000} value={about} onChange={(e) => setAbout(e.target.value)}
                placeholder="e.g. Summer fashion accessories priced between 15 and 80" className="da-input" />
              <p className="da-help">Linked columns use rows that already exist (for example an existing category).</p>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
};
