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

export const ModelRolesSection: React.FC = () => {
  const [roles, setRoles] = useState<ModelRoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [probingRole, setProbingRole] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, { available: boolean; latency_ms?: number; message?: string }>>({});
  const [statusFeedback, setStatusFeedback] = useState<Record<string, { type: "success" | "error"; text: string }>>({});

  const loadRoles = async () => {
    try {
      setLoading(true);
      const res = await api.listModelRoles();
      if (res.success && Array.isArray(res.roles)) {
        setRoles(res.roles);
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
          set: (v, row) => { if (!find(row)) return `No role '${row}'.`; handleFieldChange(row!, "provider", String(v)); return null; },
          options: () => ["ollama", "openai", "gemini", "anthropic", "mock"].map((v) => ({ value: v, label: v })),
          target: (row) => `providers.roles.row.${row}`,
        },
        model_name: {
          get: (row) => find(row)?.model_name,
          set: (v, row) => { const t = String(v ?? "").trim(); if (!find(row)) return `No role '${row}'.`; if (!t) return "Model is required."; handleFieldChange(row!, "model_name", t); return null; },
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
    setRoles((prev) =>
      prev.map((r) => (r.role === roleKey ? { ...r, [field]: value } : r))
    );
  };

  const handleSaveRole = async (roleItem: ModelRoleItem) => {
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
      setStatusFeedback((prev) => ({
        ...prev,
        [roleItem.role]: { type: "error", text: err.message || "Failed to update role." },
      }));
    } finally {
      setSavingRole(null);
    }
  };

  const handleProbeRole = async (roleItem: ModelRoleItem) => {
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
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            Model Roles & Task Delegation
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Assign specialized AI models to dedicated operational roles (Planner, Content Generator, Schema Classifier, Voice Summarizer).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map((r) => {
          const probe = probeResults[r.role];
          const feedback = statusFeedback[r.role];
          const isSaving = savingRole === r.role;
          const isProbing = probingRole === r.role;

          return (
            <motion.div
              ref={(el: HTMLDivElement | null) =>
                el ? orbitTargets.register(`providers.roles.row.${r.role}`, el) : orbitTargets.unregister(`providers.roles.row.${r.role}`)
              }
              key={r.role}
              whileHover={{ y: -2 }}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
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
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Provider
                    </label>
                    <select
                      value={r.provider}
                      onChange={(e) => handleFieldChange(r.role, "provider", e.target.value)}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="mock">Local Mock (Test)</option>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="anthropic">Anthropic Claude</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Model Identifier
                    </label>
                    <input
                      type="text"
                      value={r.model_name}
                      onChange={(e) => handleFieldChange(r.role, "model_name", e.target.value)}
                      placeholder="e.g. llama3.2:1b"
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {r.recommended_models && r.recommended_models.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-medium text-slate-400 mb-1">
                      Quick Picks:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {r.recommended_models.map((rec) => (
                        <button
                          key={rec}
                          type="button"
                          onClick={() => handleFieldChange(r.role, "model_name", rec)}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-md border transition ${
                            r.model_name === rec
                              ? "bg-indigo-50 text-indigo-700 border-indigo-300 font-semibold"
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
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition"
                  >
                    <Activity className={`w-3.5 h-3.5 ${isProbing ? "animate-spin text-indigo-600" : ""}`} />
                    {isProbing ? "Probing..." : "Probe Model"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveRole(r)}
                    disabled={isSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-2xs transition"
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
