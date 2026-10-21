import React, { useEffect, useState } from "react";
import { useOrbitSurface } from "../../hooks/useOrbitSurface";
import { orbitTargets } from "../../services/orbitTargets";
import { motion, AnimatePresence } from "framer-motion";
import {
  BrainCircuit,
  FileEdit,
  Layers,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Save,
  Activity,
  Sparkles,
} from "lucide-react";
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
  max_tokens?: number | null;
  is_active: boolean;
  recommended_models: string[];
  is_customized?: boolean;
}

const DEFAULT_PROVIDER_MODELS: Record<string, string[]> = {
  gemini: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
  ollama: ["llama3.2:1b", "qwen2.5:3b", "llama3:latest", "mistral:7b"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  anthropic: ["claude-3-5-sonnet", "claude-3-5-haiku-latest"],
  mock: ["mock-llama3-synthetic", "mock-mistral-synthetic"],
};

export const ModelRolesSection: React.FC = () => {
  const [roles, setRoles] = useState<ModelRoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>(DEFAULT_PROVIDER_MODELS);
  const [customInputRoles, setCustomInputRoles] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [probingRole, setProbingRole] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, { available: boolean; latency_ms?: number; message?: string }>>({});
  // Message under each role's model input (keyed by role).
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [statusFeedback, setStatusFeedback] = useState<Record<string, { type: "success" | "error"; text: string }>>({});

  const loadRoles = async () => {
    try {
      setLoading(true);
      const [rolesRes, providersRes] = await Promise.allSettled([
        api.listModelRoles(),
        api.listAIProviders(),
      ]);

      if (rolesRes.status === "fulfilled" && rolesRes.value.success && Array.isArray(rolesRes.value.roles)) {
        setRoles(rolesRes.value.roles);
        if (rolesRes.value.provider_models) {
          setProviderModels((prev) => ({ ...prev, ...rolesRes.value.provider_models }));
        }
      }

      if (providersRes.status === "fulfilled" && Array.isArray(providersRes.value)) {
        const liveMap: Record<string, string[]> = {};
        for (const p of providersRes.value) {
          if (p.provider_id && Array.isArray(p.models) && p.models.length > 0) {
            liveMap[p.provider_id] = p.models;
          }
        }
        if (Object.keys(liveMap).length > 0) {
          setProviderModels((prev) => {
            const merged = { ...prev };
            for (const [k, v] of Object.entries(liveMap)) {
              merged[k] = Array.from(new Set([...(merged[k] || []), ...v]));
            }
            return merged;
          });
        }
      }
    } catch (err: any) {
      console.error("Failed to load model roles:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  // Orbit surface: per-role fields and actions (row = role key, e.g. "planner").
  useOrbitSurface("providers.roles", () => {
    const find = (row?: string) => roles.find((r) => r.role === row);
    const save = async (row?: string) => {
      const r = find(row);
      if (!r) return { success: false, message: `No role '${row}'.` };
      await handleSaveRole(r);
      return { success: true, message: `Saved: ${r.role} now uses ${r.provider} / ${r.model_name}.` };
    };
    return {
      describe: () => roles.map((r) => ({ id: r.role, label: r.label, provider: r.provider, model: r.model_name, probe: probeResults[r.role]?.message })),
      fields: {
        provider: {
          get: (row) => find(row)?.provider,
          set: (v, row) => { if (!find(row)) return `No role '${row}'.`; handleProviderChange(row!, String(v)); return null; },
          options: () => ["ollama", "openai", "gemini", "anthropic", "mock"].map((v) => ({ value: v, label: v })),
          target: (row) => `providers.roles.row.${row}`,
        },
        model_name: {
          get: (row) => find(row)?.model_name,
          set: (v, row) => { const t = String(v ?? "").trim(); if (!find(row)) return `No role '${row}'.`; if (!t) return "Model is required."; handleFieldChange(row!, "model_name", t); return null; },
          options: (row) => {
            const r = find(row);
            const prov = r?.provider || "ollama";
            return (providerModels[prov] || DEFAULT_PROVIDER_MODELS[prov] || []).map((m) => ({ value: m, label: m }));
          },
          target: (row) => `providers.roles.row.${row}`,
        },
      },
      actions: {
        probe: {
          target: (row) => `providers.roles.row.${row}`,
          run: async (row) => {
            const r = find(row);
            if (!r) return { success: false, message: `No role '${row}'.` };
            const res = await api.probeModelRole({ provider: r.provider, model_name: r.model_name }).catch((e: any) => ({ available: false, message: e.message }));
            setProbeResults((prev) => ({ ...prev, [r.role]: { available: res.available, latency_ms: res.latency_ms, message: res.message } }));
            return { success: !!res.available, message: res.message || (res.available ? "Model is available." : "Model is not available.") };
          },
        },
        save: { target: (row) => `providers.roles.row.${row}`, run: save },
      },
    };
  });

  const handleFieldChange = (roleKey: string, field: keyof ModelRoleItem, value: any) => {
    if (field === "model_name") setModelErrors((prev) => (prev[roleKey] ? { ...prev, [roleKey]: "" } : prev));
    setRoles((prev) =>
      prev.map((r) => (r.role === roleKey ? { ...r, [field]: value } : r))
    );
  };

  const handleProviderChange = (roleKey: string, newProvider: string) => {
    const available = providerModels[newProvider] || DEFAULT_PROVIDER_MODELS[newProvider] || [];
    let nextModel = available[0] || "";
    if (newProvider === "gemini") {
      nextModel = available.includes("gemini-3.5-flash-lite")
        ? "gemini-3.5-flash-lite"
        : (available[0] || "gemini-3.5-flash-lite");
    } else if (newProvider === "ollama") {
      nextModel = available.includes("llama3.2:1b")
        ? "llama3.2:1b"
        : (available[0] || "qwen2.5:3b");
    } else if (newProvider === "openai") {
      nextModel = available.includes("gpt-4o-mini")
        ? "gpt-4o-mini"
        : (available[0] || "gpt-4o-mini");
    } else if (newProvider === "anthropic") {
      nextModel = available.includes("claude-3-5-sonnet")
        ? "claude-3-5-sonnet"
        : (available[0] || "claude-3-5-sonnet");
    } else if (newProvider === "mock") {
      nextModel = "mock-llama3-synthetic";
    }

    setModelErrors((prev) => (prev[roleKey] ? { ...prev, [roleKey]: "" } : prev));
    setRoles((prev) =>
      prev.map((r) =>
        r.role === roleKey ? { ...r, provider: newProvider, model_name: nextModel } : r
      )
    );
  };

  const MODEL_RULES = { model_name: [rules.required("Model", "Choose or type the model for this role."), rules.maxLength(64, "Model")] };

  const handleSaveRole = async (roleItem: ModelRoleItem) => {
    const problem = validateField("model_name", { model_name: roleItem.model_name }, MODEL_RULES);
    if (problem) {
      setModelErrors((prev) => ({ ...prev, [roleItem.role]: problem }));
      document.getElementById(`role-model-${roleItem.role}`)?.focus();
      return;
    }
    try {
      setSavingRole(roleItem.role);
      setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: undefined as any }));

      await api.updateModelRole({
        role: roleItem.role,
        provider: roleItem.provider,
        model_name: roleItem.model_name,
        temperature: Number(roleItem.temperature),
        max_tokens: roleItem.max_tokens ? Number(roleItem.max_tokens) : undefined,
        is_active: roleItem.is_active,
      });

      setStatusFeedback((prev) => ({
        ...prev,
        [roleItem.role]: { type: "success", text: "Role assignment updated!" },
      }));

      setTimeout(() => {
        setStatusFeedback((prev) => ({ ...prev, [roleItem.role]: undefined as any }));
      }, 3500);
    } catch (err: any) {
      const fieldMsg = serverFieldErrors(err).model_name;
      if (fieldMsg) {
        setModelErrors((prev) => ({ ...prev, [roleItem.role]: fieldMsg }));
      } else {
        setStatusFeedback((prev) => ({
          ...prev,
          [roleItem.role]: { type: "error", text: err.message || "Failed to update role." },
        }));
      }
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
      const res = await api.probeModelRole({
        provider: roleItem.provider,
        model_name: roleItem.model_name,
      });
      setProbeResults((prev) => ({
        ...prev,
        [roleItem.role]: {
          available: res.available,
          latency_ms: res.latency_ms,
          message: res.message,
        },
      }));
      if (res.models && Array.isArray(res.models) && res.models.length > 0) {
        setProviderModels((prev) => ({
          ...prev,
          [roleItem.provider]: Array.from(new Set([...(prev[roleItem.provider] || []), ...res.models])),
        }));
      }
    } catch (err: any) {
      setProbeResults((prev) => ({
        ...prev,
        [roleItem.role]: {
          available: false,
          message: err.message || "Probe failed",
        },
      }));
    } finally {
      setProbingRole(null);
    }
  };

  const getRoleIcon = (roleKey: string) => {
    switch (roleKey) {
      case "planner":
        return <BrainCircuit className="w-5 h-5 text-indigo-600" />;
      case "generator":
        return <FileEdit className="w-5 h-5 text-emerald-600" />;
      case "classifier":
        return <Layers className="w-5 h-5 text-amber-600" />;
      case "summarizer":
        return <Volume2 className="w-5 h-5 text-purple-600" />;
      default:
        return <Sparkles className="w-5 h-5 text-indigo-600" />;
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <Activity className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
        <p className="text-xs text-slate-500 font-medium">Loading role-based model configurations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="da-eyebrow"><span className="h-px w-5 bg-indigo-500/50" /> Model roles</span>
          <h3 className="mt-2 flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-slate-950">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            Which model does which job
          </h3>
          <p className="mt-1 text-[13.5px] text-slate-500">
            Give each job its own model: Orbit's planner, content writing, schema classification and voice summaries.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map((r) => {
          const probe = probeResults[r.role];
          const feedback = statusFeedback[r.role];
          const isSaving = savingRole === r.role;
          const isProbing = probingRole === r.role;
          const availableModels = providerModels[r.provider] || DEFAULT_PROVIDER_MODELS[r.provider] || [];
          const isCustomMode = customInputRoles[r.role] || false;

          return (
            <motion.div
              ref={(el: HTMLDivElement | null) =>
                el ? orbitTargets.register(`providers.roles.row.${r.role}`, el) : orbitTargets.unregister(`providers.roles.row.${r.role}`)
              }
              key={r.role}
              whileHover={{ y: -2 }}
              className="da-card da-card-hover flex flex-col justify-between space-y-4 p-5"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl border border-indigo-100 bg-indigo-50">
                      {getRoleIcon(r.role)}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{r.label}</h4>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        Role: {r.role}
                      </span>
                    </div>
                  </div>
                  {r.is_customized && (
                    <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-semibold rounded-full">
                      Customized
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">
                  {r.description}
                </p>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-semibold text-slate-600">
                      Provider
                    </label>
                    <select
                      value={r.provider}
                      onChange={(e) => handleProviderChange(r.role, e.target.value)}
                      className="da-input cursor-pointer py-2 text-[12.5px] font-medium"
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="mock">Local Mock (Test)</option>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="anthropic">Anthropic Claude</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[12px] font-semibold text-slate-600">
                        Model Identifier
                      </label>
                      <button
                        type="button"
                        onClick={() => setCustomInputRoles((prev) => ({ ...prev, [r.role]: !prev[r.role] }))}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium transition"
                        title={isCustomMode ? "Switch back to verified model dropdown" : "Type a custom fine-tuned model name"}
                      >
                        {isCustomMode ? "Choose from list" : "Custom input"}
                      </button>
                    </div>

                    {isCustomMode ? (
                      <input
                        id={`role-model-${r.role}`}
                        type="text"
                        value={r.model_name}
                        onChange={(e) => handleFieldChange(r.role, "model_name", e.target.value)}
                        placeholder="e.g. gemini-3.5-flash-lite"
                        aria-invalid={!!modelErrors[r.role]}
                        aria-describedby={modelErrors[r.role] ? `role-model-${r.role}-error` : undefined}
                        className={`da-input py-2 font-mono text-[12.5px]${invalid(modelErrors[r.role])}`}
                      />
                    ) : (
                      <select
                        id={`role-model-${r.role}`}
                        value={r.model_name}
                        aria-invalid={!!modelErrors[r.role]}
                        aria-describedby={modelErrors[r.role] ? `role-model-${r.role}-error` : undefined}
                        onChange={(e) => {
                          if (e.target.value === "__CUSTOM__") {
                            setCustomInputRoles((prev) => ({ ...prev, [r.role]: true }));
                          } else {
                            handleFieldChange(r.role, "model_name", e.target.value);
                          }
                        }}
                        className={`da-input cursor-pointer py-2 font-mono text-[12.5px]${invalid(modelErrors[r.role])}`}
                      >
                        {availableModels.length === 0 && (
                          <option value={r.model_name}>{r.model_name || "Select model"}</option>
                        )}
                        {!availableModels.includes(r.model_name) && r.model_name && (
                          <option value={r.model_name}>{r.model_name} (Current)</option>
                        )}
                        {availableModels.map((mod) => (
                          <option key={mod} value={mod}>
                            {mod} {mod === "gemini-3.5-flash-lite" ? "⭐ (Active & High Availability)" : ""}
                          </option>
                        ))}
                        <option value="__CUSTOM__">✍️ Custom model name...</option>
                      </select>
                    )}
                    <FieldError id={`role-model-${r.role}`} message={modelErrors[r.role]} />
                  </div>
                </div>

                {availableModels.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-medium text-slate-400 mb-1">
                      Quick Picks ({r.provider}):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableModels.slice(0, 6).map((rec) => (
                        <button
                          key={rec}
                          type="button"
                          onClick={() => {
                            if (isCustomMode) {
                              setCustomInputRoles((prev) => ({ ...prev, [r.role]: false }));
                            }
                            handleFieldChange(r.role, "model_name", rec);
                          }}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-md border transition ${
                            r.model_name === rec
                              ? "bg-indigo-50 text-indigo-700 border-indigo-300 font-semibold shadow-2xs"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {rec}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] font-medium text-slate-500">
                    Temperature: <span className="font-mono text-slate-700">{r.temperature}</span>
                  </span>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={r.temperature}
                    onChange={(e) => handleFieldChange(r.role, "temperature", parseFloat(e.target.value))}
                    className="w-32 accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleProbeRole(r)}
                    disabled={isProbing}
                    className="da-btn da-btn-secondary flex-1"
                  >
                    <Activity className={`w-3.5 h-3.5 ${isProbing ? "animate-spin text-indigo-600" : ""}`} />
                    {isProbing ? "Probing..." : "Probe Model"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveRole(r)}
                    disabled={isSaving}
                    className="da-btn da-btn-primary flex-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSaving ? "Saving..." : "Save Role"}
                  </button>
                </div>

                <AnimatePresence>
                  {probe && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className={`p-2 rounded-lg text-[11px] font-mono border flex items-center gap-2 ${
                        probe.available
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-rose-50 border-rose-200 text-rose-800"
                      }`}
                    >
                      {probe.available ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      )}
                      <span className="truncate">
                        {probe.available
                          ? `Ready (${probe.latency_ms ? `${probe.latency_ms}ms` : "online"})`
                          : probe.message || "Model unavailable"}
                      </span>
                    </motion.div>
                  )}

                  {feedback && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`p-2 rounded-lg text-[11px] font-medium border flex items-center gap-2 ${
                        feedback.type === "success"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-rose-50 border-rose-200 text-rose-800"
                      }`}
                    >
                      {feedback.type === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      )}
                      <span>{feedback.text}</span>
                    </motion.div>
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
