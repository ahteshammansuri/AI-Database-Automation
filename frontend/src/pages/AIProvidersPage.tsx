import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ShieldCheck, CheckCircle2, Settings, Terminal, ExternalLink, Lock, Server, Cloud } from "lucide-react";
import { api } from "../services/api";
import { AIProviderInfo } from "../types";
import { ModelRolesSection } from "../components/agent/ModelRolesSection";
import { FieldError, FormAlert, ModalShell, PageHeader } from "../components/ui/kit";
import { Select2 } from "../components/ui/Select2";
import { ProviderCardsSkeleton } from "../components/ui/PageSkeletons";
import { ariaFor, clearError, focusFirstError, invalid, rules, serverFieldErrors, validate, type FieldErrors } from "../lib/validation";
import { SpotlightCard } from "../components/landing/primitives";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { orbitTargets } from "../services/orbitTargets";
import { actionTarget, fieldTarget } from "../services/orbitSurfaces";
import { pageStateService } from "../services/pageStateService";
import { BrandName } from "../context/PlatformContext";

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
  // Messages under the model, address and key inputs.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    setFieldErrors({});
  };

  const PROVIDER_FIELD_ID: Record<string, string> = { model_name: "provider-model", base_url: "provider-url", api_key: "provider-key" };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;
    setSaveError(null);
    const isOllama = editingProvider.provider_id === "ollama";
    // A cloud provider with no saved settings has no stored key yet, so one must be pasted now.
    const keyNeeded = editingProvider.requires_api_key && !editingProvider.is_available;
    const found = validate({ model_name: modelName, base_url: isOllama ? baseUrl : "", api_key: isOllama ? "" : apiKey }, {
      model_name: [rules.required("Model", "Choose or type the model to use."), rules.maxLength(120, "Model")],
      base_url: [rules.url("Ollama address"), rules.maxLength(255, "Ollama address")],
      api_key: [...(keyNeeded ? [rules.required("API key", "Paste your API key for this provider. It is stored encrypted.")] : []), rules.maxLength(500, "API key")],
    });
    setFieldErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, (f) => PROVIDER_FIELD_ID[f]);
      return;
    }

    try {
      setIsSaving(true);
      setSaveSuccess(null);

      await api.saveAIProvider({
        provider_type: editingProvider.provider_id,
        model_name: modelName.trim(),
        api_key: apiKey.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
      });

      setSaveSuccess("Configuration encrypted and persisted successfully.");
      setTimeout(() => {
        setEditingProvider(null);
        loadProviders();
      }, 1000);
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      const placed = Object.fromEntries(Object.entries(fields).filter(([f]) => PROVIDER_FIELD_ID[f]));
      if (Object.keys(placed).length) {
        setFieldErrors(placed);
        focusFirstError(placed, (f) => PROVIDER_FIELD_ID[f]);
      } else {
        setSaveError(err.message || "Failed to save provider preferences.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div id="ai-provider-settings-anchor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="AI providers"
        description="Local Ollama is the free, private default. OpenAI, Gemini and Claude are optional: add your own key and it stays encrypted in your workspace."
        actions={
          <button type="button" onClick={loadProviders} className="da-btn da-btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-indigo-600" : "text-slate-500"}`} /> Refresh
          </button>
        }
      />

      {/* Local Ollama helper */}
      <section className="da-ink p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="landing-blob absolute -top-24 right-10 h-72 w-72 rounded-full bg-emerald-500/20" />
          <div className="landing-blob absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-indigo-600/30" style={{ animationDelay: "-6s" }} />
          <div className="absolute inset-0 landing-grid opacity-60" />
        </div>
        <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[12px] font-semibold text-emerald-300">
              <Terminal className="h-3.5 w-3.5" /> No paid API needed
            </span>
            <h3 className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-white">Run models on your own machine with Ollama</h3>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-slate-400">
              <BrandName /> talks to Ollama at <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-emerald-300">http://localhost:11434</code>. Pull a writing model and the embedding model, then pick them below.
            </p>
            <a href="https://ollama.com" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-300 hover:text-white">
              ollama.com <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-[12.5px] leading-7 text-emerald-300">
            <div className="text-slate-500"># install, then pull the models <BrandName /> uses</div>
            <div>curl -fsSL https://ollama.com/install.sh | sh</div>
            <div>ollama pull qwen2.5:3b</div>
            <div>ollama pull nomic-embed-text</div>
          </div>
        </div>
      </section>

      {/* Providers */}
      {loading && providers.length === 0 ? <ProviderCardsSkeleton /> : (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((p, idx) => {
          const testRes = testResults[p.provider_id];
          const isTesting = testingId === p.provider_id;
          return (
            <motion.div
              key={p.provider_id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: Math.min(idx, 8) * 0.05, ease: [0.16, 1, 0.3, 1] }}
              ref={(el: HTMLDivElement | null) =>
                el ? orbitTargets.register(`providers.card.${p.provider_id}`, el) : orbitTargets.unregister(`providers.card.${p.provider_id}`)
              }
            >
              <SpotlightCard className="h-full shadow-soft">
                <div className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`grid h-11 w-11 place-items-center rounded-2xl text-white shadow-[0_10px_24px_-10px_rgba(99,102,241,0.8)] ${
                        p.is_local ? "bg-gradient-to-br from-emerald-400 to-teal-500" : "bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400"
                      }`}>
                        {p.is_local ? <Server className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                      </span>
                      <div>
                        <h4 className="text-[15px] font-bold text-slate-950">{p.name}</h4>
                        <p className="text-[12px] text-slate-500">{p.is_local ? "Runs on your machine" : "Cloud provider · your key"}</p>
                      </div>
                    </div>
                    <span className={`da-chip ${p.is_available ? "da-chip-emerald" : "da-chip-slate"}`}>{p.is_available ? "Ready" : "Not set up"}</span>
                  </div>
                  <p className="mt-4 min-h-[44px] text-[13px] leading-relaxed text-slate-600">{p.status_message}</p>
                  <dl className="da-panel mt-4 space-y-2 px-4 py-3 text-[12.5px]">
                    <div className="flex justify-between gap-3"><dt className="text-slate-500">Model</dt><dd className="max-w-[160px] truncate font-mono font-semibold text-indigo-600">{p.current_model}</dd></div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">API key</dt>
                      <dd className="flex items-center gap-1 text-slate-700">{p.requires_api_key ? <><Lock className="h-3 w-3" /> Encrypted</> : "Not needed"}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                    <button type="button" onClick={() => handleTestProvider(p.provider_id, p.current_model)} disabled={isTesting} className="da-btn da-btn-secondary">
                      <RefreshCw className={`h-3.5 w-3.5 ${isTesting ? "animate-spin text-indigo-600" : ""}`} /> {isTesting ? "Testing…" : "Test"}
                    </button>
                    <button type="button" onClick={() => openConfigModal(p)} className="da-btn da-btn-primary">
                      <Settings className="h-3.5 w-3.5" /> Configure
                    </button>
                  </div>
                  <AnimatePresence>
                    {testRes && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`mt-3 rounded-xl border px-3 py-2 font-mono text-[11.5px] ${
                          testRes.available || testRes.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
                        }`}>
                        {testRes.message} {testRes.latency_ms ? `(${testRes.latency_ms} ms)` : ""}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </SpotlightCard>
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Model roles */}
      <ModelRolesSection />

      <div className="flex gap-4 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/50 p-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-indigo-600 shadow-xs"><ShieldCheck className="h-5 w-5" /></span>
        <div>
          <h3 className="text-[15px] font-bold text-slate-950">No paid API required, and your keys stay secret</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
            Everything works with local Ollama. With Ollama, generation runs on your machine. If you add an OpenAI, Claude or Gemini key, it is encrypted at rest,
            never logged, and never sent back to the browser after you save it. Only your own drafts are sent to the provider you choose.
          </p>
        </div>
      </div>

      {/* Configure provider */}
      <ModalShell
        open={!!editingProvider}
        onClose={() => setEditingProvider(null)}
        panelRef={formBoxRef}
        size="sm"
        icon={Settings}
        title={editingProvider ? `Configure ${editingProvider.name}` : ""}
        description="Saved encrypted and only for your workspace."
        footer={
          <>
            <button type="button" onClick={() => setEditingProvider(null)} className="da-btn da-btn-ghost">Cancel</button>
            <button ref={saveRef} type="submit" form="provider-form" disabled={isSaving} className="da-btn da-btn-primary">
              {isSaving ? "Encrypting and saving…" : "Save settings"}
            </button>
          </>
        }
      >
        {editingProvider && (
          <div className="space-y-4">
            <FormAlert message={saveError} onClose={() => setSaveError(null)} />
            {saveSuccess && (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {saveSuccess}
              </div>
            )}
            <form id="provider-form" onSubmit={handleSaveConfig} noValidate className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[12.5px] font-semibold text-slate-700" htmlFor="provider-model">Model</label>
                  {editingProvider.models && editingProvider.models.length > 0 && (
                    <span className="text-[11.5px] text-slate-400">{editingProvider.models.length} available</span>
                  )}
                </div>
                {editingProvider.models && editingProvider.models.length > 0 ? (
                  <div className="space-y-2">
                    <Select2
                      id="provider-model"
                      value={modelName}
                      onChange={(val) => {
                        setModelName(String(val));
                        setFieldErrors((x) => clearError(x, "model_name"));
                      }}
                      options={[
                        ...(!editingProvider.models.includes(modelName) && modelName
                          ? [{ value: modelName, label: `${modelName} (current)` }]
                          : []),
                        ...editingProvider.models.map((mod) => ({
                          value: mod,
                          label: mod,
                          badge: mod === "gemini-3.5-flash-lite" ? "⭐ Recommended" : undefined,
                        })),
                      ]}
                      invalid={!!fieldErrors.model_name}
                      showSearch={editingProvider.models.length > 5}
                      className="font-mono"
                      ariaLabel="Model"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {editingProvider.models.map((mod) => (
                        <button key={mod} type="button" onClick={() => { setModelName(mod); setFieldErrors((x) => clearError(x, "model_name")); }}
                          className={`rounded-lg border px-2 py-0.5 font-mono text-[11px] transition ${
                            modelName === mod ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                          }`}>
                          {mod}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <input id="provider-model" type="text" ref={modelRef} value={modelName} onChange={(e) => { setModelName(e.target.value); setFieldErrors((x) => clearError(x, "model_name")); }}
                    placeholder={editingProvider.current_model || "e.g. qwen2.5:3b, gpt-4o, claude-3-5-sonnet"}
                    className={`da-input font-mono${invalid(fieldErrors.model_name)}`} {...ariaFor("provider-model", fieldErrors.model_name)} />
                )}
                <FieldError id="provider-model" message={fieldErrors.model_name} />
              </div>
              {editingProvider.provider_id === "ollama" ? (
                <div>
                  <label className="da-label" htmlFor="provider-url">Ollama address</label>
                  <input id="provider-url" type="text" ref={baseUrlRef} value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setFieldErrors((x) => clearError(x, "base_url")); }} placeholder="http://localhost:11434"
                    className={`da-input font-mono${invalid(fieldErrors.base_url)}`} {...ariaFor("provider-url", fieldErrors.base_url)} />
                  <FieldError id="provider-url" message={fieldErrors.base_url} />
                  {!fieldErrors.base_url && <p className="da-help">Default http://localhost:11434. No API key needed.</p>}
                </div>
              ) : (
                <div>
                  <label className="da-label flex items-center justify-between" htmlFor="provider-key">
                    <span>API key</span>
                    <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-600"><Lock className="h-3 w-3" /> Encrypted at rest</span>
                  </label>
                  <input id="provider-key" ref={apiKeyRef} type="password" autoComplete="off" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setFieldErrors((x) => clearError(x, "api_key")); }}
                    placeholder={editingProvider.is_available ? "Leave empty to keep the saved key" : "Paste your secret API key…"}
                    className={`da-input font-mono${invalid(fieldErrors.api_key)}`} {...ariaFor("provider-key", fieldErrors.api_key)} />
                  <FieldError id="provider-key" message={fieldErrors.api_key} />
                  {!fieldErrors.api_key && <p className="da-help">Stored encrypted and never shown again in plain text.</p>}
                </div>
              )}
            </form>
          </div>
        )}
      </ModalShell>
    </motion.div>
  );
};
