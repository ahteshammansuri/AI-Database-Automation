import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Workflow, Plus, Play, Pause, Trash2, Database, Clock, CheckCircle, AlertCircle, Zap, RefreshCw, Cpu, Settings } from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useToast } from "../context/ToastContext";
import { orbitTargets } from "../services/orbitTargets";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useRefreshAfterOrbit } from "../hooks/useRefreshAfterOrbit";
import { pageStateService } from "../services/pageStateService";
import { formatInstant, relativeFromNow } from "../lib/schedule";

export const AutomationsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [automations, setAutomations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [editingAutomation, setEditingAutomation] = useState<any | null>(null);
  const [editingProvider, setEditingProvider] = useState<string>("ollama");
  const [editingModel, setEditingModel] = useState<string>("llama3.2:1b");
  const [editingPrompt, setEditingPrompt] = useState<string>("");
  const [isSavingModal, setIsSavingModal] = useState<boolean>(false);
  const { toast, confirm } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const list = await api.listAutomations();
      setAutomations(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error(err);
      setActionMsg({ type: "error", text: `Failed to load: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/automations", "Automations List");
    loadData();

  }, [navigate]);

  // ---- Orbit surface: the same API calls the row buttons make (row = automation id) ------------
  useRefreshAfterOrbit(["create_automation_draft", "update_automation", "remove_automation", "run_automation_now"], () => { loadData(); });

  useOrbitSurface("automations.list", () => {
    const find = (row?: string) => automations.find((a: any) => String(a.id) === String(row));
    return {
      describe: () => automations.map((a: any) => ({
        id: a.id, name: a.name, table: a.target_table, schedule: a.schedule_type,
        active: a.is_active !== undefined ? !!a.is_active : a.status === "ACTIVE",
        state: a.schedule_summary?.state,
        next_run: a.schedule_summary?.next_run?.generation_at ?? undefined,
      })),
      actions: {
        run_now: {
          target: (row) => `automations.row.${row}`,
          run: async (row) => {
            if (!find(row)) return { success: false, message: `No automation ${row} in the list.` };
            try {
              setRunningId(Number(row));
              const res: any = await api.triggerAutomation(Number(row));
              loadData();
              return { success: true, message: res?.message || "Run queued.", resource: { type: "Automation", id: Number(row) } };
            } catch (err: any) {
              return { success: false, message: err.message || "Could not start the run." };
            } finally {
              setRunningId(null);
            }
          },
        },
        toggle: {
          target: (row) => `automations.row.${row}`,
          run: async (row) => {
            const a: any = find(row);
            if (!a) return { success: false, message: `No automation ${row} in the list.` };
            const active = a.is_active !== undefined ? a.is_active : a.status === "ACTIVE";
            try {
              await api.updateAutomation(a.id, { is_active: !active, status: !active ? "ACTIVE" : "PAUSED" });
              loadData();
              return { success: true, message: `${a.name} is now ${!active ? "active" : "paused"}.`, resource: { type: "Automation", id: a.id } };
            } catch (err: any) {
              return { success: false, message: err.message || "Could not change the status." };
            }
          },
        },
        remove: {
          target: (row) => `automations.row.${row}`,
          run: async (row) => {
            if (!find(row)) return { success: false, message: `No automation ${row} in the list.` };
            if (!(await askDelete(Number(row)))) return { success: false, message: "Deletion was not confirmed in the popup; nothing changed." };
            try {
              await api.deleteAutomation(Number(row));
              loadData();
              return { success: true, message: "Automation deleted." };
            } catch (err: any) {
              return { success: false, message: err.message || "Could not delete the automation." };
            }
          },
        },
        new: { run: () => { navigate("/automations/new"); return { success: true, message: "Automation builder opened." }; } },
      },
    };
  });

  const handleTrigger = async (id: number) => {
    try {
      setRunningId(id);
      toast.info("Triggering Pipeline", `Executing automation #${id}...`);
      const res = await api.triggerAutomation(id);
      toast.success("Trigger Succeeded", res.message || "Automation job queued.");
      loadData();
    } catch (err: any) {
      toast.error("Trigger Failed", err.message);
    } finally {
      setRunningId(null);
    }
  };

  const handleToggleStatus = async (a: any) => {
    const isCurrentlyActive = a.is_active !== undefined ? a.is_active : (a.status === "ACTIVE");
    const nextStatus = !isCurrentlyActive;
    try {
      await api.updateAutomation(a.id, { is_active: nextStatus, status: nextStatus ? "ACTIVE" : "PAUSED" });
      toast.success(nextStatus ? "Pipeline Resumed" : "Pipeline Paused", `Automation #${a.id} status updated.`);
      loadData();
    } catch (err: any) {
      toast.error("Status Update Failed", err.message);
    }
  };

  // Shared by the Delete button and Orbit's remove action, so both see the same popup.
  function askDelete(id: number) {
    const name = automations.find((a: any) => a.id === id)?.name;
    return confirm({
      title: "Delete Automation Pipeline?",
      text: `Are you sure you want to delete ${name ? `"${name}"` : "this automation pipeline"}? Any scheduled runs will be cancelled.`,
      confirmButtonText: "Yes, Delete",
      cancelButtonText: "Cancel",
    });
  }

  const handleDelete = async (id: number) => {
    if (!(await askDelete(id))) return;
    try {
      await api.deleteAutomation(id);
      toast.success("Automation Deleted", "The automation pipeline has been removed.");
      loadData();
    } catch (err: any) {
      toast.error("Delete Failed", err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
              Durable Orchestration
            </span>
            <span className="text-xs text-slate-500">• Recurring Publishing Pipelines</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Active Automations</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Scheduled pipelines generating and publishing structured data into target MySQL databases
          </p>
        </div>
        <Link
          to="/automations/new"
          className="btn-primary-gradient flex items-center gap-2 px-4 py-2 text-white rounded-lg text-xs font-semibold transition shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Automation</span>
        </Link>
      </div>

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between shadow-2xs ${
              actionMsg.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <span>{actionMsg.text}</span>
            <button onClick={() => setActionMsg(null)} className="font-bold ml-4">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && automations.length === 0 ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading automations...</p>
        </div>
      ) : automations.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-2xl shadow-xs p-8"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Workflow className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">No automations configured</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-5 leading-relaxed">
            Build your first AI-assisted or manual publishing pipeline to automate recurring database insertions.
          </p>
          <Link
            to="/automations/new"
            className="btn-primary-gradient px-4 py-2.5 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Automation</span>
          </Link>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {automations.map((a) => {
            const isActive = a.is_active !== undefined ? a.is_active : (a.status === "ACTIVE");
            const sum = a.schedule_summary ?? null;
            const tz = sum?.timezone || a.timezone || "UTC";
            const state: string = sum?.state ?? (isActive ? "ACTIVE" : "PAUSED");
            const isManualContainer = state === "MANUAL";
            const stateStyle: Record<string, string> = {
              ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
              SCHEDULED: "bg-sky-50 text-sky-700 border-sky-200",
              FINISHING: "bg-amber-50 text-amber-700 border-amber-200",
              COMPLETED: "bg-slate-100 text-slate-600 border-slate-200",
              PAUSED: "bg-amber-50 text-amber-800 border-amber-200",
              MANUAL: "bg-slate-50 text-slate-600 border-slate-200",
            };
            const stateLabel: Record<string, string> = {
              ACTIVE: "Active", SCHEDULED: "Starts soon", FINISHING: "Last run in progress", COMPLETED: "Already done", PAUSED: "Paused", MANUAL: "Manual publishing",
            };
            const freq = sum?.frequency === "ONE_TIME" ? "One time" : sum?.frequency === "WEEKLY" ? "Weekly" : sum?.frequency === "DAILY" ? "Daily" : null;

            return (
              <motion.div
                key={a.id}
                ref={(el: HTMLDivElement | null) =>
                  el ? orbitTargets.register(`automations.row.${a.id}`, el) : orbitTargets.unregister(`automations.row.${a.id}`)
                }
                className="group flex flex-col gap-4 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/5 sm:p-5 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900 transition-colors group-hover:text-indigo-600 sm:text-base">{a.name}</h4>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${stateStyle[state] ?? stateStyle.ACTIVE}`}>
                      {state === "COMPLETED" && <CheckCircle className="h-3 w-3" />}
                      {stateLabel[state] ?? state}
                    </span>
                    {freq && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{freq}</span>}
                    {a.ai_provider && a.ai_provider !== "none" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                        <Cpu className="h-3 w-3" /> {a.ai_provider}{a.ai_model ? ` · ${a.ai_model}` : ""}
                      </span>
                    )}
                  </div>

                  {sum?.description && <p className="max-w-3xl text-xs leading-relaxed text-slate-600">{sum.description}</p>}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <Database className="h-3.5 w-3.5 text-indigo-600" />
                      <code className="font-semibold text-indigo-700">{a.target_table}</code>
                      {a.connection?.name && <span className="text-slate-400">in {a.connection.name}</span>}
                    </span>
                    {!isManualContainer && sum?.next_run && state !== "PAUSED" && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        Next: <strong className="text-slate-800">{formatInstant(sum.next_run.generation_at, tz, { withYear: false })}</strong>
                        <span className="text-slate-400">({relativeFromNow(sum.next_run.generation_at)})</span>
                      </span>
                    )}
                    {state === "COMPLETED" && sum?.completed_at && (
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> Finished {formatInstant(sum.completed_at, tz, { withYear: false })}
                      </span>
                    )}
                    {sum?.total_runs ? (
                      <span>{sum.finished_runs ?? 0} of {sum.total_runs} run{sum.total_runs === 1 ? "" : "s"} done</span>
                    ) : !isManualContainer && sum ? (
                      <span>{sum.finished_runs ?? 0} run{(sum.finished_runs ?? 0) === 1 ? "" : "s"} so far</span>
                    ) : null}
                    {a.requires_approval && <span>Review by {a.reviewer_email || "email"}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 self-stretch sm:self-end lg:self-center">
                  {!isManualContainer && state !== "COMPLETED" && (
                    <button
                      disabled={runningId === a.id}
                      onClick={() => handleTrigger(a.id)}
                      className="btn-primary-gradient flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition sm:flex-none"
                      title="Generate one run now (publishes after the usual gap)"
                    >
                      {runningId === a.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      <span>{runningId === a.id ? "Starting…" : "Run now"}</span>
                    </button>
                  )}
                  <Link to={`/executions?automation=${a.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50" title="Run history">
                    History
                  </Link>
                  {!isManualContainer && (
                    <button
                      onClick={() => {
                        setEditingAutomation(a);
                        setEditingProvider(a.ai_provider && a.ai_provider !== "none" ? a.ai_provider : "ollama");
                        setEditingModel(a.ai_model && a.ai_model !== "default" ? a.ai_model : "");
                        setEditingPrompt(a.prompt_context || "");
                      }}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-indigo-700 shadow-2xs transition hover:bg-indigo-100"
                      title="Change model and topic"
                      aria-label="Change model and topic"
                    >
                      <Settings className="h-4 w-4" />
                    </button>
                  )}
                  {!isManualContainer && state !== "COMPLETED" && (
                    <button
                      onClick={() => handleToggleStatus(a)}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700 shadow-2xs transition hover:bg-slate-100"
                      title={isActive ? "Pause" : "Resume"}
                      aria-label={isActive ? "Pause" : "Resume"}
                    >
                      {isActive ? <Pause className="h-4 w-4 text-amber-600" /> : <Play className="h-4 w-4 text-emerald-600" />}
                    </button>
                  )}
                  <button onClick={() => handleDelete(a.id)} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" title="Delete" aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Quick AI Provider & Prompt Reconfigure Modal */}
      <AnimatePresence>
        {editingAutomation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Configure AI Model & Prompt</h3>
                    <p className="text-[11px] text-slate-500">{editingAutomation.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingAutomation(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    AI Inference Provider
                  </label>
                  <SearchableSelect
                    value={editingProvider}
                    onChange={(val) => {
                      const p = String(val);
                      setEditingProvider(p);
                      setEditingModel(
                        p === "ollama" ? "llama3.2:1b"
                        : p === "gemini" ? "gemini-1.5-flash"
                        : p === "openai" ? "gpt-4o-mini"
                        : p === "anthropic" ? "claude-3-5-sonnet"
                        : "mock-llama3-synthetic"
                      );
                    }}
                    placeholder="Select AI inference provider..."
                    options={[
                      { value: "ollama", label: "Ollama (Local LLM) - Zero Cost", badge: "Local" },
                      { value: "gemini", label: "Google Gemini (Cloud Fast)", badge: "Cloud" },
                      { value: "anthropic", label: "Anthropic Claude (Cloud Smart)", badge: "Cloud" },
                      { value: "openai", label: "OpenAI (GPT-4o)", badge: "Cloud" },
                      { value: "mock", label: "Local Mock (Offline Synthetic)", badge: "Synthetic" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Model Tag / Identifier
                  </label>
                  <input
                    type="text"
                    value={editingModel}
                    onChange={(e) => setEditingModel(e.target.value)}
                    placeholder="e.g. llama3.2:1b, llama3:latest, gemini-1.5-flash"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Installed Ollama models: <code>llama3.2:1b</code> (Fast CPU), <code>llama3:latest</code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Prompt Context & Themes
                  </label>
                  <textarea
                    rows={3}
                    value={editingPrompt}
                    onChange={(e) => setEditingPrompt(e.target.value)}
                    placeholder="e.g. Meat • Food • Healthy Food • Diet Food"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingAutomation(null)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingModal}
                  onClick={async () => {
                    try {
                      setIsSavingModal(true);
                      await api.updateAutomation(editingAutomation.id, {
                        ai_provider: editingProvider,
                        ai_model: editingModel,
                        prompt_context: editingPrompt,
                      });
                      toast.success("AI Configuration Updated", `Automation #${editingAutomation.id} updated to ${editingProvider} (${editingModel}).`);
                      setEditingAutomation(null);
                      loadData();
                    } catch (err: any) {
                      toast.error("Update Failed", err.message);
                    } finally {
                      setIsSavingModal(false);
                    }
                  }}
                  className="btn-primary-gradient px-4 py-1.5 text-white rounded-xl text-xs font-bold transition shadow-xs"
                >
                  {isSavingModal ? "Saving..." : "Save AI Settings"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
