import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Loader2, Pause, Play, Plus, RotateCcw, Trash2, Zap } from "lucide-react";
import { api } from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { FieldError, FormAlert } from "../ui/kit";
import { TimePicker } from "../ui/TimePicker";
import { TimezoneSelect } from "../ui/TimezoneSelect";
import { defaultTimeZone } from "../../lib/schedule";
import { serverFieldErrors } from "../../lib/validation";
import type { Autopilot } from "./types";

interface Props {
  connectionId: number;
  table: string;
  maxRows: number;
  canInsert: boolean;
  /** Undo a run's added rows (the parent refreshes the table). */
  onUndo: (changeId: number) => Promise<void>;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** Data autopilot for one table: AI sample rows added on a schedule, each run checked and undoable. */
export const AutopilotPanel: React.FC<Props> = ({ connectionId, table, maxRows, canInsert, onUndo }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<Autopilot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: `Sample ${table}`, rows_per_run: 3, frequency: "daily" as Autopilot["frequency"], every_hours: 6, run_time: "09:00", weekdays: [1] as number[], timezone: defaultTimeZone(), instructions: "" });

  const load = useCallback(async () => {
    try {
      const res = await api.autopilots(connectionId, table);
      setItems(res?.autopilots ?? []);
    } catch {
      // shown as empty
    } finally {
      setLoading(false);
    }
  }, [connectionId, table]);

  useEffect(() => {
    setLoading(true);
    setCreating(false);
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      await api.createAutopilot({ connection_id: connectionId, table_name: table, ...form, instructions: form.instructions.trim() || null,
        weekdays: form.frequency === "weekly" ? form.weekdays : null, every_hours: form.frequency === "hourly" ? form.every_hours : null, run_time: form.frequency === "hourly" ? null : form.run_time });
      toast.success("Autopilot saved", "Rows are added on the schedule you set.");
      setCreating(false);
      load();
    } catch (e: any) {
      const f = serverFieldErrors(e);
      if (Object.keys(f).length) setErrors(f);
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<any>, done: string) => {
    try {
      await fn();
      toast.success(done);
      load();
    } catch (e: any) {
      toast.error("That did not work", e.message);
    }
  };

  if (loading) return <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-slate-600">Add AI sample rows to <code className="rounded bg-slate-100 px-1">{table}</code> on a schedule. Each run is checked like any other change and can be undone for a day.</p>
        {canInsert && !creating && <button type="button" onClick={() => setCreating(true)} className="da-btn da-btn-primary da-btn-sm shrink-0"><Plus className="h-3.5 w-3.5" /> New autopilot</button>}
      </div>
      {!canInsert && <p className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"><AlertCircle className="h-4 w-4" /> This table cannot receive new rows on this connection.</p>}

      {creating && (
        <div className="space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4">
          <FormAlert message={error} onClose={() => setError(null)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ap-name" className="da-label">Name</label>
              <input id="ap-name" value={form.name} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`da-input${errors.name ? " da-input-invalid" : ""}`} aria-describedby={errors.name ? "ap-name-error" : undefined} />
              <FieldError id="ap-name" message={errors.name} />
            </div>
            <div>
              <label htmlFor="ap-rows" className="da-label">Rows each time</label>
              <input id="ap-rows" type="number" min={1} max={maxRows} value={form.rows_per_run} onChange={(e) => setForm((f) => ({ ...f, rows_per_run: Number(e.target.value) }))} className={`da-input${errors.rows_per_run ? " da-input-invalid" : ""}`} aria-describedby={errors.rows_per_run ? "ap-rows-error" : undefined} />
              <FieldError id="ap-rows" message={errors.rows_per_run} />
            </div>
          </div>
          <div>
            <span className="da-label">How often</span>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200" role="radiogroup" aria-label="How often">
              {(["hourly", "daily", "weekly"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={form.frequency === f} onClick={() => setForm((x) => ({ ...x, frequency: f }))}
                  className={`rounded-xl py-1.5 text-[13px] font-semibold capitalize transition ${form.frequency === f ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{f === "hourly" ? "Every few hours" : f}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.frequency === "hourly" ? (
              <div>
                <label htmlFor="ap-hours" className="da-label">Every</label>
                <select id="ap-hours" value={form.every_hours} onChange={(e) => setForm((f) => ({ ...f, every_hours: Number(e.target.value) }))} className="da-input cursor-pointer">
                  {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>{h === 1 ? "hour" : `${h} hours`}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <span className="da-label">At</span>
                <TimePicker value={form.run_time} onChange={(t) => setForm((f) => ({ ...f, run_time: t }))} ariaLabel="Time" invalid={!!errors.run_time} />
                <FieldError id="ap-time" message={errors.run_time} />
              </div>
            )}
            <div>
              <span className="da-label">Timezone</span>
              <TimezoneSelect value={form.timezone} onChange={(z: string) => setForm((f) => ({ ...f, timezone: z }))} />
              <FieldError id="ap-tz" message={errors.timezone} />
            </div>
          </div>
          {form.frequency === "weekly" && (
            <div>
              <span className="da-label">On</span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = form.weekdays.includes(i + 1);
                  return <button key={d} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, weekdays: on ? f.weekdays.filter((x) => x !== i + 1) : [...f.weekdays, i + 1].sort() }))}
                    className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>{d}</button>;
                })}
              </div>
              <FieldError id="ap-days" message={errors.weekdays} />
            </div>
          )}
          <div>
            <label htmlFor="ap-about" className="da-label">What the rows should be about <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea id="ap-about" rows={2} maxLength={1000} value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} className="da-input" placeholder="e.g. New arrivals for an outdoor gear shop" />
            <FieldError id="ap-about" message={errors.instructions ?? errors.table_name} />
          </div>
          <p className="text-[12px] text-slate-500">Tip: try “AI sample rows” first to see what the rows look like for this table.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="da-btn da-btn-ghost">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="da-btn da-btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Save autopilot</button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">No autopilot for this table yet.</div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((p) => (
            <li key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[14px] font-bold text-slate-900">
                    {p.name}
                    <span className={`da-chip px-2 py-0.5 text-[10.5px] ${p.is_active ? "da-chip-emerald" : "da-chip-slate"}`}>{p.is_active ? "On" : "Paused"}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">{p.rows_per_run} row{p.rows_per_run === 1 ? "" : "s"} · {p.schedule}{p.instructions ? ` · “${p.instructions.slice(0, 60)}”` : ""}</p>
                  <p className="mt-1 text-[12px] text-slate-500">Next: <span className="font-semibold text-slate-700">{p.is_active ? when(p.next_run_at) : "paused"}</span> · {p.runs_count} run{p.runs_count === 1 ? "" : "s"}, {p.rows_added} row{p.rows_added === 1 ? "" : "s"} added</p>
                  {p.last_message && (
                    <p className={`mt-1.5 flex items-start gap-1.5 text-[12px] ${p.last_status === "added" ? "text-emerald-700" : "text-rose-700"}`}>
                      {p.last_status === "added" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      <span>{when(p.last_run_at)}: {p.last_message}</span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button type="button" onClick={() => act(() => api.runAutopilot(p.id), "Run queued: rows are added in the background")} className="da-btn da-btn-secondary da-btn-sm"><Zap className="h-3.5 w-3.5" /> Run now</button>
                  <button type="button" onClick={() => act(() => api.updateAutopilot(p.id, { is_active: !p.is_active }), p.is_active ? "Paused" : "Turned on")} className="da-btn da-btn-secondary da-btn-sm">
                    {p.is_active ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Turn on</>}
                  </button>
                  {p.last_status === "added" && p.last_change_id && (
                    <button type="button" onClick={() => onUndo(p.last_change_id!).then(load)} className="da-btn da-btn-ghost da-btn-sm"><RotateCcw className="h-3.5 w-3.5" /> Undo last run</button>
                  )}
                  <button type="button" onClick={() => window.confirm(`Delete the autopilot “${p.name}”? Rows it already added stay.`) && act(() => api.deleteAutopilot(p.id), "Autopilot deleted")} className="da-btn da-btn-ghost da-btn-sm text-rose-600" aria-label={`Delete ${p.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
