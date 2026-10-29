import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Clock, Mail, Repeat, Send, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { api } from "../../services/api";
import { DatePicker } from "../ui/DatePicker";
import { TimePicker } from "../ui/TimePicker";
import { TimezoneSelect } from "../ui/TimezoneSelect";
import { CalendarMonth, DayMarker } from "../ui/CalendarMonth";
import { FieldError } from "../ui/kit";
import { ariaFor, invalid } from "../../lib/validation";
import { usePlatform } from "../../context/PlatformContext";
import {
  WEEKDAYS, addDays, addMinutesHHMM, daysBetween, formatDateShort, formatGap, formatInstant,
  formatTime12, gapMinutes, isoWeekday, monthMatrix, publishesNextDay, relativeFromNow, runDates, todayIn,
} from "../../lib/schedule";

export type Frequency = "ONE_TIME" | "DAILY" | "WEEKLY";

export interface ScheduleConfig {
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  weekly_days: number[];
  timezone: string;
  generation_time: string;
  publication_time: string;
}

export interface ApprovalConfig {
  require_approval: boolean;
  reviewer_email: string;
  timeout_policy: "KEEP_DRAFT" | "AUTO_PUBLISH_LATEST" | "CANCEL";
}

interface Props {
  schedule: ScheduleConfig;
  onScheduleChange: (next: ScheduleConfig) => void;
  approval: ApprovalConfig;
  onApprovalChange: (next: ApprovalConfig) => void;
  userEmail?: string;
  targetTable: string;
  excludeAutomationId?: number;
  /** Reports whether the server accepted the schedule (used to enable Next). */
  onValidity?: (valid: boolean, errors: Record<string, string>) => void;
  /** Messages from the parent (checks on Next/Save, or the server's 422), shown under the matching field. */
  fieldErrors?: Record<string, string>;
  /** The parent clears its message for a field once the user changes it. */
  onFieldEdited?: (field: string) => void;
}

/** Fields that show their own message; anything else is listed in the summary box. */
const INLINE_FIELDS = ["timezone", "start_date", "end_date", "weekly_days", "generation_time", "publication_time", "reviewer_email"];

const POLICIES = [
  { value: "KEEP_DRAFT" as const, title: "Keep it as a draft", text: "Nothing is published and the run stops. The draft stays in the run history." },
  { value: "AUTO_PUBLISH_LATEST" as const, title: "Publish it anyway", text: "The latest version is published at the scheduled time if nobody rejected it." },
  { value: "CANCEL" as const, title: "Cancel the run", text: "The run stops and nothing is written." },
];

const END_PRESETS = [3, 7, 14, 30];

