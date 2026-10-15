import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Workflow, Plus, Play, Pause, Trash2, Database, Clock, CheckCircle, AlertCircle, Zap, RefreshCw, Cpu, Settings } from "lucide-react";
import { api } from "../services/api";
import { StatusPill } from "../components/common/StatusPill";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useToast } from "../context/ToastContext";
import { actionBridge } from "../services/actionBridge";
import { pageStateService } from "../services/pageStateService";

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
  const { toast, showAlert } = useToast();

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

    const unsubs = [
      actionBridge.on("automations.navigate_create", () => {
        navigate("/automations/new");
        return { status: "ok" };
      }),
      actionBridge.on("automations.trigger_run", async (payload: any) => {
        if (payload?.id) {
          await handleTrigger(payload.id);
          return { status: "ok" };
        }
        return { status: "validation_error", error: "Missing automation id" };
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [navigate]);

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

  const handleDelete = (id: number) => {
    showAlert({
      title: "Delete Automation Pipeline?",
      text: "Are you sure you want to delete this automation pipeline? Any scheduled runs will be cancelled.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Delete",
      cancelButtonText: "Cancel",
      onConfirm: async () => {
        try {
          await api.deleteAutomation(id);
          toast.success("Automation Deleted", "The automation pipeline has been removed.");
          loadData();
        } catch (err: any) {
          toast.error("Delete Failed", err.message);
        }
      },
    });
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
            const opMode = a.operation_mode || a.mode || "AI_CREATE";
            const genTime = a.generation_time || a.schedule_config?.generation_time || "--:--";
            const pubTime = a.publication_time || a.schedule_config?.publication_time || "--:--";
            const tz = a.timezone || a.schedule_config?.timezone || "UTC";
            const reviewer = a.reviewer_email || a.approval_policy?.reviewer_email || "Not configured";

            return (
              <motion.div
                key={a.id}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="bg-white border border-slate-200/90 hover:border-indigo-300 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition shadow-xs hover:shadow-md hover:shadow-indigo-500/5 group"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition-colors">
                      {a.name}
                    </h4>
                    <StatusPill status={isActive ? "ACTIVE" : "PAUSED"} size="sm" />
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-700 font-medium">
                      v{a.version || 1}
                    </span>
                    {a.ai_provider && a.ai_provider !== "none" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <Cpu className="w-3 h-3 text-indigo-600" />
                        <span>AI: {a.ai_provider === "ollama" ? "Ollama (Local)" : a.ai_provider} ({a.ai_model || "default"})</span>
                      </span>
                    )}
                  </div>

                  {a.prompt_context && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 max-w-2xl">
                      <span className="font-semibold text-indigo-900 shrink-0">Topic Prompt:</span>
                      <span className="truncate italic">"{a.prompt_context}"</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <Database className="w-3.5 h-3.5 text-indigo-600" />
                      Target: <strong className="text-indigo-600 font-bold">{a.target_table}</strong>
                    </span>
                    <span>•</span>
                    <span>Mode: <strong className="text-slate-800">{opMode}</strong></span>
                    <span>•</span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Gen: {genTime} | Pub: {pubTime} ({tz})
                    </span>
                    <span>•</span>
                    <span>Reviewer: {reviewer}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-center">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    disabled={runningId === a.id}
                    onClick={() => handleTrigger(a.id)}
                    className="btn-primary-gradient flex items-center gap-1.5 px-3.5 py-2 text-white rounded-lg text-xs font-semibold transition shadow-xs cursor-pointer"
                    title="Trigger execution"
                  >
                    {runningId === a.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{runningId === a.id ? "Running..." : "Run Now"}</span>
                  </motion.button>

                  <button
                    onClick={() => {
                      setEditingAutomation(a);
                      setEditingProvider(a.ai_provider && a.ai_provider !== "none" ? a.ai_provider : "ollama");
                      setEditingModel(a.ai_model && a.ai_model !== "default" ? a.ai_model : "llama3.2:1b");
                      setEditingPrompt(a.prompt_context || "");
                    }}
                    className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs transition shadow-2xs cursor-pointer"
                    title="Configure AI Model & Prompt"
                  >
                    <Settings className="w-4 h-4 text-indigo-600" />
                  </button>

                  <button
                    onClick={() => handleToggleStatus(a)}
                    className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs transition shadow-2xs cursor-pointer"
                    title={isActive ? "Pause Automation" : "Resume Automation"}
                  >
                    {isActive ? <Pause className="w-4 h-4 text-amber-600" /> : <Play className="w-4 h-4 text-emerald-600" />}
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
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
