import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock, Database, FileEdit, History, Layers, PlusCircle, RefreshCw,
  ShieldCheck, Sparkles, TrendingUp, Workflow, Zap,
} from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { Card, CardHeader, EmptyState, Loading, StatCard, Tone } from "../components/ui/kit";
import { useAuth } from "../context/AuthContext";
import { useLiveEvents } from "../context/LiveEventsContext";
import { useToast } from "../context/ToastContext";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { OrbitRemoteCard } from "../components/remote/OrbitRemoteCard";
import { pageStateService } from "../services/pageStateService";

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<any | null>(null);
  const [automations, setAutomations] = useState<any[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<string>("7d");
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  const { addListener, status: liveStatus } = useLiveEvents();
  const { user } = useAuth();
  const { toast } = useToast();

  const loadData = async (silent = false, range = selectedRange) => {
    try {
      if (!silent && !stats) setLoading(true);
      const [s, a, e] = await Promise.all([
        api.getStats(range),
        api.listAutomations(),
        api.listExecutions(1, 10),
      ]);
      setStats(s);
      setAutomations(Array.isArray(a) ? a : []);
      const execItems = Array.isArray(e?.data)
        ? e.data
        : Array.isArray(e?.items)
        ? e.items
        : Array.isArray(e)
        ? e
        : [];
      setExecutions(execItems);
    } catch (err: any) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/dashboard", "Dashboard");
  }, []);

  useEffect(() => {
    loadData(false, selectedRange);
  }, [selectedRange]);

  useEffect(() => {
    let timer: any = null;
    const unsubscribe = addListener((event) => {
      const name = event.event_name || "";
      if (name.startsWith("execution.") || name.startsWith("automation.") || name.startsWith("connection.")) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          loadData(true, selectedRange);
        }, 400);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [addListener, selectedRange]);

  const handleTriggerRun = async (autoId: number) => {
    try {
      setTriggeringId(autoId);
      toast.info("Dispatching Execution", "Submitting automation run to background queue...");
      const res = await api.triggerAutomation(autoId);
      toast.success("Execution Queued", res.message || "Automation queued for fair dispatch!");
      loadData(true);
    } catch (err: any) {
      toast.error("Execution Failed", err.message || "Failed to trigger automation.");
    } finally {
      setTriggeringId(null);
    }
  };

  // Orbit surface: workspace overview + run an automation (row = automation id).
  useOrbitSurface("dashboard.page", () => ({
    describe: () => ({
      stats: stats ? { connections: stats.connections ?? stats.connected_databases, automations: stats.automations ?? stats.active_pipelines, pending_approvals: stats.pending_approvals } : null,
      automations: automations.slice(0, 15).map((a: any) => ({ id: a.id, name: a.name, active: a.is_active })),
      recent_runs: executions.slice(0, 8).map((e: any) => ({ id: e.id, status: e.status })),
    }),
    actions: {
      run_now: {
        run: async (row) => {
          if (!automations.find((a: any) => String(a.id) === String(row))) return { success: false, message: `No automation ${row}.` };
          try {
            setTriggeringId(Number(row));
            const res: any = await api.triggerAutomation(Number(row));
            loadData(true);
            return { success: true, message: res?.message || "Run queued.", resource: { type: "Automation", id: Number(row) } };
          } catch (err: any) {
            return { success: false, message: err.message || "Could not start the run." };
          } finally {
            setTriggeringId(null);
          }
        },
      },
    },
  }));

  if (loading && !stats) {
    return <Loading label="Loading your workspace…" className="py-32" />;
  }

  const connectionsCount = stats?.connections_count ?? 0;
  const connectedDbCount = stats?.connected_db_count ?? 0;
  const errorDbCount = stats?.error_db_count ?? 0;
  const pendingCount = stats?.pending_approvals_count ?? 0;
  const publishedTodayCount = stats?.published_today_count ?? 0;
  const queueBacklogCount = stats?.queue_backlog_count ?? 0;
  const runningJobsCount = stats?.running_count ?? 0;
  const failedJobsCount = stats?.failed_count ?? 0;
  const automationsCount = stats?.automations_count ?? automations.length;
  const analytics = stats?.analytics || {};
  const nextRun = stats?.upcoming?.next_run;
  const firstName = (user?.name || "").split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const time = (v?: string) => (v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");

  const statCards: { label: string; value: React.ReactNode; hint: string; icon: React.ElementType; to: string; tone: Tone }[] = [
    {
      label: "Connected databases",
      value: `${connectedDbCount}/${connectionsCount}`,
      hint: errorDbCount > 0 ? `${errorDbCount} need attention` : connectionsCount ? "All reachable" : "None yet",
      icon: Database,
      to: "/connections",
      tone: errorDbCount > 0 ? "rose" : "indigo",
    },
    {
      label: "Active automations",
      value: stats?.active_automations_count ?? 0,
      hint: `${automationsCount} configured`,
      icon: Workflow,
      to: "/automations",
      tone: "violet",
    },
    {
      label: "Queue backlog",
      value: queueBacklogCount,
      hint: runningJobsCount > 0 ? `${runningJobsCount} running now` : "Workers idle",
      icon: Layers,
      to: "/executions",
      tone: "sky",
    },
    {
      label: "Pending approvals",
      value: pendingCount,
      hint: pendingCount > 0 ? "Waiting for a reviewer" : "Nothing to review",
      icon: CheckCircle2,
      to: "/approvals",
      tone: pendingCount > 0 ? "amber" : "emerald",
    },
    {
      label: "Published today",
      value: publishedTodayCount,
      hint: `${stats?.published_count ?? 0} all time`,
      icon: History,
      to: "/executions",
      tone: "emerald",
    },
    {
      label: "Failed runs",
      value: failedJobsCount,
      hint: failedJobsCount > 0 ? "Open history to review" : "No failures",
      icon: failedJobsCount > 0 ? AlertTriangle : ShieldCheck,
      to: "/executions",
      tone: failedJobsCount > 0 ? "rose" : "emerald",
    },
  ];

  const onboarding = [
    { done: connectionsCount > 0, title: "Connect a database", body: "Add your MySQL connection; it starts read-only.", to: "/connections", icon: Database },
    { done: automationsCount > 0, title: "Create an automation", body: "Pick a table, a topic and a schedule.", to: "/automations/new", icon: Workflow },
    { done: (stats?.published_count ?? 0) > 0, title: "Approve and publish", body: "Review the first draft from your inbox or here.", to: "/approvals", icon: CheckCircle2 },
  ];
  const showOnboarding = connectionsCount === 0 || automationsCount === 0;
  const doneSteps = onboarding.filter((o) => o.done).length;

  return (
    <div id="dashboard-overview-anchor" className="space-y-6">
      {/* Hero: same ink surface as the landing page */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="da-ink px-6 py-8 sm:px-10 sm:py-10"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -top-32 -left-20 h-96 w-96 rounded-full bg-indigo-600/35" />
          <div className="landing-blob absolute -bottom-40 right-10 h-96 w-96 rounded-full bg-violet-600/25" style={{ animationDelay: "-7s" }} />
          <div className="absolute inset-0 landing-grid opacity-70" />
        </div>
        <div className="relative grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Control plane active
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">
                Timezone <span className="font-semibold text-white">{stats?.timezone || "UTC"}</span>
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">
                Live updates <span className="font-semibold capitalize text-white">{liveStatus}</span>
              </span>
            </div>
            <h1 className="mt-5 text-[30px] sm:text-[40px] font-extrabold leading-[1.05] tracking-[-0.04em] text-white">
              {greeting}{firstName ? `, ${firstName}` : ""}.
              <br />
              <span className="landing-shimmer-text">Your database is on autopilot.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
              Schedules, drafts, approvals and publishing for your connected databases, in one place. Ask Orbit in the corner if you want a hand.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link to="/automations/new" className="da-btn px-5 py-2.5 text-[13.5px] bg-white text-slate-950 shadow-glow hover:-translate-y-px hover:bg-indigo-50">
                <PlusCircle className="h-4 w-4" /> New automation
              </Link>
              <Link to="/connections" className="da-btn px-5 py-2.5 text-[13.5px] border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.09]">
                <Database className="h-4 w-4 text-indigo-300" /> Connect database
              </Link>
              <Link to="/manual-schedule" className="da-btn px-5 py-2.5 text-[13.5px] border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.09]">
                <FileEdit className="h-4 w-4 text-cyan-300" /> Write manually
              </Link>
            </div>
          </div>

          {/* Next up */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <Clock className="h-3.5 w-3.5 text-cyan-300" /> Next up
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-200">
                {stats?.upcoming?.total_scheduled_active || 0} active schedules
              </span>
            </div>
            {nextRun ? (
              <>
                <div className="mt-4 text-[18px] font-bold tracking-[-0.02em] text-white">{nextRun.name}</div>
                <div className="mt-1 font-mono text-[12.5px] text-slate-400">→ {nextRun.target_table}</div>
                <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Writes</div>
                    <div className="text-[20px] font-bold tabular-nums text-indigo-200">{time(nextRun.next_generation_at)}</div>
                  </div>
                  <div className="relative h-px bg-gradient-to-r from-indigo-400/60 via-violet-400/60 to-emerald-400/60">
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/10 bg-ink px-2 py-0.5 text-[10.5px] text-slate-400">
                      review window
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Publishes</div>
                    <div className="text-[20px] font-bold tabular-nums text-emerald-300">{time(nextRun.next_publication_at)}</div>
                  </div>
                </div>
                <p className="mt-4 text-[12px] leading-relaxed text-slate-500">
                  Publication is always at least 15 minutes after writing, so reviewers have time to decide.
                </p>
              </>
            ) : (
              <div className="py-8 text-center">
                <Clock className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-3 text-[13px] text-slate-400">Nothing scheduled for today.</p>
                <Link to="/automations/new" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-300 hover:text-white">
                  Schedule an automation <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* Orbit Remote: talk to Orbit from a phone */}
      <OrbitRemoteCard />

      {/* Getting started */}
      {showOnboarding && (
        <Card className="overflow-hidden">
          <CardHeader
            icon={Sparkles}
            title="Get your first automation running"
            description={`${doneSteps} of ${onboarding.length} steps done`}
            actions={
              <div className="hidden sm:block h-2 w-40 overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(doneSteps / onboarding.length) * 100}%` }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400"
                />
              </div>
            }
          />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {onboarding.map((o, i) => (
              <Link
                key={o.title}
                to={o.to}
                className={`group flex items-start gap-3 rounded-2xl border p-4 transition-all hover:-translate-y-0.5 ${
                  o.done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-indigo-200 hover:shadow-lift"
                }`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ${o.done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-indigo-600 group-hover:text-white"}`}>
                  {o.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900">{o.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-500">{o.body}</span>
                </span>
                {!o.done && <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />}
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {statCards.map((card, idx) => (
          <StatCard key={card.label} {...card} delay={0.04 * idx} />
        ))}
      </div>

      {/* Reliability */}
      <Card>
        <CardHeader
          icon={TrendingUp}
          tone="emerald"
          title="Run reliability"
          description="Measured from your execution records and audit log."
          actions={
            <div className="da-tabs" role="tablist" aria-label="Time range">
              {["24h", "7d", "30d"].map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={selectedRange === r}
                  onClick={() => setSelectedRange(r)}
                  className={`da-tab px-3 py-1.5 ${selectedRange === r ? "da-tab-active" : ""}`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          }
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: `Published (${selectedRange})`, value: analytics.range_published || 0, tone: "text-emerald-700", bg: "bg-emerald-50/70 border-emerald-100" },
              { label: "Failed", value: analytics.range_failed || 0, tone: "text-rose-700", bg: "bg-rose-50/70 border-rose-100" },
              { label: "Avg. generation", value: analytics.avg_duration_ms ? `${(analytics.avg_duration_ms / 1000).toFixed(1)}s` : "—", tone: "text-indigo-700", bg: "bg-indigo-50/70 border-indigo-100" },
              { label: "Avg. queue wait", value: analytics.avg_queue_wait_ms ? `${(analytics.avg_queue_wait_ms / 1000).toFixed(1)}s` : "0s", tone: "text-slate-800", bg: "bg-slate-50 border-slate-200" },
            ].map((m) => (
              <div key={m.label} className={`rounded-2xl border p-4 ${m.bg}`}>
                <div className="text-[12px] font-medium text-slate-500">{m.label}</div>
                <div className={`mt-1.5 text-[26px] font-extrabold tracking-[-0.03em] tabular-nums ${m.tone}`}>{m.value}</div>
              </div>
            ))}
            {analytics.failure_breakdown && Object.keys(analytics.failure_breakdown).length > 0 && (
              <div className="col-span-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Failure categories
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(analytics.failure_breakdown).map(([category, count]) => (
                    <span key={category} className="da-chip da-chip-amber font-mono">{category}: {count as number}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                <Activity className="h-3.5 w-3.5 text-indigo-500" /> Runs per day
              </span>
              <span className="flex items-center gap-3 text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Published</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-500" /> Failed</span>
              </span>
            </div>
            <div className="mt-3 flex h-44 flex-1 items-end gap-2 overflow-x-clip rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/40 to-slate-50 px-4 pb-2 pt-6">
              {(analytics.daily_volume?.length ? analytics.daily_volume : []).map((d: any, idx: number, all: any[]) => {
                const maxVal = Math.max(1, ...all.map((x: any) => x.total));
                const pub = (d.published / maxVal) * 100;
                const fail = (d.failed / maxVal) * 100;
                return (
                  <div key={idx} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                    <div className="flex h-full w-full max-w-[34px] flex-col justify-end">
                      {d.failed > 0 && (
                        <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(6, fail)}%` }} transition={{ duration: 0.7, delay: idx * 0.04 }}
                          className="w-full rounded-t-md bg-gradient-to-t from-rose-500 to-rose-400" />
                      )}
                      {d.published > 0 && (
                        <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(6, pub)}%` }} transition={{ duration: 0.7, delay: idx * 0.04 }}
                          className={`w-full bg-gradient-to-t from-emerald-500 to-teal-400 ${d.failed === 0 ? "rounded-t-md" : ""}`} />
                      )}
                      {d.total === 0 && <div className="h-1 w-full rounded-full bg-slate-200" />}
                    </div>
                    <span className="mt-2 truncate text-[10.5px] font-medium text-slate-400">{d.label}</span>
                    <div className="pointer-events-none absolute -top-8 z-20 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1 text-[11px] text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                      <strong>{d.label}</strong> · {d.published} published · {d.failed} failed
                    </div>
                  </div>
                );
              })}
              {!analytics.daily_volume?.length && <div className="m-auto text-[13px] text-slate-400">No runs in this range yet.</div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-500">
              <span>
                Model: <span className="font-semibold text-slate-800">{(stats?.ai_health?.provider || "ollama").toString()}</span>
                {stats?.ai_health?.model ? <span className="text-slate-400"> · {stats.ai_health.model}</span> : null}
              </span>
              <Link to="/executions" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700">
                Execution history <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </Card>

      {/* Automations, recent runs, activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-5 pb-3">
            <CardHeader
              icon={Workflow}
              tone="violet"
              title="Automations"
              actions={<Link to="/automations" className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700">View all ({automations.length})</Link>}
            />
          </div>
          {automations.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={Workflow} title="No automations yet" description="Connect a database and create your first publishing pipeline."
                action={<Link to="/automations/new" className="da-btn da-btn-primary da-btn-sm"><PlusCircle className="h-3.5 w-3.5" /> Create one</Link>} className="py-8" />
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-slate-100 px-2 pb-2">
              {automations.slice(0, 5).map((auto) => (
                <li key={auto.id} className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[14px] font-semibold text-slate-900">{auto.name}</span>
                      <StatusPill status={auto.is_active ? "ACTIVE" : "PAUSED"} size="sm" />
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      <span className="font-mono text-slate-700">{auto.target_table}</span> · {auto.generation_time}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTriggerRun(auto.id)}
                    disabled={triggeringId === auto.id}
                    className="da-btn da-btn-secondary da-btn-sm shrink-0"
                  >
                    {triggeringId === auto.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-indigo-600" />}
                    {triggeringId === auto.id ? "Queuing…" : "Run now"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-5 pb-3">
            <CardHeader
              icon={History}
              tone="sky"
              title="Recent runs"
              actions={<Link to="/executions" className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700">History</Link>}
            />
          </div>
          {executions.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={Clock} title="No runs yet" description="Runs appear here as soon as an automation starts." className="py-8" />
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-slate-100 px-2 pb-2">
              {executions.slice(0, 5).map((exec) => (
                <li key={exec.id} className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-slate-900">{exec.automation?.name || `Run #${exec.id}`}</div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      <span className="font-mono text-slate-700">{exec.automation?.target_table || "—"}</span> · {time(exec.created_at)}
                    </div>
                  </div>
                  <StatusPill status={exec.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-5 pb-3">
            <CardHeader
              icon={Activity}
              tone="emerald"
              title="Live activity"
              actions={<Link to="/audit-logs" className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700">Audit log</Link>}
            />
          </div>
          {!stats?.operational_feed || stats.operational_feed.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={ShieldCheck} title="All quiet" description="Security and audit events will show up here." className="py-8" />
            </div>
          ) : (
            <ol className="relative flex-1 px-5 pb-5">
              <span aria-hidden className="absolute bottom-6 left-[27px] top-1 w-px bg-slate-200" />
              {stats.operational_feed.slice(0, 6).map((event: any) => {
                const isErr = event.action?.includes("FAIL") || event.action?.includes("ERROR");
                const isPub = event.action?.includes("PUBLISH") || event.action?.includes("COMMITTED");
                return (
                  <li key={event.id} className="relative flex gap-3 py-2">
                    <span className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white ${isErr ? "bg-rose-500" : isPub ? "bg-emerald-500" : "bg-indigo-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[12px] font-semibold text-slate-800">{event.action}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{time(event.created_at)}</span>
                      </div>
                      <p className="truncate text-[12.5px] text-slate-500">
                        {event.details?.name || event.details?.message || `${event.entity_type} #${event.entity_id || ""}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
};