export const ScheduleStep: React.FC<Props> = ({
  schedule, onScheduleChange, approval, onApprovalChange, userEmail, targetTable, excludeAutomationId, onValidity, fieldErrors, onFieldEdited,
}) => {
  const minGap = usePlatform().config.automation.min_gap_minutes;
  const s = schedule;
  const today = todayIn(s.timezone);
  const set = (patch: Partial<ScheduleConfig>) => {
    Object.keys(patch).forEach((k) => onFieldEdited?.(k));
    onScheduleChange({ ...s, ...patch });
  };

  const gap = gapMinutes(s.generation_time, s.publication_time);
  const gapError = gap === null ? "Choose both times." : gap === 0 ? "Publication must be after generation." : gap < minGap ? `Publication must be at least ${minGap} minutes after generation (now ${gap} min).` : null;

  // Server-side validation and summary (debounced)
  const [server, setServer] = useState<{ valid: boolean; errors: Record<string, string>; summary: any; occurrences: any[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.previewSchedule({
          schedule_type: s.frequency,
          start_date: s.start_date,
          end_date: s.frequency === "ONE_TIME" ? null : s.end_date,
          weekly_days: s.frequency === "WEEKLY" ? s.weekly_days : [],
          generation_time: s.generation_time,
          publication_time: s.publication_time,
          timezone: s.timezone,
        });
        if (id === seq.current) setServer(res);
      } catch (e: any) {
        if (id === seq.current) setServer({ valid: false, errors: { schedule: e.message }, summary: null, occurrences: [] });
      } finally {
        if (id === seq.current) setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [s.frequency, s.start_date, s.end_date, s.weekly_days.join(","), s.generation_time, s.publication_time, s.timezone]);

  useEffect(() => {
    if (server) onValidity?.(server.valid && !gapError, server.errors ?? {});
  }, [server, gapError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calendar: this schedule's run days + other activity
  const [calMonth, setCalMonth] = useState(s.start_date.slice(0, 7) + "-01");
  const [occupancy, setOccupancy] = useState<Record<string, any[]>>({});
  const [focusDay, setFocusDay] = useState<string | null>(null);
  useEffect(() => setCalMonth(s.start_date.slice(0, 7) + "-01"), [s.start_date]);
  useEffect(() => {
    const [y, m] = calMonth.split("-").map(Number);
    const weeks = monthMatrix(y, m - 1);
    const from = weeks[0][0].date;
    const to = weeks[5][6].date;
    let cancelled = false;
    api.getScheduleOccupancy(from, to, s.timezone, excludeAutomationId)
      .then((res) => !cancelled && setOccupancy(res?.days ?? {}))
      .catch(() => !cancelled && setOccupancy({}));
    return () => { cancelled = true; };
  }, [calMonth, s.timezone, excludeAutomationId]);

  const runDays = useMemo(() => {
    const fromServer = (server?.occurrences ?? []).map((o: any) => o.run_date);
    const list = fromServer.length ? fromServer : runDates(s.frequency, s.start_date, s.frequency === "ONE_TIME" ? null : s.end_date, s.weekly_days, 120);
    return new Set<string>(list);
  }, [server, s.frequency, s.start_date, s.end_date, s.weekly_days]);

  const markers = useMemo(() => {
    const out: Record<string, DayMarker[]> = {};
    for (const [day, items] of Object.entries(occupancy)) {
      out[day] = (items as any[]).map((it) => ({
        tone: it.type === "published" ? "emerald" : it.type === "automation" ? "amber" : "slate",
        title: `${it.name}${it.publication_local ? ` · publishes ${formatTime12(it.publication_local)}` : ""}`,
      }));
    }
    return out;
  }, [occupancy]);

  const startMarkers = markers; // same markers inside the date pickers
  const sameTimeConflicts = useMemo(() => {
    const out: string[] = [];
    for (const d of runDays) {
      for (const it of occupancy[d] ?? []) {
        if (it.publication_local === s.publication_time) out.push(`${formatDateShort(d)}: “${it.name}” also publishes at ${formatTime12(s.publication_time)}`);
      }
    }
    return out.slice(0, 3);
  }, [runDays, occupancy, s.publication_time]);

  const setGeneration = (t: string) => {
    const g = gapMinutes(t, s.publication_time);
    set({ generation_time: t, publication_time: g === null || g < minGap ? addMinutesHHMM(t, Math.max(30, minGap)) : s.publication_time });
  };

  const setFrequency = (f: Frequency) => {
    const patch: Partial<ScheduleConfig> = { frequency: f };
    if (f === "WEEKLY" && s.weekly_days.length === 0) patch.weekly_days = [isoWeekday(s.start_date)];
    if (f === "ONE_TIME") patch.end_date = null;
    set(patch);
  };

  const summary = server?.summary;
  const errors: Record<string, string> = { ...(server?.errors ?? {}), ...(fieldErrors ?? {}) };
  const otherErrors = Object.entries(errors).filter(([k]) => !INLINE_FIELDS.includes(k)).map(([, v]) => v);
  const publicationError = gapError ?? errors.publication_time ?? null;
  const endPreset = s.end_date ? daysBetween(s.start_date, s.end_date) + 1 : null;

  return (
    <div className="space-y-5">
      {/* Frequency */}
      <div>
        <label className="da-label">How often should it run?</label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Frequency">
          {[
            { v: "ONE_TIME" as const, l: "One time", d: "Runs once, then stops", icon: Send },
            { v: "DAILY" as const, l: "Daily", d: "Every day in a date range", icon: Repeat },
            { v: "WEEKLY" as const, l: "Weekly", d: "On the days you pick", icon: CalendarDays },
          ].map((o) => {
            const active = s.frequency === o.v;
            const Icon = o.icon;
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFrequency(o.v)}
                className={`rounded-xl border p-2.5 text-left transition sm:p-3 ${active ? "border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/15" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                <Icon className={`mb-1 h-4 w-4 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                <span className="block text-xs font-bold text-slate-900">{o.l}</span>
                <span className="hidden text-[11px] text-slate-500 sm:block">{o.d}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dates + timezone */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="da-label">Timezone</label>
          <TimezoneSelect value={s.timezone} onChange={(tz) => set({ timezone: tz })} />
          <FieldError id="schedule-timezone" message={errors.timezone} />
          {!errors.timezone && <p className="mt-1 text-[11px] text-slate-400">All dates and times below are in this timezone.</p>}
        </div>
        <div>
          <label className="da-label">{s.frequency === "ONE_TIME" ? "Run date" : "Start date"}</label>
          <DatePicker
            value={s.start_date}
            onChange={(d) => d && set({ start_date: d, end_date: s.end_date && s.end_date < d ? d : s.end_date })}
            today={today}
            min={today}
            markers={startMarkers}
            runDays={runDays}
            invalid={!!errors.start_date}
            ariaLabel={s.frequency === "ONE_TIME" ? "Run date" : "Start date"}
          />
          <FieldError id="schedule-start" message={errors.start_date} />
        </div>
        {s.frequency !== "ONE_TIME" && (
          <div>
            <label className="da-label">Run until</label>
            <DatePicker
              value={s.end_date}
              onChange={(d) => set({ end_date: d })}
              today={today}
              min={s.start_date}
              clearable
              placeholder="No end date"
              rangeStart={s.start_date}
              rangeEnd={s.end_date}
              runDays={runDays}
              markers={startMarkers}
              invalid={!!errors.end_date}
              ariaLabel="End date"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {END_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set({ end_date: addDays(s.start_date, n - 1) })}
                  className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${endPreset === n ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"}`}
                >
                  {n} days
                </button>
              ))}
              <button
                type="button"
                onClick={() => set({ end_date: null })}
                className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${s.end_date === null ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"}`}
              >
                No end
              </button>
            </div>
            <FieldError id="schedule-end" message={errors.end_date} />
          </div>
        )}
      </div>

      {s.frequency === "WEEKLY" && (
        <div>
          <label className="da-label">On these days</label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((w) => {
              const on = s.weekly_days.includes(w.iso);
              return (
                <button
                  key={w.iso}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? s.weekly_days.filter((d) => d !== w.iso) : [...s.weekly_days, w.iso].sort();
                    set({ weekly_days: next.length ? next : s.weekly_days });
                  }}
                  className={`h-9 min-w-[3rem] rounded-xl border px-2 text-xs font-bold transition ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300"}`}
                >
                  {w.short}
                </button>
              );
            })}
          </div>
          <FieldError id="schedule-weekdays" message={errors.weekly_days} />
        </div>
      )}

      {/* Times */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="da-label flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Content is generated at
          </label>
          <TimePicker value={s.generation_time} onChange={setGeneration} invalid={!!errors.generation_time} ariaLabel="Generation time" />
          <FieldError id="schedule-generation" message={errors.generation_time} />
          {!errors.generation_time && <p className="mt-1 text-[11px] text-slate-400">Runs in the background; your browser can be closed.</p>}
        </div>
        <div>
          <label className="da-label flex items-center gap-1.5">
            <Send className="h-3.5 w-3.5 text-emerald-600" /> Published to the database at
          </label>
          <TimePicker
            value={s.publication_time}
            onChange={(t) => set({ publication_time: t })}
            invalid={!!publicationError}
            ariaLabel="Publication time"
            quickOptions={[15, 30, 60, 120].map((m) => ({ label: `+${formatGap(m)}`, value: addMinutesHHMM(s.generation_time, m) }))}
            hint={`Must be at least ${minGap} minutes after generation.`}
          />
          <FieldError id="schedule-publication" message={publicationError} />
          {!publicationError && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Timer className="h-3 w-3" />
              {`${formatGap(gap)} after generation${publishesNextDay(s.generation_time, s.publication_time) ? " (the next day)" : ""}${approval.require_approval ? ", which is the time your reviewer has to decide" : ""}.`}
            </p>
          )}
        </div>
      </div>

      {/* Calendar */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div>
          <CalendarMonth
            month={calMonth}
            onMonthChange={setCalMonth}
            today={today}
            selected={focusDay}
            runDays={runDays}
            markers={markers}
            rangeStart={s.frequency === "ONE_TIME" ? null : s.start_date}
            rangeEnd={s.frequency === "ONE_TIME" ? null : s.end_date}
            onSelect={setFocusDay}
            label="Schedule calendar"
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-indigo-100 ring-1 ring-indigo-300" /> This automation</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Other automations</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Scheduled posts</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Published</span>
          </div>
        </div>
        <div className="min-w-0 text-xs">
          {focusDay ? (
            <div className="space-y-2">
              <h5 className="font-bold text-slate-900">{formatDateShort(focusDay)}</h5>
              {runDays.has(focusDay) && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-indigo-900">
                  <span className="font-semibold">This automation:</span> generates {formatTime12(s.generation_time)}, publishes {formatTime12(s.publication_time)}
                </div>
              )}
              {(occupancy[focusDay] ?? []).map((it: any, i: number) => (
                <div key={i} className="rounded-lg border border-slate-200 px-2.5 py-2">
                  <span className="font-semibold text-slate-800">{it.name}</span>
                  <span className="text-slate-500"> · {it.type === "published" ? "published" : "publishes"} {formatTime12(it.publication_local)}{it.target_table ? ` into ${it.target_table}` : ""}</span>
                </div>
              ))}
              {!runDays.has(focusDay) && !(occupancy[focusDay] ?? []).length && <p className="text-slate-500">Nothing is scheduled on this day.</p>}
            </div>
          ) : (
            <p className="text-slate-500">Select a day to see everything scheduled on it. Highlighted days are when this automation runs; dots show your other automations and posts.</p>
          )}
          {sameTimeConflicts.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
              <p className="font-semibold">Same publication time as another automation:</p>
              <ul className="mt-1 list-disc pl-4">{sameTimeConflicts.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="mt-1 text-amber-800">This is allowed; consider spacing them out if they target the same site.</p>
            </div>
          )}
        </div>
      </div>

      {/* Approval */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-indigo-600" /> Email me to approve before publishing</span>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {approval.require_approval
                ? "Right after generation, a review email with the full preview and exactly what will be written is sent. Approve or request changes with one click."
                : "Valid content is published automatically at the publication time, without review."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={approval.require_approval}
            aria-label="Require email approval"
            onClick={() => onApprovalChange({ ...approval, require_approval: !approval.require_approval })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${approval.require_approval ? "bg-indigo-600" : "bg-slate-300"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${approval.require_approval ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </div>
        {approval.require_approval && (
          <div className="grid gap-3 border-t border-slate-200 pt-3 md:grid-cols-2">
            <div>
              <label className="da-label flex items-center gap-1.5" htmlFor="reviewer-email"><Mail className="h-3.5 w-3.5" /> Send the review email to</label>
              <input
                id="reviewer-email"
                type="email"
                value={approval.reviewer_email || ""}
                placeholder={userEmail || "editor@example.com"}
                onChange={(e) => { onFieldEdited?.("reviewer_email"); onApprovalChange({ ...approval, reviewer_email: e.target.value }); }}
                className={`da-input${invalid(errors.reviewer_email)}`}
                {...ariaFor("reviewer-email", errors.reviewer_email)}
              />
              <FieldError id="reviewer-email" message={errors.reviewer_email} />
              {!errors.reviewer_email && <p className="mt-1 text-[11px] text-slate-400">Leave empty to use {userEmail || "your account email"}.</p>}
            </div>
            <div>
              <span className="da-label">If nobody decides by the publication time</span>
              <div className="space-y-1.5" role="radiogroup" aria-label="No-response policy">
                {POLICIES.map((p) => (
                  <label key={p.value} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition ${approval.timeout_policy === p.value ? "border-indigo-300 bg-white" : "border-transparent hover:bg-white"}`}>
                    <input
                      type="radio"
                      name="timeout_policy"
                      checked={approval.timeout_policy === p.value}
                      onChange={() => onApprovalChange({ ...approval, timeout_policy: p.value })}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-slate-800">{p.title}</span>
                      <span className="block text-[11px] text-slate-500">{p.text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className={`rounded-2xl border p-3 sm:p-4 ${server && !server.valid ? "border-rose-200 bg-rose-50/60" : "border-indigo-200 bg-indigo-50/60"}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-indigo-950"><CalendarDays className="h-4 w-4 text-indigo-600" /> Schedule summary</h4>
          {checking && <span className="text-[10px] text-slate-400">Checking…</span>}
        </div>
        {server && !server.valid ? (
          <ul className="space-y-1 text-xs text-rose-800">
            {otherErrors.length
              ? otherErrors.map((e) => <li key={String(e)} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{String(e)}</li>)
              : <li className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Fix the fields marked in red above to see the schedule.</li>}
          </ul>
        ) : summary ? (
          <div className="space-y-3 text-xs text-slate-700">
            <p className="leading-relaxed">{summary.description}</p>
            {summary.next_run && (
              <div className="rounded-xl bg-white p-3 shadow-2xs">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {s.frequency === "ONE_TIME" ? "The run" : "Next run"} · {relativeFromNow(summary.next_run.generation_at)}
                  {summary.total_runs ? ` · ${summary.total_runs} run${summary.total_runs === 1 ? "" : "s"} in total` : " · repeats with no end date"}
                </p>
                <ol className="mt-2 space-y-1.5">
                  <li className="flex gap-2"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" /><span><strong>{formatInstant(summary.next_run.generation_at, s.timezone)}</strong>: AI writes the content{targetTable ? ` for “${targetTable}”` : ""}, picks or creates linked records, and creates images.</span></li>
                  {approval.require_approval && (
                    <li className="flex gap-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" /><span>A review email goes to <strong>{approval.reviewer_email || userEmail || "you"}</strong> with the full preview and write plan.</span></li>
                  )}
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span><strong>{formatInstant(summary.next_run.publication_at, s.timezone)}</strong>: {approval.require_approval ? "if approved, " : ""}it is written to the database in one transaction{approval.require_approval ? `; otherwise ${POLICIES.find((p) => p.value === approval.timeout_policy)!.title.toLowerCase()}` : ""}.</span></li>
                </ol>
              </div>
            )}
            {summary.upcoming?.length > 1 && (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Upcoming</p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {summary.upcoming.slice(0, 6).map((o: any) => (
                    <li key={o.run_date} className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-[11px]">
                      <span className="font-semibold text-slate-800">{formatDateShort(o.run_date)}</span>
                      <ArrowRight className="h-3 w-3 text-slate-300" />
                      <span className="text-slate-500">{formatTime12(s.publication_time)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Checking the schedule…</p>
        )}
      </div>
    </div>
  );
};
