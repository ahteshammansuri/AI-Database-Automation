import React, { useEffect, useState } from "react";
import { useOrbitSurface } from "../../hooks/useOrbitSurface";
import { orbitTargets } from "../../services/orbitTargets";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, AlertCircle, BrainCircuit, CheckCircle2, FileEdit, FlaskConical, Info, Loader2, Save, Sparkles, XCircle } from "lucide-react";
import { api } from "../../services/api";
import { FieldError } from "../ui/kit";
import { invalid, rules, serverFieldErrors, validateField } from "../../lib/validation";

interface ModelRoleItem {
  role: string;
  label: string;
  description: string;
  provider: string;
  model_name: string;
  temperature: number;
  temperature_hint?: string;
  is_active: boolean;
  recommended_models: string[];
  is_customized?: boolean;
}

interface ReadinessResult {
  status: string;
  overall_score?: number;
  message?: string;
  recommendation?: string | null;
  tests?: Record<string, { label?: string; passed: boolean; details: string; seconds?: number }>;
}

const PROVIDERS = [
  { value: "ollama", label: "Ollama (on this machine, free)" },
  { value: "openai", label: "OpenAI (your key)" },
  { value: "gemini", label: "Google Gemini (your key)" },
  { value: "anthropic", label: "Anthropic Claude (your key)" },
];

/** Temperature in plain words: three presets per job (the server applies the value to that job's model calls). */
const PRESETS: Record<string, { label: string; value: number; note: string }[]> = {
  planner: [
    { label: "Precise", value: 0, note: "Same answer every time" },
    { label: "Balanced", value: 0.2, note: "Recommended" },
    { label: "Flexible", value: 0.5, note: "More varied wording" },
  ],
  generator: [
    { label: "Predictable", value: 0.3, note: "Close to your topic" },
    { label: "Balanced", value: 0.7, note: "Recommended" },
    { label: "Creative", value: 1.0, note: "Bolder, more varied" },
  ],
};

const ROLE_ICON: Record<string, React.ElementType> = { planner: BrainCircuit, generator: FileEdit };

