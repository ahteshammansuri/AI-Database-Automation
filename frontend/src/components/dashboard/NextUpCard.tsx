import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Eye, Loader2, PenLine, Send, Sparkles } from "lucide-react";
import { api } from "../../services/api";
import { useLiveEvents } from "../../context/LiveEventsContext";

interface RunCard {
  execution_id: number;
  automation_id: number;
  automation_name: string;
  target_table: string | null;
  status: string;
  stage: "queued" | "writing" | "awaiting_approval" | "scheduled_publish" | "publishing" | "published" | "failed";
  title: string | null;
  requires_approval: boolean;
  generation_at: string | null;
  publication_at: string | null;
  published_at: string | null;
  record_id: string | null;
  error: string | null;
}

interface NextRun {
  automation_id: number;
  name: string;
  target_table: string;
  generation_at: string;
  publication_at: string;
  timezone: string;
  requires_approval: boolean;
}

interface NextUp {
  server_time: string;
  current: RunCard | null;
  next: NextRun | null;
  later: NextRun[];
  active_schedules: number;
  last_published: RunCard | null;
}

/** "2d 4h", "3h 12m", "12:05" (mm:ss under an hour). */
function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const timeOf = (iso: string | null, tz?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }) : "—";
const dayOf = (iso: string | null, tz?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
  const key = (x: Date) => x.toLocaleDateString("en-CA", opts);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (key(d) === key(today)) return "Today";
  if (key(d) === key(tomorrow)) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...opts });
};
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Write -> Review -> Publish, with the current step lit. */
const Steps: React.FC<{ active: number; review: boolean; failed?: boolean }> = ({ active, review, failed }) => {
  const steps = [
    { label: "Write", icon: PenLine },
    ...(review ? [{ label: "Review", icon: Eye }] : []),
    { label: "Publish", icon: Send },
  ];
  return (
    <ol className="mt-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const done = i < active;
        const now = i === active;
        const Icon = done ? CheckCircle2 : s.icon;
        return (
          <li key={s.label} className="min-w-0">
            <div className={`h-1 rounded-full ${done ? "bg-emerald-400" : now ? (failed ? "bg-rose-400" : "bg-gradient-to-r from-indigo-400 to-cyan-300") : "bg-white/10"}`} />
            <div className={`mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold ${done ? "text-emerald-300" : now ? (failed ? "text-rose-300" : "text-white") : "text-slate-500"}`}>
              <Icon className={`h-3 w-3 shrink-0 ${now && !failed && !done ? "animate-pulse" : ""}`} /> {s.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export const NextUpCard: React.FC = () => {
  const [data, setData] = useState<NextUp | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0); // server clock minus this browser's clock
  const refetchAt = useRef<number | null>(null);
  const { addListener } = useLiveEvents();

  const load = useCallback(async () => {
    try {
      const res: NextUp = await api.getNextUp();
      setOffset(new Date(res.server_time).getTime() - Date.now());
      setData(res);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // Runs change state in the background: refresh as soon as the server says so.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = addListener((e) => {
      if ((e.event_name || "").startsWith("execution.") || (e.event_name || "").startsWith("automation.")) {
        if (t) clearTimeout(t);
        t = setTimeout(load, 500);
      }
    });
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [addListener, load]);

  const serverNow = now + offset;
  const leftTo = (iso: string | null) => (iso ? new Date(iso).getTime() - serverNow : null);

  // When a countdown reaches zero, ask the server what happened (a few seconds later, once the run has started).
  const target = useMemo(() => {
    const c = data?.current;
    if (c && (c.stage === "awaiting_approval" || c.stage === "scheduled_publish")) return c.publication_at;
    if (!c && data?.next) return data.next.generation_at;
    return null;
  }, [data]);
  useEffect(() => {
    const left = leftTo(target);
    if (left !== null && left <= 0 && refetchAt.current !== new Date(target!).getTime()) {
      refetchAt.current = new Date(target!).getTime();
      const t = setTimeout(load, 4000);
      return () => clearTimeout(t);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        <Clock className="h-3.5 w-3.5 text-cyan-300" /> {data?.current && data.current.stage !== "published" && data.current.stage !== "failed" ? "Running now" : "Next up"}
      </span>
      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-200">
        {data?.active_schedules ?? 0} active schedule{data?.active_schedules === 1 ? "" : "s"}
      </span>
    </div>
  );

  const nextLine = (n: NextRun | null) =>
    n ? (
      <p className="mt-4 flex items-center gap-1.5 border-t border-white/10 pt-3 text-[12px] text-slate-400">
        <Clock className="h-3.5 w-3.5 text-slate-500" /> Next: <span className="truncate font-semibold text-slate-200">{n.name}</span>
        <span className="ml-auto shrink-0 tabular-nums text-cyan-200">in {formatLeft(leftTo(n.generation_at) ?? 0)}</span>
      </p>
    ) : null;

  let body: React.ReactNode;
  const c = data?.current;
  if (!data) {
    body = failed ? (
      <p className="py-8 text-center text-[13px] text-slate-400">Could not load the schedule. It refreshes on its own.</p>
    ) : (
      <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" /></div>
    );
  } else if (c && c.stage === "published") {
    body = (
      <motion.div key={`done-${c.execution_id}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
        <div className="mt-4 flex items-start gap-3">
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300"><CheckCircle2 className="h-5 w-5" /></motion.span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-emerald-300">Ran and published · {ago(c.published_at)}</p>
            <p className="mt-0.5 truncate text-[17px] font-bold tracking-[-0.02em] text-white">{c.title || c.automation_name}</p>
            <p className="mt-0.5 font-mono text-[12px] text-slate-400">{c.automation_name} → {c.target_table}{c.record_id ? ` · row ${c.record_id}` : ""}</p>
          </div>
        </div>
        <Steps active={3} review={false} />
        {nextLine(data.next)}
      </motion.div>
    );
  } else if (c && c.stage === "failed") {
    body = (
      <div>
        <div className="mt-4 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-400/15 text-rose-300"><AlertTriangle className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-rose-300">Run failed · {ago(c.published_at || c.publication_at)}</p>
            <p className="mt-0.5 truncate text-[17px] font-bold text-white">{c.automation_name}</p>
            {c.error && <p className="mt-1 line-clamp-2 text-[12px] text-slate-400">{c.error}</p>}
          </div>
        </div>
        <Link to="/executions" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-rose-200 hover:text-white">See what happened <ArrowRight className="h-3.5 w-3.5" /></Link>
        {nextLine(data.next)}
      </div>
    );
  } else if (c) {
    const review = c.requires_approval || c.stage === "awaiting_approval";
    const active = c.stage === "queued" || c.stage === "writing" ? 0 : c.stage === "awaiting_approval" ? 1 : review ? 2 : 1;
    const toPublish = leftTo(c.publication_at);
    const caption: Record<string, string> = {
      queued: "Waiting for a worker to start writing",
      writing: "Writing now",
      awaiting_approval: "Waiting for approval",
      scheduled_publish: "Approved, publishes on time",
      publishing: "Writing into your database",
    };
    body = (
      <div>
        <div className="mt-4 text-[18px] font-bold tracking-[-0.02em] text-white">{c.title || c.automation_name}</div>
        <div className="mt-1 font-mono text-[12.5px] text-slate-400">{c.title ? `${c.automation_name} · ` : ""}→ {c.target_table}</div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-200">
              {(c.stage === "writing" || c.stage === "publishing" || c.stage === "queued") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {caption[c.stage]}
            </div>
            {toPublish !== null && toPublish > 0 && (
              <div className="mt-1 text-[11.5px] text-slate-500">Publishes {dayOf(c.publication_at)} at {timeOf(c.publication_at)}</div>
            )}
          </div>
          {toPublish !== null && toPublish > 0 && c.stage !== "publishing" && (
            <div className="text-right">
              <div className="text-[11px] text-slate-500">Publishes in</div>
              <div className="text-[26px] font-extrabold leading-none tabular-nums text-emerald-300">{formatLeft(toPublish)}</div>
            </div>
          )}
        </div>
        <Steps active={active} review={review} />
        {c.stage === "awaiting_approval" && (
          <Link to="/approvals" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-slate-950 hover:bg-indigo-50">
            Review the draft <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {nextLine(data.next)}
      </div>
    );
  } else if (data.next) {
    const n = data.next;
    const left = leftTo(n.generation_at) ?? 0;
    body = (
      <div>
        <div className="mt-4 text-[18px] font-bold tracking-[-0.02em] text-white">{n.name}</div>
        <div className="mt-1 font-mono text-[12.5px] text-slate-400">→ {n.target_table}</div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="text-[12px] text-slate-400">
            <div><span className="text-slate-500">Writes</span> <span className="font-semibold text-indigo-200">{dayOf(n.generation_at, n.timezone)} {timeOf(n.generation_at, n.timezone)}</span></div>
            <div className="mt-0.5"><span className="text-slate-500">Publishes</span> <span className="font-semibold text-emerald-300">{dayOf(n.publication_at, n.timezone)} {timeOf(n.publication_at, n.timezone)}</span></div>
            <div className="mt-0.5 text-[11px] text-slate-500">{n.timezone}{n.requires_approval ? " · you approve first" : " · publishes without review"}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-500">{left > 0 ? "Starts in" : "Starting"}</div>
            <div className="text-[30px] font-extrabold leading-none tabular-nums text-white">{left > 0 ? formatLeft(left) : <Loader2 className="ml-auto h-6 w-6 animate-spin text-cyan-300" />}</div>
          </div>
        </div>
        <Steps active={-1} review={n.requires_approval} />
        {data.last_published && (
          <p className="mt-4 flex items-center gap-1.5 border-t border-white/10 pt-3 text-[12px] text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Last published <span className="truncate font-semibold text-slate-200">{data.last_published.title || data.last_published.automation_name}</span>
            <span className="ml-auto shrink-0">{ago(data.last_published.published_at)}</span>
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <div className="py-6 text-center">
        {data.last_published ? (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <p className="mt-3 text-[14px] font-semibold text-white">All caught up</p>
            <p className="mx-auto mt-1 max-w-xs text-[12.5px] text-slate-400">
              Last published <span className="text-slate-200">{data.last_published.title || data.last_published.automation_name}</span> {ago(data.last_published.published_at)}. Nothing else is scheduled.
            </p>
          </>
        ) : (
          <>
            <Sparkles className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-[13px] text-slate-400">Nothing is scheduled yet.</p>
          </>
        )}
        <Link to="/automations/new" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-300 hover:text-white">
          Schedule an automation <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur" aria-live="polite">
      {header}
      <AnimatePresence mode="wait">
        <motion.div key={c ? `${c.execution_id}-${c.stage}` : data?.next ? `next-${data.next.automation_id}-${data.next.generation_at}` : "none"}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
