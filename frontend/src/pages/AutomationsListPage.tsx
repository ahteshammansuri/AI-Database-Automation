import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Clock, Cpu, Database, FileText, History, Mail, Pause, Play, Plus, RefreshCw, Settings, Trash2, Workflow, X } from "lucide-react";
import { api } from "../services/api";
import { Card, EmptyState, FieldError, FormAlert, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { ariaFor, clearError, focusFirstError, invalid, rules, serverFieldErrors, validate, type FieldErrors } from "../lib/validation";
import { SpotlightCard } from "../components/landing/primitives";
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
  const [modalErrors, setModalErrors] = useState<FieldErrors>({});
  const [modalError, setModalError] = useState<string | null>(null);
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

  const MODEL_FIELD_ID: Record<string, string> = { ai_model: "auto-model", prompt_context: "auto-topic" };

  function closeModelModal() {
    setEditingAutomation(null);
    setModalErrors({});
    setModalError(null);
  }

  async function saveModelModal(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAutomation) return;
    setModalError(null);
    const aiWrites = editingAutomation.operation_mode !== "MANUAL_SCHEDULE";
    const found = validate({ ai_model: editingModel, prompt_context: editingPrompt }, {
      ai_model: [rules.maxLength(120, "Model")],
      prompt_context: [...(aiWrites ? [rules.required("Topic", "Describe what the content should be about.")] : []), rules.maxLength(4000, "Topic")],
    });
    setModalErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, (f) => MODEL_FIELD_ID[f]);
      return;
    }
    try {
      setIsSavingModal(true);
      await api.updateAutomation(editingAutomation.id, {
        ai_provider: editingProvider,
        ai_model: editingModel.trim(),
        prompt_context: editingPrompt.trim(),
      });
      toast.success("AI Configuration Updated", `Automation #${editingAutomation.id} updated to ${editingProvider}${editingModel.trim() ? ` (${editingModel.trim()})` : ""}.`);
      closeModelModal();
      loadData();
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      const placed = Object.fromEntries(Object.entries(fields).filter(([f]) => MODEL_FIELD_ID[f]));
      if (Object.keys(placed).length) {
        setModalErrors(placed);
        focusFirstError(placed, (f) => MODEL_FIELD_ID[f]);
      } else {
        setModalError(err.message || "Could not save the changes.");
      }
    } finally {
      setIsSavingModal(false);
    }
  }

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

  const stateOf = (a: any): string => a.schedule_summary?.state ?? ((a.is_active !== undefined ? a.is_active : a.status === "ACTIVE") ? "ACTIVE" : "PAUSED");
  const summary = automations.reduce(
    (acc: Record<string, number>, a: any) => {
      const st = stateOf(a);
      acc[st] = (acc[st] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automate"
        title="Automations"
        description="Recurring pipelines that write content with your model, get a person's OK, and publish into your tables on time."
        actions={
          <Link to="/automations/new" className="da-btn da-btn-primary">
            <Plus className="h-4 w-4" /> New automation
          </Link>
        }
      />

      {automations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            { key: "ACTIVE", label: "Active", cls: "da-chip-emerald" },
            { key: "SCHEDULED", label: "Starting soon", cls: "da-chip-sky" },
            { key: "PAUSED", label: "Paused", cls: "da-chip-amber" },
            { key: "COMPLETED", label: "Finished", cls: "da-chip-slate" },
            { key: "MANUAL", label: "Manual publishing", cls: "da-chip-violet" },
          ]
            .filter((x) => summary[x.key])
            .map((x) => (
              <span key={x.key} className={`da-chip ${x.cls} px-3 py-1 text-[12px]`}>
                {x.label} <span className="font-bold">{summary[x.key]}</span>
              </span>
            ))}
          <span className="da-chip da-chip-slate px-3 py-1 text-[12px]">Total <span className="font-bold">{automations.length}</span></span>
        </div>
      )}

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-[13px] ${
              actionMsg.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span>{actionMsg.text}</span>
            <button type="button" onClick={() => setActionMsg(null)} className="da-icon-btn h-7 w-7" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && automations.length === 0 ? (
        <Card><Loading label="Loading automations…" /></Card>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="Build your first AI-written or manual publishing pipeline. DataAuto will write, ask for approval and publish on schedule."
          action={<Link to="/automations/new" className="da-btn da-btn-primary"><Plus className="h-4 w-4" /> Create automation</Link>}
        />
      ) : (
        <div className="space-y-4">
          {automations.map((a, idx) => {
            const isActive = a.is_active !== undefined ? a.is_active : (a.status === "ACTIVE");
            const sum = a.schedule_summary ?? null;
            const tz = sum?.timezone || a.timezone || "UTC";
            const state: string = stateOf(a);
            const isManualContainer = state === "MANUAL";
            const stateChip: Record<string, string> = {
              ACTIVE: "da-chip-emerald", SCHEDULED: "da-chip-sky", FINISHING: "da-chip-amber", COMPLETED: "da-chip-slate", PAUSED: "da-chip-amber", MANUAL: "da-chip-violet",
            };
            const stateLabel: Record<string, string> = {
              ACTIVE: "Active", SCHEDULED: "Starts soon", FINISHING: "Last run in progress", COMPLETED: "Finished", PAUSED: "Paused", MANUAL: "Manual publishing",
            };
            const freq = sum?.frequency === "ONE_TIME" ? "One time" : sum?.frequency === "WEEKLY" ? "Weekly" : sum?.frequency === "DAILY" ? "Daily" : null;
            const progress = sum?.total_runs ? Math.round(((sum.finished_runs ?? 0) / sum.total_runs) * 100) : null;

            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: Math.min(idx, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                ref={(el: HTMLDivElement | null) =>
                  el ? orbitTargets.register(`automations.row.${a.id}`, el) : orbitTargets.unregister(`automations.row.${a.id}`)
                }
              >
                <SpotlightCard className="shadow-soft">
                  <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 gap-4">
                      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_10px_24px_-10px_rgba(99,102,241,0.8)] ${
                        isManualContainer ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" : state === "PAUSED" ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400"
                      }`}>
                        {isManualContainer ? <FileText className="h-5 w-5" /> : <Workflow className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-[16px] font-bold tracking-[-0.01em] text-slate-950">{a.name}</h4>
                          <span className={`da-chip ${stateChip[state] ?? "da-chip-emerald"}`}>
                            {state === "COMPLETED" && <CheckCircle className="h-3 w-3" />}
                            {stateLabel[state] ?? state}
                          </span>
                          {freq && <span className="da-chip da-chip-slate">{freq}</span>}
                          {a.ai_provider && a.ai_provider !== "none" && (
                            <span className="da-chip da-chip-indigo"><Cpu className="h-3 w-3" /> {a.ai_provider}{a.ai_model ? ` · ${a.ai_model}` : ""}</span>
                          )}
                        </div>
                        {sum?.description && <p className="max-w-3xl text-[13.5px] leading-relaxed text-slate-600">{sum.description}</p>}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <Database className="h-3.5 w-3.5 text-indigo-500" />
                            <code className="font-semibold text-indigo-700">{a.target_table}</code>
                            {a.connection?.name && <span className="text-slate-400">in {a.connection.name}</span>}
                          </span>
                          {!isManualContainer && sum?.next_run && state !== "PAUSED" && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-slate-400" />
                              Next <strong className="font-semibold text-slate-800">{formatInstant(sum.next_run.generation_at, tz, { withYear: false })}</strong>
                              <span className="text-slate-400">({relativeFromNow(sum.next_run.generation_at)})</span>
                            </span>
                          )}
                          {state === "COMPLETED" && sum?.completed_at && (
                            <span className="flex items-center gap-1.5 text-slate-600">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> Finished {formatInstant(sum.completed_at, tz, { withYear: false })}
                            </span>
                          )}
                          {a.requires_approval && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-400" /> Reviewed by {a.reviewer_email || "email"}</span>}
                        </div>
                        {progress !== null ? (
                          <div className="flex max-w-sm items-center gap-3 pt-0.5">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" style={{ width: `${progress}%` }} />
                            </span>
                            <span className="shrink-0 text-[12px] text-slate-500">{sum.finished_runs ?? 0} of {sum.total_runs} runs</span>
                          </div>
                        ) : !isManualContainer && sum ? (
                          <div className="text-[12px] text-slate-500">{sum.finished_runs ?? 0} run{(sum.finished_runs ?? 0) === 1 ? "" : "s"} so far</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-stretch sm:self-end lg:self-center">
                      {!isManualContainer && state !== "COMPLETED" && (
                        <button
                          type="button"
                          disabled={runningId === a.id}
                          onClick={() => handleTrigger(a.id)}
                          className="da-btn da-btn-primary flex-1 sm:flex-none"
                          title="Write one run now (it publishes after the usual review window)"
                        >
                          {runningId === a.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          {runningId === a.id ? "Starting…" : "Run now"}
                        </button>
                      )}
                      <Link to={`/executions?automation=${a.id}`} className="da-btn da-btn-secondary" title="Run history">
                        <History className="h-3.5 w-3.5 text-slate-500" /> History
                      </Link>
                      {!isManualContainer && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAutomation(a);
                            setEditingProvider(a.ai_provider && a.ai_provider !== "none" ? a.ai_provider : "ollama");
                            setEditingModel(a.ai_model && a.ai_model !== "default" ? a.ai_model : "");
                            setEditingPrompt(a.prompt_context || "");
                          }}
                          className="da-icon-btn border border-slate-200 bg-white"
                          title="Change model and topic"
                          aria-label="Change model and topic"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      )}
                      {!isManualContainer && state !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(a)}
                          className="da-icon-btn border border-slate-200 bg-white"
                          title={isActive ? "Pause" : "Resume"}
                          aria-label={isActive ? "Pause" : "Resume"}
                        >
                          {isActive ? <Pause className="h-4 w-4 text-amber-600" /> : <Play className="h-4 w-4 text-emerald-600" />}
                        </button>
                      )}
                      <button type="button" onClick={() => handleDelete(a.id)} className="da-icon-btn hover:bg-rose-50 hover:text-rose-600" title="Delete" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            );
          })}
        </div>
      )}

      <ModalShell
        open={!!editingAutomation}
        onClose={closeModelModal}
        icon={Cpu}
        title="Model and topic"
        description={editingAutomation?.name}
        footer={
          <>
            <button type="button" onClick={closeModelModal} className="da-btn da-btn-ghost">Cancel</button>
            <button
              type="submit"
              form="automation-model-form"
              disabled={isSavingModal}
              className="da-btn da-btn-primary"
            >
              {isSavingModal ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="automation-model-form" onSubmit={saveModelModal} noValidate className="space-y-4">
          <FormAlert message={modalError} onClose={() => setModalError(null)} />
          <div>
            <span className="da-label">Provider</span>
            <SearchableSelect
              value={editingProvider}
              onChange={(val) => {
                const p = String(val);
                setEditingProvider(p);
                setModalErrors((x) => clearError(x, "ai_model"));
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
            <label className="da-label" htmlFor="auto-model">Model</label>
            <input id="auto-model" type="text" value={editingModel} onChange={(e) => { setEditingModel(e.target.value); setModalErrors((x) => clearError(x, "ai_model")); }}
              placeholder="e.g. llama3.2:1b, qwen2.5:3b, gemini-1.5-flash" className={`da-input font-mono${invalid(modalErrors.ai_model)}`} {...ariaFor("auto-model", modalErrors.ai_model)} />
            <FieldError id="auto-model" message={modalErrors.ai_model} />
            {!modalErrors.ai_model && <p className="da-help">For Ollama, use a model you have pulled on this machine. Leave empty for the provider's default.</p>}
          </div>
          <div>
            <label className="da-label" htmlFor="auto-topic">Topic and themes</label>
            <textarea id="auto-topic" rows={3} value={editingPrompt} onChange={(e) => { setEditingPrompt(e.target.value); setModalErrors((x) => clearError(x, "prompt_context")); }}
              placeholder="e.g. Healthy eating · simple recipes · meal prep" className={`da-input${invalid(modalErrors.prompt_context)}`} {...ariaFor("auto-topic", modalErrors.prompt_context)} />
            <FieldError id="auto-topic" message={modalErrors.prompt_context} />
          </div>
        </form>
      </ModalShell>
    </div>
  );
};
