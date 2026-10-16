import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Database,
  Workflow,
  CheckCircle2,
  History,
  ArrowRight,
  ShieldCheck,
  PlusCircle,
  Clock,
  Layers,
  RefreshCw,
  Zap,
  Activity,
  AlertTriangle,
  Server,
  Cpu,
  BookOpen,
  FileEdit,
  TrendingUp,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { useLiveEvents } from "../context/LiveEventsContext";
import { useToast } from "../context/ToastContext";
import { useOrbitSurface } from "../hooks/useOrbitSurface";

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<any | null>(null);
  const [automations, setAutomations] = useState<any[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<string>("7d");
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  const { addListener, status: liveStatus } = useLiveEvents();
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
    return (
      <div className="py-24 text-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-500 text-sm font-medium">Loading workspace dashboard...</p>
      </div>
    );
  }

  const connectionsCount = stats?.connections_count ?? 0;
  const connectedDbCount = stats?.connected_db_count ?? 0;
  const errorDbCount = stats?.error_db_count ?? 0;
  const pendingCount = stats?.pending_approvals_count ?? 0;
  const publishedTodayCount = stats?.published_today_count ?? 0;
  const queueBacklogCount = stats?.queue_backlog_count ?? 0;
  const runningJobsCount = stats?.running_count ?? 0;
  const failedJobsCount = stats?.failed_count ?? 0;
  const analytics = stats?.analytics || {};
  const nextRun = stats?.upcoming?.next_run;

  const statCards = [
    {
      label: "Connected Databases",
      value: `${connectedDbCount}/${connectionsCount}`,
      subtext: errorDbCount > 0 ? `${errorDbCount} connection alert` : "All connections healthy",
      icon: Database,
      to: "/connections",
      color: errorDbCount > 0 ? "text-rose-600" : "text-indigo-600",
      bg: errorDbCount > 0 ? "bg-rose-50 border-rose-100" : "bg-indigo-50 border-indigo-100",
    },
    {
      label: "Active Pipelines",
      value: stats?.active_automations_count ?? 0,
      subtext: `${stats?.automations_count ?? 0} total configured`,
      icon: Workflow,
      to: "/automations",
      color: "text-violet-600",
      bg: "bg-violet-50 border-violet-100",
    },
    {
      label: "Queue Backlog",
      value: queueBacklogCount,
      subtext: runningJobsCount > 0 ? `${runningJobsCount} active worker(s)` : "Fair queue idle",
      icon: Layers,
      to: "/executions",
      color: runningJobsCount > 0 ? "text-blue-600" : "text-slate-600",
      bg: "bg-blue-50 border-blue-100",
    },
    {
      label: "Pending Approvals",
      value: pendingCount,
      subtext: pendingCount > 0 ? "Action required" : "Zero pending reviews",
      icon: CheckCircle2,
      to: "/approvals",
      color: pendingCount > 0 ? "text-amber-600" : "text-emerald-600",
      bg: pendingCount > 0 ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100",
    },
    {
      label: "Published Today",
      value: publishedTodayCount,
      subtext: `${stats?.published_count ?? 0} all-time records`,
      icon: History,
      to: "/executions",
      color: "text-emerald-600",
      bg: "bg-emerald-50 border-emerald-100",
    },
    {
      label: "Failed Runs",
      value: failedJobsCount,
      subtext: failedJobsCount > 0 ? "Requires review" : "100% clean executions",
      icon: failedJobsCount > 0 ? AlertTriangle : ShieldCheck,
      to: "/executions",
      color: failedJobsCount > 0 ? "text-rose-600" : "text-emerald-600",
      bg: failedJobsCount > 0 ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100",
    },
  ];

  return (
    <div id="dashboard-overview-anchor" className="space-y-6">
      {/* Global Status Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden"
      >
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Control Plane Active</span>
            </span>
            <span className="text-xs text-slate-500">
              • Timezone: <strong className="text-slate-800">{stats?.timezone || "UTC"}</strong>
            </span>
            <span className="text-xs text-slate-500">
              • Realtime Events: <strong className="text-indigo-600 capitalize">{liveStatus}</strong>
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Database Automation Control Center
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl mt-1 leading-relaxed">
            Multi-tenant background automation engine. Self-service schema inspection, fair queue dispatch, and safe transactional publication.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <Link
            to="/connections"
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition shadow-2xs hover:border-slate-400 flex items-center space-x-1.5"
          >
            <Database className="w-3.5 h-3.5 text-slate-500" />
            <span>Connect DB</span>
          </Link>
          <Link
            to="/manual-schedule"
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition shadow-2xs hover:border-slate-400 flex items-center space-x-1.5"
          >
            <FileEdit className="w-3.5 h-3.5 text-slate-500" />
            <span>Manual Content</span>
          </Link>
          <Link
            to="/automations/new"
            className="btn-primary-gradient px-4 py-2 text-white rounded-xl text-xs font-semibold transition shadow-xs flex items-center space-x-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Automation</span>
          </Link>
        </div>
      </motion.div>

      {/* Onboarding Empty State */}
      {connectionsCount === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 bg-white border border-dashed border-indigo-200 rounded-2xl text-center max-w-3xl mx-auto shadow-xs"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-2xs">
            <Database className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">Welcome! Connect Your Target Database</h3>
          <p className="text-slate-600 text-xs max-w-xl mx-auto mb-6 leading-relaxed">
            Your isolated workspace is ready. Add your MySQL connection details to test access, discover tables, and configure your first automated content workflow.
          </p>
          <div className="flex justify-center">
            <Link
              to="/connections"
              className="btn-primary-gradient px-5 py-2.5 text-white text-xs font-semibold rounded-xl shadow-sm transition flex items-center space-x-2"
            >
              <span>Connect Target Database</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      )}

      {/* Primary KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={idx}
              whileHover={{ y: -3, transition: { duration: 0.18 } }}
              whileTap={{ scale: 0.98 }}
            >
              <Link
                to={card.to}
                className="block bg-white border border-slate-200/90 hover:border-indigo-300 rounded-xl p-3.5 transition-all shadow-xs hover:shadow-md hover:shadow-indigo-500/5 group h-full flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-slate-500 font-medium truncate">{card.label}</span>
                    <div className={`w-7 h-7 rounded-lg ${card.bg} border flex items-center justify-center shrink-0 ${card.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {card.value}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-2 truncate font-medium">
                  {card.subtext}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Operational Highlights & Upcoming Work */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Next Scheduled Publication */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Next Scheduled Work</span>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {stats?.upcoming?.total_scheduled_active || 0} Active Schedules
              </span>
            </div>

            {nextRun ? (
              <div className="space-y-2.5">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <h4 className="text-sm font-bold text-slate-900 mb-1">{nextRun.name}</h4>
                  <div className="text-xs text-slate-500 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Target Table:</span>
                      <strong className="text-slate-800 font-mono">{nextRun.target_table}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Background Gen:</span>
                      <span className="font-mono text-indigo-600 font-semibold">
                        {new Date(nextRun.next_generation_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Target Publication:</span>
                      <span className="font-mono text-emerald-600 font-semibold">
                        {new Date(nextRun.next_publication_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Publication is always at least 15 minutes after generation, so reviewers have time to decide.
                </p>
              </div>
            ) : (
              <div className="py-6 text-center text-slate-400 text-xs">
                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No pending runs scheduled for today.
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/automations" className="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1">
              <span>View Schedules</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Execution Reliability & Time-Range Filter */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Execution Reliability Telemetry</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Measured from platform audit logs and execution records
                </span>
              </div>

              {/* Time Range Filter Toggle */}
              <div className="flex items-center p-0.5 bg-slate-100 rounded-lg text-xs font-semibold">
                {["24h", "7d", "30d"].map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRange(r)}
                    className={`px-2.5 py-1 rounded-md transition ${
                      selectedRange === r
                        ? "bg-white text-indigo-700 shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                <span className="text-[11px] text-emerald-700 font-medium">Published ({selectedRange})</span>
                <div className="text-lg font-extrabold text-emerald-900 mt-0.5">
                  {analytics.range_published || 0}
                </div>
              </div>
              <div className="p-3 bg-rose-50/60 border border-rose-100 rounded-xl">
                <span className="text-[11px] text-rose-700 font-medium">Failed Runs</span>
                <div className="text-lg font-extrabold text-rose-900 mt-0.5">
                  {analytics.range_failed || 0}
                </div>
              </div>
              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                <span className="text-[11px] text-indigo-700 font-medium">Avg Gen Duration</span>
                <div className="text-lg font-extrabold text-indigo-900 mt-0.5 font-mono">
                  {analytics.avg_duration_ms ? `${analytics.avg_duration_ms}ms` : "N/A"}
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[11px] text-slate-600 font-medium">Avg Queue Wait</span>
                <div className="text-lg font-extrabold text-slate-900 mt-0.5 font-mono">
                  {analytics.avg_queue_wait_ms ? `${analytics.avg_queue_wait_ms}ms` : "0ms"}
                </div>
              </div>
            </div>

            {/* Failure Categories Breakdown */}
            {analytics.failure_breakdown && Object.keys(analytics.failure_breakdown).length > 0 && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-1">
                <span className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Failure Categories Recorded:</span>
                </span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {Object.entries(analytics.failure_breakdown).map(([category, count]) => (
                    <span key={category} className="px-2 py-0.5 bg-white border border-amber-300 rounded text-[11px] font-mono text-amber-900">
                      {category}: {count as number}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Visual Timeseries Distribution Chart */}
            {analytics.daily_volume && analytics.daily_volume.length > 0 && (
              <div className="pt-3 pb-1 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-indigo-600" />
                    <span>Run Volume Distribution ({selectedRange})</span>
                  </span>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-xs bg-emerald-500" />
                      <span>Published</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-xs bg-rose-500" />
                      <span>Failed</span>
                    </span>
                  </div>
                </div>

                <div className="h-20 flex items-end gap-1.5 pt-2 pb-1 bg-slate-50/70 rounded-xl px-3 border border-slate-100">
                  {(() => {
                    const maxVal = Math.max(1, ...analytics.daily_volume.map((d: any) => d.total));
                    return analytics.daily_volume.map((d: any, idx: number) => {
                      const pubPct = Math.round((d.published / maxVal) * 100);
                      const failPct = Math.round((d.failed / maxVal) * 100);
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                          <div className="w-full max-w-[28px] flex flex-col justify-end h-full">
                            {d.failed > 0 && (
                              <div
                                style={{ height: `${Math.max(6, failPct)}%` }}
                                className="w-full bg-rose-500 rounded-t-xs"
                              />
                            )}
                            {d.published > 0 && (
                              <div
                                style={{ height: `${Math.max(6, pubPct)}%` }}
                                className={`w-full bg-emerald-500 ${d.failed === 0 ? "rounded-t-xs" : ""}`}
                              />
                            )}
                            {d.total === 0 && (
                              <div className="w-full h-1 bg-slate-200 rounded-xs" />
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400 font-mono mt-1 truncate max-w-full">
                            {d.label}
                          </span>

                          <div className="absolute -top-9 opacity-0 group-hover:opacity-100 pointer-events-none transition bg-slate-900 text-white text-[10px] py-1 px-2 rounded-md shadow-lg whitespace-nowrap z-20">
                            <strong>{d.label}:</strong> {d.published} pub, {d.failed} fail
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Provider: <strong className="text-slate-800 uppercase">{stats?.ai_health?.provider || "OLLAMA"}</strong> ({stats?.ai_health?.model || "default"})</span>
            <Link to="/executions" className="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1">
              <span>Execution Logs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Grid: Automations, Recent Executions & Live Operational Feed */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Column 1: Configured Automations */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Workflow className="w-4 h-4 text-indigo-600" />
              <span>Configured Automations</span>
            </h3>
            <Link to="/automations" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              View All ({automations.length}) →
            </Link>
          </div>

          {automations.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs">
              <Workflow className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              No automations configured yet. Connect a database and create your first publishing pipeline.
            </div>
          ) : (
            <div className="space-y-3">
              {automations.slice(0, 5).map((auto) => (
                <motion.div
                  key={auto.id}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white border border-slate-200/90 hover:border-indigo-200 rounded-xl p-4 flex items-center justify-between transition-all shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900 truncate max-w-[150px]">{auto.name}</h4>
                      <StatusPill status={auto.is_active ? "ACTIVE" : "PAUSED"} size="sm" />
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <span>Target: <span className="text-slate-800 font-mono font-medium">{auto.target_table}</span></span>
                      <span>•</span>
                      <span>{auto.generation_time}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTriggerRun(auto.id)}
                      disabled={triggeringId === auto.id}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-indigo-700 border border-slate-200 rounded-lg text-xs font-semibold transition flex items-center gap-1 shadow-2xs"
                    >
                      {triggeringId === auto.id ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Dispatching...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3 text-indigo-600" />
                          <span>Run Now</span>
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2: Recent Executions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-600" />
              <span>Recent Executions</span>
            </h3>
            <Link to="/executions" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              View History →
            </Link>
          </div>

          {executions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs">
              <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              No background executions recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {executions.slice(0, 5).map((exec) => (
                <motion.div
                  key={exec.id}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white border border-slate-200/90 rounded-xl p-3.5 space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 truncate max-w-[160px]">
                      {exec.automation?.name || `Execution #${exec.id}`}
                    </span>
                    <StatusPill status={exec.status} size="sm" />
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center justify-between font-mono">
                    <span className="truncate max-w-[130px]">Table: {exec.automation?.target_table || "mysql"}</span>
                    <span className="font-sans">
                      {new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Column 3: Live Operational Activity Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>Live Operational Feed</span>
            </h3>
            <Link to="/audit-logs" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
              Audit Logs →
            </Link>
          </div>

          {!stats?.operational_feed || stats.operational_feed.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs">
              <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              No security audit events recorded yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.operational_feed.slice(0, 5).map((event: any) => {
                const isErr = event.action?.includes("FAIL") || event.action?.includes("ERROR");
                const isPub = event.action?.includes("PUBLISH") || event.action?.includes("COMMITTED");
                return (
                  <motion.div
                    key={event.id}
                    whileHover={{ y: -1 }}
                    className="p-3 bg-white border border-slate-200/90 rounded-xl text-xs space-y-1 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 font-mono text-[11px] flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isErr ? "bg-rose-500" : isPub ? "bg-emerald-500" : "bg-indigo-600"}`} />
                        <span className="truncate max-w-[160px]">{event.action}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                        {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-600 text-[11px] truncate">
                      {event.details?.name || event.details?.message || `${event.entity_type} #${event.entity_id || ""}`}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
