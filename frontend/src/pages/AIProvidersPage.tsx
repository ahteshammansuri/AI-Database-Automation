import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  RefreshCw,
  ShieldCheck,
  Key,
  CheckCircle2,
  AlertCircle,
  Settings,
  Terminal,
  ExternalLink,
  Lock,
  Zap,
  Server,
  Cloud
} from "lucide-react";
import { api } from "../services/api";
import { AIProviderInfo } from "../types";
import { ModelRolesSection } from "../components/agent/ModelRolesSection";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { orbitTargets } from "../services/orbitTargets";
import { actionTarget, fieldTarget } from "../services/orbitSurfaces";
import { pageStateService } from "../services/pageStateService";

export const AIProvidersPage: React.FC = () => {
  const [providers, setProviders] = useState<AIProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  // Configure Modal state
  const [editingProvider, setEditingProvider] = useState<AIProviderInfo | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadProviders = async () => {
    try {
      setLoading(true);
      const list = await api.listAIProviders();
      setProviders(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/ai-providers", "AI Providers & Model Roles");
    loadProviders();

  }, []);

  const handleTestProvider = async (providerId: string, modelName?: string) => {
    try {
      setTestingId(providerId);
      const res = await api.checkAIProviderHealth(providerId, modelName);
      setTestResults((prev) => ({ ...prev, [providerId]: res }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { available: false, message: err.message },
      }));
    } finally {
      setTestingId(null);
    }
  };

  // ---- Orbit surfaces ----------------------------------------------------------------------
  const modelRef = useOrbitTarget<HTMLInputElement>(fieldTarget("providers.form", "model_name"));
  const baseUrlRef = useOrbitTarget<HTMLInputElement>(fieldTarget("providers.form", "base_url"));
  const apiKeyRef = useOrbitTarget<HTMLInputElement>(fieldTarget("providers.form", "api_key"));
  const saveRef = useOrbitTarget<HTMLButtonElement>(actionTarget("providers.form", "save"));
  const formBoxRef = useOrbitTarget<HTMLDivElement>("providers.form");

  useOrbitSurface("providers.list", () => ({
    describe: () => providers.map((p) => ({
      id: p.provider_id, name: (p as any).name ?? p.provider_id, configured: (p as any).configured ?? undefined,
      current_model: p.current_model, last_test: testResults[p.provider_id]?.message,
    })),
    actions: {
      test: {
        target: (row) => `providers.card.${row}`,
        run: async (row) => {
          const p = providers.find((x) => x.provider_id === row);
          if (!p) return { success: false, message: `No provider '${row}' on this page.` };
          setTestingId(p.provider_id);
          try {
            const res = await api.checkAIProviderHealth(p.provider_id, p.current_model);
            setTestResults((prev) => ({ ...prev, [p.provider_id]: res }));
            return { success: !!res.available, message: res.message || (res.available ? "Provider is available." : "Provider is not available.") };
          } catch (err: any) {
            setTestResults((prev) => ({ ...prev, [p.provider_id]: { available: false, message: err.message } }));
            return { success: false, message: err.message || "Health check failed." };
          } finally {
            setTestingId(null);
          }
        },
      },
      configure: {
        target: (row) => `providers.card.${row}`,
        run: (row) => {
          const p = providers.find((x) => x.provider_id === row);
          if (!p) return { success: false, message: `No provider '${row}' on this page.` };
          openConfigModal(p);
          return { success: true, message: `Configuration form opened for ${p.provider_id}.` };
        },
      },
    },
  }));

  useOrbitSurface("providers.form", () => ({
    isOpen: () => !!editingProvider,
    target: "providers.form",
    fields: {
      model_name: { get: () => modelName, set: (v) => { const t = String(v ?? "").trim(); if (!t) return "Model name is required."; setModelName(t); return null; } },
      base_url: { get: () => baseUrl, set: (v) => { const t = String(v ?? "").trim(); if (t && !/^https?:\/\//.test(t)) return "Base URL must start with http:// or https://"; setBaseUrl(t); return null; } },
      api_key: { get: () => apiKey, set: () => "The user must type the API key themselves." },
    },
    actions: {
      save: {
        enabled: () => !!editingProvider && !!modelName,
        run: async () => {
          if (!editingProvider) return { success: false, message: "No provider form is open." };
          setIsSaving(true);
          try {
            const res: any = await api.saveAIProvider({
              provider_type: editingProvider.provider_id, model_name: modelName,
              api_key: apiKey || undefined, base_url: baseUrl || undefined,
            });
            setEditingProvider(null);
            setApiKey("");
            loadProviders();
            return { success: true, message: res?.message || "Provider saved.", resource: res?.provider?.id ? { type: "AiProvider", id: res.provider.id } : undefined };
          } catch (err: any) {
            return { success: false, message: err.message || "Saving the provider failed." };
          } finally {
            setIsSaving(false);
          }
        },
      },
      cancel: { run: () => { setEditingProvider(null); return { success: true, message: "Form closed." }; } },
    },
  }));

  const openConfigModal = (p: AIProviderInfo) => {
    setEditingProvider(p);
    setModelName(p.current_model || "");
    setApiKey("");
    setBaseUrl(p.provider_id === "ollama" ? "http://localhost:11434" : "");
    setSaveSuccess(null);
    setSaveError(null);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;

    try {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(null);

      await api.saveAIProvider({
        provider_type: editingProvider.provider_id,
        model_name: modelName,
        api_key: apiKey || undefined,
        base_url: baseUrl || undefined,
      });

      setSaveSuccess("Configuration encrypted and persisted successfully.");
      setTimeout(() => {
        setEditingProvider(null);
        loadProviders();
      }, 1000);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save provider preferences.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      id="ai-provider-settings-anchor"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Inference Abstraction Layer
            </span>
            <span className="text-xs text-slate-400">• Local Ollama Primary</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">AI Provider Configuration</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ollama local inference is the primary zero-cost engine. Cloud providers (OpenAI, Gemini, Claude) are strictly optional and tenant-encrypted.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={loadProviders}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          <span>Refresh Providers</span>
        </motion.button>
      </div>

      {/* Quick Local Ollama Helper Callout */}
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-900 text-slate-100 rounded-2xl p-6 shadow-sm space-y-3 relative overflow-hidden"
      >
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Want Live Local Inference? Run Ollama on your machine
            </h4>
          </div>
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition"
          >
            <span>ollama.com</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl relative z-10">
          The platform communicates with Ollama at <code className="text-emerald-400 font-mono bg-black/40 px-1.5 py-0.5 rounded">http://localhost:11434</code>. To use live local models instead of the offline mock generator, run:
        </p>
        <div className="p-3 bg-black/60 rounded-xl font-mono text-xs text-emerald-300 flex items-center justify-between overflow-x-auto border border-slate-800 relative z-10">
          <code>curl -fsSL https://ollama.com/install.sh | sh && ollama run llama3</code>
        </div>
      </motion.div>

      {/* Provider Cards Grid */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.08 }
          }
        }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
      >
        {providers.map((p) => {
          const testRes = testResults[p.provider_id];
          const isTesting = testingId === p.provider_id;

          return (
            <motion.div
              key={p.provider_id}
              ref={(el: HTMLDivElement | null) =>
                el ? orbitTargets.register(`providers.card.${p.provider_id}`, el) : orbitTargets.unregister(`providers.card.${p.provider_id}`)
              }
              variants={{
                hidden: { opacity: 0, y: 12 },
                visible: { opacity: 1, y: 0 }
              }}
              whileHover={{ y: -3, borderColor: "#cbd5e1" }}
              className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between transition-shadow shadow-xs hover:shadow-2xs space-y-4"
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
                      {p.is_local ? <Server className="w-5 h-5" /> : <Cloud className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{p.name}</h4>
                      <p className="text-[11px] text-slate-500">
                        {p.is_local ? "Local Inference (Zero External Network)" : "Remote Cloud Provider"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                      p.is_available
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    {p.is_available ? "Active" : "Inactive"}
                  </span>
                </div>

                <p className="text-xs text-slate-600 py-2.5 border-y border-slate-100 leading-relaxed min-h-[50px]">
                  {p.status_message}
                </p>

                <div className="space-y-1.5 text-xs text-slate-600 pt-2.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">Active Model:</span>
                    <span className="text-indigo-600 font-semibold truncate max-w-[150px]">
                      {p.current_model}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">API Key:</span>
                    <span className="text-slate-700 font-medium font-sans">
                      {p.requires_api_key ? "Tenant Encrypted" : "Free Local (None)"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTestProvider(p.provider_id, p.current_model)}
                    disabled={isTesting}
                    className="flex items-center justify-center gap-1.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? "animate-spin text-indigo-600" : ""}`} />
                    <span>{isTesting ? "Testing..." : "Test Health"}</span>
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => openConfigModal(p)}
                    className="flex items-center justify-center gap-1.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold transition"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Configure</span>
                  </motion.button>
                </div>

                <AnimatePresence>
                  {testRes && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`p-2.5 rounded-xl text-[11px] font-mono border ${
                        testRes.available || testRes.success
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-rose-50 border-rose-200 text-rose-800"
                      }`}
                    >
                      {testRes.message} {testRes.latency_ms ? `(${testRes.latency_ms}ms)` : ""}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Role-Based AI Model Delegation */}
      <ModelRolesSection />

      {/* Security notice */}
      <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-6 space-y-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          No Paid API Mandate & Encrypted Secrets
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The platform guarantees that no paid cloud model is required for full development, testing, or demonstrations. When local Ollama is active, data stays 100% on-premises. When running automated tests, deterministic mock generators provide reliable execution. If you supply OpenAI, Claude, or Gemini API keys, they are encrypted with Laravel application encryption keys at rest and never transmitted to the browser after saving.
        </p>
      </div>

      {/* Configure Provider Modal with Framer Motion */}
      <AnimatePresence>
        {editingProvider && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingProvider(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              ref={formBoxRef}
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Configure {editingProvider.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Settings are encrypted and isolated to your workspace
                  </p>
                </div>
                <button
                  onClick={() => setEditingProvider(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
                >
                  ✕
                </button>
              </div>

              {saveError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{saveSuccess}</span>
                </div>
              )}

              <form onSubmit={handleSaveConfig} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Model Identifier
                  </label>
                  <input
                    type="text"
                    required
                    ref={modelRef}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={editingProvider.current_model || "e.g. llama3, gpt-4o, claude-3-5-sonnet"}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white font-mono transition"
                  />
                </div>

                {editingProvider.provider_id === "ollama" ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Local Ollama Endpoint URL
                    </label>
                    <input
                      type="text"
                      ref={baseUrlRef}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white font-mono transition"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Default is http://localhost:11434. No API key required.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span>Provider API Key</span>
                      <span className="text-[11px] text-emerald-600 font-normal flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Encrypted at rest
                      </span>
                    </label>
                    <input
                      ref={apiKeyRef}
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste your secret API key..."
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white font-mono transition"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Key is stored using AES-256 field encryption and never displayed back in plaintext.
                    </p>
                  </div>
                )}

                <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setEditingProvider(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    ref={saveRef}
                    type="submit"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isSaving}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  >
                    {isSaving ? "Encrypting & Saving..." : "Save Settings"}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