export const ModelRolesSection: React.FC = () => {
  const [roles, setRoles] = useState<ModelRoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [customInputRoles, setCustomInputRoles] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [probingRole, setProbingRole] = useState<string | null>(null);
  const [testingRole, setTestingRole] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, { available: boolean; latency_ms?: number; message?: string }>>({});
  const [readiness, setReadiness] = useState<Record<string, ReadinessResult>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [statusFeedback, setStatusFeedback] = useState<Record<string, { type: "success" | "error"; text: string } | undefined>>({});

  const loadRoles = async () => {
    try {
      setLoading(true);
      const [rolesRes, providersRes] = await Promise.allSettled([api.listModelRoles(), api.listAIProviders()]);
      if (rolesRes.status === "fulfilled" && rolesRes.value.success && Array.isArray(rolesRes.value.roles)) {
        setRoles(rolesRes.value.roles);
        if (rolesRes.value.provider_models) setProviderModels((prev) => ({ ...prev, ...rolesRes.value.provider_models }));
      }
      if (providersRes.status === "fulfilled" && Array.isArray(providersRes.value)) {
        setProviderModels((prev) => {
          const merged = { ...prev };
          for (const p of providersRes.value) {
            if (p.provider_id && Array.isArray(p.models) && p.models.length) merged[p.provider_id] = Array.from(new Set([...(merged[p.provider_id] || []), ...p.models]));
          }
          return merged;
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const handleFieldChange = (roleKey: string, field: keyof ModelRoleItem, value: any) => {
    if (field === "model_name") setModelErrors((prev) => (prev[roleKey] ? { ...prev, [roleKey]: "" } : prev));
    setRoles((prev) => prev.map((r) => (r.role === roleKey ? { ...r, [field]: value } : r)));
  };

  const handleProviderChange = (roleKey: string, newProvider: string) => {
    const available = providerModels[newProvider] || [];
    setModelErrors((prev) => (prev[roleKey] ? { ...prev, [roleKey]: "" } : prev));
    setRoles((prev) => prev.map((r) => (r.role === roleKey ? { ...r, provider: newProvider, model_name: available[0] || "" } : r)));
  };

  const MODEL_RULES = { model_name: [rules.required("Model", "Choose or type the model for this job."), rules.maxLength(64, "Model")] };

  const handleSaveRole = async (roleItem: ModelRoleItem) => {
    const problem = validateField("model_name", { model_name: roleItem.model_name }, MODEL_RULES);
    if (problem) {
      setModelErrors((prev) => ({ ...prev, [roleItem.role]: problem }));
      document.getElementById(`role-model-${roleItem.role}`)?.focus();
      return false;
    }
    try {
      setSavingRole(roleItem.role);
      setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: undefined }));
      await api.updateModelRole({
        role: roleItem.role,
        provider: roleItem.provider,
        model_name: roleItem.model_name,
        temperature: Number(roleItem.temperature),
        is_active: roleItem.is_active,
      });
      setRoles((prev) => prev.map((r) => (r.role === roleItem.role ? { ...r, is_customized: true } : r)));
      setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: { type: "success", text: "Saved. New requests use this model." } }));
      setTimeout(() => setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: undefined })), 3500);
      return true;
    } catch (err: any) {
      const fieldMsg = serverFieldErrors(err).model_name;
      if (fieldMsg) setModelErrors((prev) => ({ ...prev, [roleItem.role]: fieldMsg }));
      else setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: { type: "error", text: err.message || "Could not save." } }));
      return false;
    } finally {
      setSavingRole(null);
    }
  };

  const handleProbeRole = async (roleItem: ModelRoleItem) => {
    const problem = validateField("model_name", { model_name: roleItem.model_name }, MODEL_RULES);
    if (problem) {
      setModelErrors((prev) => ({ ...prev, [roleItem.role]: problem }));
      return;
    }
    try {
      setProbingRole(roleItem.role);
      const res = await api.probeModelRole({ provider: roleItem.provider, model_name: roleItem.model_name });
      setProbeResults((prev) => ({ ...prev, [roleItem.role]: { available: res.available, latency_ms: res.latency_ms, message: res.message } }));
      if (Array.isArray(res.models) && res.models.length) {
        setProviderModels((prev) => ({ ...prev, [roleItem.provider]: Array.from(new Set([...(prev[roleItem.provider] || []), ...res.models])) }));
      }
    } catch (err: any) {
      setProbeResults((prev) => ({ ...prev, [roleItem.role]: { available: false, message: err.message || "Check failed" } }));
    } finally {
      setProbingRole(null);
    }
  };

  const handleReadiness = async (roleItem: ModelRoleItem) => {
    try {
      setTestingRole(roleItem.role);
      setReadiness((prev) => ({ ...prev, [roleItem.role]: { status: "running" } }));
      const res = await api.modelReadinessTest({ provider: roleItem.provider, model_name: roleItem.model_name });
      setReadiness((prev) => ({ ...prev, [roleItem.role]: res }));
    } catch (err: any) {
      setReadiness((prev) => ({ ...prev, [roleItem.role]: { status: "error", message: err.message } }));
    } finally {
      setTestingRole(null);
    }
  };

  // Orbit surface: per-role fields and actions (row = role key: planner or generator).
  useOrbitSurface("providers.roles", () => {
    const find = (row?: string) => roles.find((r) => r.role === row);
    return {
      describe: () => roles.map((r) => ({ id: r.role, label: r.label, provider: r.provider, model: r.model_name, temperature: r.temperature, probe: probeResults[r.role]?.message })),
      fields: {
        provider: {
          get: (row) => find(row)?.provider,
          set: (v, row) => { if (!find(row)) return `No job '${row}'.`; if (!PROVIDERS.some((p) => p.value === String(v))) return "Use ollama, openai, gemini or anthropic."; handleProviderChange(row!, String(v)); return null; },
          options: () => PROVIDERS,
          target: (row) => `providers.roles.row.${row}`,
        },
        model_name: {
          get: (row) => find(row)?.model_name,
          set: (v, row) => { const t = String(v ?? "").trim(); if (!find(row)) return `No job '${row}'.`; if (!t) return "Model is required."; handleFieldChange(row!, "model_name", t); return null; },
          options: (row) => (providerModels[find(row)?.provider || "ollama"] || []).map((m) => ({ value: m, label: m })),
          target: (row) => `providers.roles.row.${row}`,
        },
        temperature: {
          get: (row) => find(row)?.temperature,
          set: (v, row) => { const n = Number(v); if (!find(row)) return `No job '${row}'.`; const max = row === "planner" ? 1 : 1.5; if (!Number.isFinite(n) || n < 0 || n > max) return `Use a number from 0 to ${max}.`; handleFieldChange(row!, "temperature", n); return null; },
          target: (row) => `providers.roles.row.${row}`,
        },
      },
      actions: {
        probe: {
          target: (row) => `providers.roles.row.${row}`,
          run: async (row) => {
            const r = find(row);
            if (!r) return { success: false, message: `No job '${row}'.` };
            const res = await api.probeModelRole({ provider: r.provider, model_name: r.model_name }).catch((e: any) => ({ available: false, message: e.message }));
            setProbeResults((prev) => ({ ...prev, [r.role]: { available: res.available, latency_ms: res.latency_ms, message: res.message } }));
            return { success: !!res.available, message: res.message || (res.available ? "The model answered." : "The model did not answer.") };
          },
        },
        save: {
          target: (row) => `providers.roles.row.${row}`,
          run: async (row) => {
            const r = find(row);
            if (!r) return { success: false, message: `No job '${row}'.` };
            const ok = await handleSaveRole(r);
            return ok ? { success: true, message: `Saved: ${r.label} now uses ${r.provider} / ${r.model_name}.` } : { success: false, message: "Saving failed; the reason is shown on the card." };
          },
        },
      },
    };
  });

  if (loading) {
    return (
      <div className="da-card p-8 text-center">
        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-indigo-600" />
        <p className="text-xs font-medium text-slate-500">Loading which model does which job…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="da-eyebrow"><span className="h-px w-5 bg-indigo-500/50" /> Model roles</span>
        <h3 className="mt-2 flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-slate-950">
          <Sparkles className="h-5 w-5 text-indigo-600" /> Which model does which job
        </h3>
        <p className="mt-1 text-[13.5px] text-slate-500">
          Two jobs use a model. Pick the provider and model for each; an automation can still choose its own writing model.
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 text-[12.5px] leading-relaxed text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p>
          <strong>Creativity (temperature)</strong> controls how much the model varies its words. Low values give the same,
          predictable answer each time, which is best for Orbit's decisions. Higher values give more varied, natural
          writing, which suits articles. Questions about your data always use the most precise setting.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {roles.map((r) => {
          const Icon = ROLE_ICON[r.role] ?? Sparkles;
          const probe = probeResults[r.role];
          const feedback = statusFeedback[r.role];
          const ready = readiness[r.role];
          const availableModels = providerModels[r.provider] || [];
          const isCustomMode = customInputRoles[r.role] || false;
          const presets = PRESETS[r.role] ?? PRESETS.generator;
          const maxTemp = r.role === "planner" ? 1 : 1.5;

          return (
            <motion.div
              ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(`providers.roles.row.${r.role}`, el) : orbitTargets.unregister(`providers.roles.row.${r.role}`))}
              key={r.role}
              className="da-card flex flex-col justify-between space-y-4 p-5"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl border border-indigo-100 bg-indigo-50"><Icon className="h-5 w-5 text-indigo-600" /></div>
                    <h4 className="text-[15px] font-bold text-slate-900">{r.label}</h4>
                  </div>
                  {r.is_customized && <span className="da-chip da-chip-indigo px-2 py-0.5 text-[10px]">Your choice</span>}
                </div>
                <p className="text-[12.5px] leading-relaxed text-slate-600">{r.description}</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`role-provider-${r.role}`} className="da-label">Provider</label>
                    <select id={`role-provider-${r.role}`} value={r.provider} onChange={(e) => handleProviderChange(r.role, e.target.value)} className="da-input cursor-pointer py-2 text-[12.5px]">
                      {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label htmlFor={`role-model-${r.role}`} className="text-[12px] font-semibold text-slate-600">Model</label>
                      <button type="button" onClick={() => setCustomInputRoles((prev) => ({ ...prev, [r.role]: !prev[r.role] }))} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800">
                        {isCustomMode ? "Choose from list" : "Type a name"}
                      </button>
                    </div>
                    {isCustomMode || availableModels.length === 0 ? (
                      <input id={`role-model-${r.role}`} type="text" value={r.model_name} onChange={(e) => handleFieldChange(r.role, "model_name", e.target.value)} placeholder="e.g. qwen2.5:7b"
                        aria-invalid={!!modelErrors[r.role]} aria-describedby={modelErrors[r.role] ? `role-model-${r.role}-error` : undefined}
                        className={`da-input py-2 font-mono text-[12.5px]${invalid(modelErrors[r.role])}`} />
                    ) : (
                      <select id={`role-model-${r.role}`} value={r.model_name} onChange={(e) => handleFieldChange(r.role, "model_name", e.target.value)}
                        aria-invalid={!!modelErrors[r.role]} aria-describedby={modelErrors[r.role] ? `role-model-${r.role}-error` : undefined}
                        className={`da-input cursor-pointer py-2 font-mono text-[12.5px]${invalid(modelErrors[r.role])}`}>
                        {!availableModels.includes(r.model_name) && r.model_name && <option value={r.model_name}>{r.model_name} (current)</option>}
                        {availableModels.map((mod) => <option key={mod} value={mod}>{mod}</option>)}
                      </select>
                    )}
                    <FieldError id={`role-model-${r.role}`} message={modelErrors[r.role]} />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-slate-600">Creativity</span>
                    <span className="font-mono text-[11px] text-slate-500">temperature {Number(r.temperature).toFixed(2)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label={`${r.label} creativity`}>
                    {presets.map((p) => {
                      const on = Math.abs(Number(r.temperature) - p.value) < 0.001;
                      return (
                        <button key={p.label} type="button" role="radio" aria-checked={on} onClick={() => handleFieldChange(r.role, "temperature", p.value)}
                          className={`rounded-xl px-2 py-1.5 text-left transition ${on ? "bg-white shadow-xs" : "hover:bg-white/60"}`}>
                          <span className={`block text-[12.5px] font-semibold ${on ? "text-slate-950" : "text-slate-600"}`}>{p.label}</span>
                          <span className="block text-[10.5px] text-slate-500">{p.note}</span>
                        </button>
                      );
                    })}
                  </div>
                  <input type="range" min={0} max={maxTemp} step={0.05} value={r.temperature} aria-label={`${r.label} temperature`}
                    onChange={(e) => handleFieldChange(r.role, "temperature", parseFloat(e.target.value))} className="mt-2 w-full cursor-pointer accent-indigo-600" />
                  {r.temperature_hint && <p className="mt-1 text-[11.5px] text-slate-500">{r.temperature_hint}</p>}
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleProbeRole(r)} disabled={probingRole === r.role} className="da-btn da-btn-secondary flex-1">
                    <Activity className={`h-3.5 w-3.5 ${probingRole === r.role ? "animate-spin text-indigo-600" : ""}`} />
                    {probingRole === r.role ? "Checking…" : "Check connection"}
                  </button>
                  <button type="button" onClick={() => handleSaveRole(r)} disabled={savingRole === r.role} className="da-btn da-btn-primary flex-1">
                    <Save className="h-3.5 w-3.5" /> {savingRole === r.role ? "Saving…" : "Save"}
                  </button>
                </div>
                {r.role === "planner" && (
                  <button type="button" onClick={() => handleReadiness(r)} disabled={testingRole === r.role} className="da-btn da-btn-ghost w-full border border-dashed border-indigo-200 text-indigo-700 hover:bg-indigo-50">
                    {testingRole === r.role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    {testingRole === r.role ? "Running 4 real tasks… (up to a few minutes on a local model)" : "Test with real tasks"}
                  </button>
                )}

                <AnimatePresence>
                  {probe && (
                    <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-[11.5px] ${probe.available ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                      {probe.available ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />}
                      <span>{probe.available ? `Connected${probe.latency_ms ? ` · answered in ${Math.round(probe.latency_ms)} ms` : ""}` : probe.message || "The model did not answer."}</span>
                    </motion.p>
                  )}
                  {ready && ready.status !== "running" && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[12px]">
                      {ready.tests && Object.keys(ready.tests).length > 0 ? (
                        <>
                          <p className="font-semibold text-slate-900">{ready.overall_score === 100 ? "Ready: all 4 tasks done right" : `${ready.overall_score}% of the tasks done right`}</p>
                          {Object.entries(ready.tests).map(([k, t]) => (
                            <p key={k} className="flex items-start gap-1.5">
                              {t.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                              <span><span className="font-medium text-slate-800">{t.label ?? k}</span> <span className="text-slate-500">· {t.details}{t.seconds ? ` (${t.seconds}s)` : ""}</span></span>
                            </p>
                          ))}
                          {ready.recommendation && <p className="pt-1 text-amber-800">{ready.recommendation}</p>}
                        </>
                      ) : (
                        <p className="text-rose-700">{ready.message || "The test could not run."}</p>
                      )}
                    </motion.div>
                  )}
                  {feedback && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-[11.5px] font-medium ${feedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                      {feedback.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />}
                      <span>{feedback.text}</span>
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
