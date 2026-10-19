import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle, ArrowLeft, ArrowRight, BookOpen, Calendar, Check, CheckCircle2, ChevronDown, ChevronUp, Cpu, Database,
  Eye, FileText, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Search, Server, Sliders, Sparkles, TableProperties,
  Upload, Workflow, X, Zap, Clock, ShieldCheck,
} from "lucide-react";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { api } from "../services/api";
import { ConnectionProfile, SchemaResponse, KnowledgeDocument, AIProviderInfo } from "../types";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { FieldMappingStep } from "../components/automation/FieldMappingStep";
import { FieldPlan, Mapping, Mode as ColumnMode, PlanColumn, explain, mappingFor, mappingProblems, modeOf, modeOptions, serializeMappings } from "../components/automation/fieldPlan";
import { ScheduleStep, ScheduleConfig, ApprovalConfig } from "../components/automation/ScheduleStep";
import { ContentPreview } from "../components/content/ContentPreview";
import { MIN_GAP_MINUTES, browserTimeZone, gapMinutes, todayIn, addDays, formatTime12 } from "../lib/schedule";

type Mode = "AI_GENERATED" | "MANUAL";
interface GenerationOptions {
  tone: string;
  length: "short" | "medium" | "long";
  content_format: "markdown" | "html";
  image_provider: "auto" | "openai" | "gemini" | "local";
  image_style: string;
}

const DRAFT_KEY = "automation_builder_draft_v2";

const TONES = [
  "Professional, clear and engaging",
  "In-depth technical and precise",
  "Friendly and conversational",
  "Concise and executive-level",
  "Step-by-step practical tutorial",
  "Persuasive and benefit-focused",
];

const defaultSchedule = (tz: string): ScheduleConfig => ({
  frequency: "DAILY",
  start_date: addDays(todayIn(tz), 1),
  end_date: addDays(todayIn(tz), 7),
  weekly_days: [],
  timezone: tz,
  generation_time: "08:30",
  publication_time: "09:00",
});

export const AutomationBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const tz0 = browserTimeZone();

  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AIProviderInfo[]>([]);

  const [name, setName] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [mode, setMode] = useState<Mode>("AI_GENERATED");

  const [fieldPlan, setFieldPlan] = useState<FieldPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const mappingsTableRef = useRef<string>("");

  const [aiConfig, setAiConfig] = useState({ provider: "ollama", model: "", topic: "", document_ids: [] as number[] });
  const [genOptions, setGenOptions] = useState<GenerationOptions>({
    tone: TONES[0], length: "medium", content_format: "markdown", image_provider: "auto", image_style: "",
  });

  const [schedule, setSchedule] = useState<ScheduleConfig>(defaultSchedule(tz0));
  const [scheduleValid, setScheduleValid] = useState(false);
  const [approval, setApproval] = useState<ApprovalConfig>({ require_approval: true, reviewer_email: "", timeout_policy: "KEEP_DRAFT" });

  const [showDocUploadModal, setShowDocUploadModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [docSearchFilter, setDocSearchFilter] = useState("");

  const [naturalPrompt, setNaturalPrompt] = useState("");
  const [isProposing, setIsProposing] = useState(false);
  const [proposeFeedback, setProposeFeedback] = useState<string | null>(null);

  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<{ message: string; events?: any[] } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  // Autosave starts only after the stored draft has been read, so it never overwrites it with defaults.
  const [hydrated, setHydrated] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showRecap, setShowRecap] = useState(true);

  const manual = mode === "MANUAL";

  // ---------------------------------------------------------------- templates
  const applyTemplate = (id: string, cfg: { name: string; topic: string; tone: string; frequency: ScheduleConfig["frequency"]; gen: string; pub: string; approval: boolean; manual?: boolean; length?: GenerationOptions["length"] }) => {
    setSelectedTemplateId(id);
    setName(cfg.name);
    setMode(cfg.manual ? "MANUAL" : "AI_GENERATED");
    setAiConfig((p) => ({ ...p, topic: cfg.topic }));
    setGenOptions((p) => ({ ...p, tone: cfg.tone, length: cfg.length ?? p.length }));
    setSchedule((p) => ({ ...p, frequency: cfg.frequency, generation_time: cfg.gen, publication_time: cfg.pub, weekly_days: cfg.frequency === "WEEKLY" ? [1] : [] }));
    setApproval((p) => ({ ...p, require_approval: cfg.approval }));
    toast.success("Template applied", `${cfg.name} settings loaded. You can change anything.`);
  };

  const workflowTemplates = [
    { id: "daily_blog", title: "Daily blog post", description: "A new article every day with category, image and SEO fields", icon: FileText, badge: "Popular", color: "text-indigo-600 bg-indigo-50 border-indigo-200",
      apply: () => applyTemplate("daily_blog", { name: "Daily blog post", topic: "Practical, original articles for our readers about our product area", tone: TONES[0], frequency: "DAILY", gen: "08:30", pub: "09:00", approval: true }) },
    { id: "weekly_deep_dive", title: "Weekly deep dive", description: "One long, detailed article each week, reviewed by email", icon: BookOpen, badge: "Long form", color: "text-violet-600 bg-violet-50 border-violet-200",
      apply: () => applyTemplate("weekly_deep_dive", { name: "Weekly deep dive", topic: "In-depth guides with examples and step-by-step instructions", tone: TONES[1], frequency: "WEEKLY", gen: "09:00", pub: "11:00", approval: true, length: "long" }) },
    { id: "news", title: "News and updates", description: "Short, timely news items published twice a day", icon: Zap, badge: "Short", color: "text-amber-600 bg-amber-50 border-amber-200",
      apply: () => applyTemplate("news", { name: "News updates", topic: "Short news items and announcements relevant to our audience", tone: TONES[3], frequency: "DAILY", gen: "07:30", pub: "08:00", approval: true, length: "short" }) },
    { id: "product_seo", title: "Product descriptions", description: "Benefit-led product copy with SEO fields", icon: Sparkles, badge: "E-commerce", color: "text-emerald-600 bg-emerald-50 border-emerald-200",
      apply: () => applyTemplate("product_seo", { name: "Product descriptions", topic: "Product highlights, customer benefits and clear specifications", tone: TONES[5], frequency: "WEEKLY", gen: "09:00", pub: "09:30", approval: true, length: "short" }) },
    { id: "faq", title: "FAQ entries", description: "Question-and-answer pairs grounded in your documents", icon: BookOpen, badge: "Knowledge", color: "text-sky-600 bg-sky-50 border-sky-200",
      apply: () => applyTemplate("faq", { name: "FAQ entries", topic: "Frequently asked questions with direct, accurate answers", tone: TONES[3], frequency: "DAILY", gen: "10:00", pub: "10:30", approval: true, length: "short" }) },
    { id: "manual_schedule", title: "Manual (no AI)", description: "Fixed values on a schedule; AI is never called", icon: Calendar, badge: "No AI", color: "text-slate-600 bg-slate-100 border-slate-300",
      apply: () => applyTemplate("manual_schedule", { name: "Scheduled fixed content", topic: "", tone: TONES[0], frequency: "DAILY", gen: "08:30", pub: "09:00", approval: false, manual: true }) },
  ];

  // ---------------------------------------------------------------- draft persistence
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d?.name && !d?.targetTable && (d?.step ?? 1) <= 1) return; // nothing worth restoring
      if (d.name) setName(d.name);
      if (d.targetTable) setTargetTable(d.targetTable);
      if (d.mode) setMode(d.mode);
      if (d.aiConfig) setAiConfig(d.aiConfig);
      if (d.genOptions) setGenOptions(d.genOptions);
      if (d.schedule) setSchedule({ ...defaultSchedule(tz0), ...d.schedule });
      if (d.approval) setApproval(d.approval);
      if (d.mappings && d.targetTable) {
        setMappings(d.mappings);
        mappingsTableRef.current = `${d.connectionId}:${d.targetTable}`;
      }
      if (d.connectionId) setSelectedConnId(d.connectionId);
      if (d.step) setStep(Math.min(d.step, 4));
      setDraftRestored(true);
    } catch {
      // ignore unreadable drafts
    } finally {
      setHydrated(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, targetTable, mode, aiConfig, genOptions, schedule, approval, mappings, connectionId: selectedConnId, step }));
    } catch {
      // storage full or blocked
    }
  }, [hydrated, name, targetTable, mode, aiConfig, genOptions, schedule, approval, mappings, selectedConnId, step]);

  const handleClearDraft = () => {
    sessionStorage.removeItem(DRAFT_KEY);
    setName("");
    setMode("AI_GENERATED");
    setAiConfig((p) => ({ ...p, topic: "", document_ids: [] }));
    setGenOptions({ tone: TONES[0], length: "medium", content_format: "markdown", image_provider: "auto", image_style: "" });
    setSchedule(defaultSchedule(tz0));
    setApproval({ require_approval: true, reviewer_email: "", timeout_policy: "KEEP_DRAFT" });
    mappingsTableRef.current = "";
    setMappings({});
    setPreview(null);
    setStep(1);
    setDraftRestored(false);
  };

  // ---------------------------------------------------------------- data loading
  useEffect(() => {
    (async () => {
      try {
        setLoadingConnections(true);
        const [conns, docs, provs] = await Promise.all([api.listConnections(), api.listKnowledge(), api.listAIProviders().catch(() => [])]);
        const safeConns = Array.isArray(conns) ? conns : [];
        const safeProvs = Array.isArray(provs) ? provs : [];
        setConnections(safeConns);
        setKnowledgeDocs(Array.isArray(docs) ? docs : []);
        setAvailableProviders(safeProvs);
        const fromQuery = searchParams.get("connectionId") ? Number(searchParams.get("connectionId")) : null;
        setSelectedConnId((cur) => cur ?? fromQuery ?? safeConns[0]?.id ?? null);

        const ollama = safeProvs.find((p) => p.provider_id === "ollama" && p.is_available);
        const chosen = ollama ?? safeProvs.find((p) => p.is_available);
        if (chosen) {
          const models = chosen.models || (chosen as any).available_models || [];
          setAiConfig((prev) => (prev.model ? prev : { ...prev, provider: chosen.provider_id, model: chosen.current_model || models[0] || "" }));
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingConnections(false);
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    if (!selectedConnId) return;
    let cancelled = false;
    api.getSchema(selectedConnId).then((s) => {
      if (cancelled) return;
      setSchema(s);
      setTargetTable((cur) => {
        const tables = (s?.tables ?? []).filter((t: any) => t.category !== "RESTRICTED");
        if (cur && tables.some((t: any) => t.name === cur)) return cur;
        const q = searchParams.get("table");
        if (q && tables.some((t: any) => t.name === q)) return q;
        return (tables.find((t: any) => t.category === "RECOMMENDED") ?? tables[0])?.name ?? "";
      });
    }).catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [selectedConnId, searchParams]);

  const loadFieldPlan = useCallback(async () => {
    if (!selectedConnId || !targetTable) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan: FieldPlan = await api.getFieldPlan(selectedConnId, targetTable, genOptions.image_provider);
      setFieldPlan(plan);
      const key = `${selectedConnId}:${targetTable}`;
      setMappings((prev) => {
        const keep = mappingsTableRef.current === key;
        mappingsTableRef.current = key;
        const next: Record<string, Mapping> = {};
        for (const c of plan.columns) {
          if (c.is_secret) continue;
          next[c.name] = keep && prev[c.name] ? prev[c.name] : (c.suggested as Mapping);
        }
        return next;
      });
    } catch (e: any) {
      setPlanError(e.message);
      setFieldPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }, [selectedConnId, targetTable, genOptions.image_provider]);

  useEffect(() => {
    loadFieldPlan();
  }, [selectedConnId, targetTable]); // eslint-disable-line react-hooks/exhaustive-deps

  // In manual mode, AI mappings are switched to safe non-AI choices.
  useEffect(() => {
    if (!manual || !fieldPlan) return;
    setMappings((prev) => {
      const next = { ...prev };
      for (const c of fieldPlan.columns) {
        const m = prev[c.name];
        const md = m ? modeOf(m, c) : null;
        if (md === "AI" || md === "AI_CREATE" || md === "AI_REUSE") {
          next[c.name] = c.relation
            ? { field_name: c.name, mapping_type: c.nullable ? "LEAVE_EMPTY" : "RELATIONAL_LOOKUP", fixed_value: null, relation_config: { referenced_table: c.relation.table, referenced_column: c.relation.column, creation_policy: "REUSE_EXISTING_ONLY" } }
            : { field_name: c.name, mapping_type: "FIXED_VALUE", fixed_value: "" };
        }
      }
      return next;
    });
  }, [manual, fieldPlan]);

  const problems = mappingProblems(fieldPlan, mappings, manual);
  const problemCount = Object.keys(problems).length;
  const hasBody = !!fieldPlan?.columns.some((c) => c.kind === "body" && modeOf(mappings[c.name], c) === "AI");
  const hasImage = !!fieldPlan?.columns.some((c) => c.kind === "image" && modeOf(mappings[c.name], c) === "AI");
  const selectedConnection = connections.find((c) => c.id === selectedConnId);

  // ---------------------------------------------------------------- payload
  const buildAutomationPayload = () => ({
    name: name.trim(),
    connection_id: selectedConnId,
    target_table: targetTable,
    operation_mode: manual ? "MANUAL_SCHEDULE" : "AI_CREATE",
    field_mappings: serializeMappings(fieldPlan, mappings),
    ai_provider: manual ? undefined : aiConfig.provider,
    ai_model: manual ? undefined : aiConfig.model || undefined,
    prompt_context: manual ? undefined : aiConfig.topic.trim() || undefined,
    generation_options: manual ? undefined : {
      tone: genOptions.tone,
      length: genOptions.length,
      content_format: genOptions.content_format,
      image_provider: genOptions.image_provider,
      image_style: genOptions.image_style.trim() || undefined,
    },
    knowledge_document_ids: manual ? [] : aiConfig.document_ids,
    schedule_type: schedule.frequency,
    start_date: schedule.start_date,
    end_date: schedule.frequency === "ONE_TIME" ? null : schedule.end_date,
    weekly_days: schedule.frequency === "WEEKLY" ? schedule.weekly_days : [],
    generation_time: schedule.generation_time,
    publication_time: schedule.publication_time,
    timezone: schedule.timezone,
    requires_approval: approval.require_approval,
    reviewer_email: approval.reviewer_email.trim() || undefined,
    timeout_policy: approval.timeout_policy,
    is_active: true,
  });

  // ---------------------------------------------------------------- actions
  const handleProposeAutomation = async () => {
    if (!selectedConnId) return setError("Select a database connection first.");
    if (!naturalPrompt.trim()) return setError("Describe what you want to automate first.");
    try {
      setIsProposing(true);
      setError(null);
      setProposeFeedback(null);
      const res = await api.proposeAutomationPlan(selectedConnId, naturalPrompt);
      const plan = res?.plan ?? {};
      if (plan.name) setName(plan.name);
      if (plan.target_table && schema?.tables?.some((t: any) => t.name === plan.target_table)) setTargetTable(plan.target_table);
      if (plan.operation_mode) setMode(plan.operation_mode === "MANUAL_SCHEDULE" ? "MANUAL" : "AI_GENERATED");
      const topic = plan.prompt_context || plan.topic || plan.ai_config?.topic;
      if (topic) setAiConfig((p) => ({ ...p, topic }));
      if (plan.tone || plan.ai_config?.tone) setGenOptions((p) => ({ ...p, tone: plan.tone || plan.ai_config?.tone }));
      if (plan.schedule_config) {
        const sc = plan.schedule_config;
        const freq = ["DAILY", "WEEKLY", "ONE_TIME"].includes(sc.frequency) ? sc.frequency : undefined;
        setSchedule((p) => ({ ...p, ...(freq ? { frequency: freq } : {}), generation_time: sc.generation_time || p.generation_time, publication_time: sc.publication_time || p.publication_time }));
      }
      if (plan.approval_policy) setApproval((p) => ({ ...p, require_approval: plan.approval_policy.require_approval ?? p.require_approval }));
      setProposeFeedback(plan.explanation || "Settings filled in from your description. Review each step.");
    } catch (err: any) {
      setError(`Could not propose a plan: ${err.message}`);
    } finally {
      setIsProposing(false);
    }
  };

  const handleUploadDocumentInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocFile) return;
    try {
      setIsUploadingDoc(true);
      const res = await api.uploadKnowledge(newDocTitle || newDocFile.name.replace(/\.[^/.]+$/, ""), newDocFile);
      const docs = await api.listKnowledge();
      setKnowledgeDocs(Array.isArray(docs) ? docs : []);
      if (res?.id) setAiConfig((p) => ({ ...p, document_ids: [...p.document_ids, res.id] }));
      setNewDocTitle("");
      setNewDocFile(null);
      setShowDocUploadModal(false);
    } catch (err: any) {
      setError(`Document upload failed: ${err.message}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  useEffect(() => {
    if (!isPreviewing) return;
    setPreviewSeconds(0);
    const t = setInterval(() => setPreviewSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isPreviewing]);

  const handlePreview = async () => {
    try {
      setIsPreviewing(true);
      setPreviewError(null);
      setPreview(null);
      const res = await api.previewAutomation({ ...buildAutomationPayload(), name: name.trim() || "Preview", include_images: true });
      setPreview(res);
    } catch (err: any) {
      setPreviewError({ message: err.message, events: err.data?.events });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedConnId || !name.trim()) {
      setError("Give the automation a name and choose a connection.");
      setStep(1);
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      const res: any = await api.createAutomation(buildAutomationPayload());
      sessionStorage.removeItem(DRAFT_KEY);
      const next = res?.automation?.schedule_summary?.next_run;
      toast.success("Automation saved", next ? `First run: ${new Date(next.generation_at).toLocaleString()}` : "It is now scheduled.");
      navigate("/automations");
    } catch (err: any) {
      const fieldErrs = err.errors ? Object.values(err.errors).flat().join(" ") : "";
      setError(`Could not save: ${err.message}${fieldErrs && !String(err.message).includes(fieldErrs) ? ` ${fieldErrs}` : ""}`);
      toast.error("Could not save the automation", err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------- navigation guards
  const canLeave = (n: number): string | null => {
    if (n === 1) {
      if (!name.trim()) return "Give the automation a name.";
      if (!selectedConnId) return "Choose a database connection.";
      if (!targetTable) return "Choose the table to write to.";
    }
    if (n === 2) {
      if (!fieldPlan) return planError || "The table's columns are still loading.";
      if (problemCount > 0) return `Fix ${problemCount} column${problemCount === 1 ? "" : "s"} first.`;
    }
    if (n === 3 && !manual && !aiConfig.topic.trim()) return "Describe what the content should be about.";
    if (n === 4) {
      const gap = gapMinutes(schedule.generation_time, schedule.publication_time);
      if (gap === null || gap < MIN_GAP_MINUTES) return `Publication must be at least ${MIN_GAP_MINUTES} minutes after generation.`;
      if (!scheduleValid) return "Fix the schedule first (see the summary).";
    }
    return null;
  };
  const goNext = (from: number) => {
    const why = canLeave(from);
    if (why) {
      setError(why);
      return { success: false, message: why };
    }
    setError(null);
    setStep(from + 1);
    return { success: true, message: `Moved to step ${from + 1}.` };
  };
  const goBack = (to: number) => {
    setError(null);
    setStep(to);
    return { success: true, message: `Back to step ${to}.` };
  };

  // ---------------------------------------------------------------- Orbit surfaces
  const stepTarget = (n: number) => `builder.step.${n}`;
  const timeOk = (v: any) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
  const dateOk = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

  useOrbitSurface("builder.setup", () => ({
    target: stepTarget(1),
    fields: {
      name: { get: () => name, set: (v) => { const t = String(v ?? "").trim(); if (!t) return "Name is required."; setName(t); return null; }, target: () => stepTarget(1) },
      connection: {
        get: () => selectedConnId,
        set: (v) => { const id = Number(v); if (!connections.find((c) => c.id === id)) return `Connection ${v} is not in this workspace.`; setSelectedConnId(id); return null; },
        options: () => connections.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name || c.database || ""})` })),
        target: () => stepTarget(1),
      },
      table: {
        get: () => targetTable,
        set: (v) => { const t = String(v); if (schema?.tables && !schema.tables.some((x: any) => x.name === t)) return `Table '${t}' is not in this schema.`; setTargetTable(t); return null; },
        options: () => (schema?.tables || []).filter((t: any) => t.category !== "RESTRICTED").map((t: any) => ({ value: t.name, label: t.name })),
        target: () => stepTarget(1),
      },
      operation: { get: () => "INSERT", set: (v) => (String(v).toUpperCase() === "INSERT" ? null : "Automations create new rows (INSERT) only."), options: () => [{ value: "INSERT", label: "Insert new records" }], target: () => stepTarget(1) },
      mode: { get: () => mode, set: (v) => { const m = String(v).toUpperCase(); if (!["AI_GENERATED", "MANUAL"].includes(m)) return "Use AI_GENERATED or MANUAL."; setMode(m as Mode); return null; }, options: () => [{ value: "AI_GENERATED", label: "AI generated" }, { value: "MANUAL", label: "Manual (no AI)" }], target: () => stepTarget(1) },
      plan_prompt: { get: () => naturalPrompt, set: (v) => { setNaturalPrompt(String(v ?? "")); return null; }, target: () => stepTarget(1) },
    },
    actions: {
      propose_plan: { enabled: () => !!selectedConnId && !!naturalPrompt.trim(), run: async () => { await handleProposeAutomation(); return { success: true, message: "Plan applied; review each step.", data: { name, targetTable, mode } }; } },
      next: { run: () => goNext(1) },
    },
  }), step === 1);

  // Per-column controls, the same rules as the mapping step's own dropdowns and editors.
  const planColumn = (key: string): PlanColumn | null => {
    const name = key.slice(key.indexOf(".") + 1);
    return fieldPlan?.columns.find((c) => c.name === name) ?? null;
  };
  const allowedModes = (c: PlanColumn) => modeOptions(c).filter((o) => !manual || !["AI", "AI_CREATE", "AI_REUSE"].includes(o.value));
  const titleColumn = fieldPlan?.title_column ?? null;
  const setColumnMapping = (c: PlanColumn, m: Mapping) => setMappings((p) => ({ ...p, [c.name]: m }));
  const fixedValueError = (c: PlanColumn, v: any): string | null => {
    const text = String(v ?? "");
    if (c.max_length && text.length > c.max_length) return `${c.name} allows at most ${c.max_length} characters.`;
    if (c.kind === "image" && text && !/^https?:\/\//i.test(text)) return `${c.name} needs an http(s) image URL.`;
    return null;
  };

  useOrbitSurface("builder.mappings", () => ({
    target: stepTarget(2),
    describe: () => (fieldPlan?.columns ?? []).filter((c) => !c.is_secret).map((c) => ({
      column: c.name, kind: c.kind, required: c.required || undefined,
      how: modeOf(mappings[c.name], c), choices: allowedModes(c).map((o) => o.value),
      value: mappings[c.name]?.fixed_value ?? undefined,
      instructions: mappings[c.name]?.instructions || undefined,
      means: explain(c, mappings[c.name], { titleColumn, length: genOptions.length, format: genOptions.content_format, manual }),
      linked_table: c.relation?.table, problem: problems[c.name],
    })),
    fields: {
      "how.*": {
        get: (key) => { const c = planColumn(String(key)); return c ? modeOf(mappings[c.name], c) : null; },
        set: (v, key) => {
          const c = planColumn(String(key));
          if (!c) return `There is no column '${String(key).slice(4)}' in ${targetTable || "this table"}.`;
          if (c.is_secret) return `${c.name} is protected and is never written.`;
          const allowed = allowedModes(c);
          const want = String(v ?? "").trim();
          const hit = allowed.find((o) => o.value === want.toUpperCase() || o.label.toLowerCase() === want.toLowerCase());
          if (!hit) return `${c.name} can be filled by: ${allowed.map((o) => `${o.value} (${o.label})`).join(", ")}.`;
          setColumnMapping(c, mappingFor(hit.value as ColumnMode, c, mappings[c.name], titleColumn));
          return null;
        },
        options: (key) => { const c = planColumn(String(key)); return c ? allowedModes(c) : []; },
        target: (key) => `builder.col.${String(key).slice(4)}`,
      },
      "value.*": {
        get: (key) => { const c = planColumn(String(key)); return c ? mappings[c.name]?.fixed_value ?? null : null; },
        set: async (v, key) => {
          const c = planColumn(String(key));
          if (!c) return `There is no column '${String(key).slice(6)}' in ${targetTable || "this table"}.`;
          if (c.is_secret) return `${c.name} is protected and is never written.`;
          const current = mappings[c.name];
          if (c.relation) {
            const want = String(v ?? "").trim();
            const rows: any[] = selectedConnId ? await api.getLookupValues(selectedConnId, c.relation.table, want) : [];
            const label = (r: any) => String(r.label ?? r.name ?? r.title ?? r.slug ?? r.id);
            const hit = rows.find((r) => String(r.id) === want) ?? rows.find((r) => label(r).toLowerCase() === want.toLowerCase());
            if (!hit) return `No ${c.relation.entity} matches "${want}" in ${c.relation.table}.${rows.length ? ` Close matches: ${rows.slice(0, 5).map(label).join(", ")}.` : ""}`;
            setColumnMapping(c, { ...mappingFor("FIXED_REL", c, current, titleColumn), fixed_value: hit.id });
            return null;
          }
          let value: any = v;
          if (c.kind === "enum") {
            const hit = c.enum_values.find((e) => e.toLowerCase() === String(v ?? "").trim().toLowerCase());
            if (!hit) return `${c.name} must be one of: ${c.enum_values.join(", ")}.`;
            value = hit;
          } else if (c.kind === "boolean") {
            const t = String(v ?? "").trim().toLowerCase();
            if (!["1", "0", "true", "false", "yes", "no", "on", "off"].includes(t)) return `${c.name} is yes/no.`;
            value = ["1", "true", "yes", "on"].includes(t) ? 1 : 0;
          } else if (c.kind === "number") {
            const n = Number(v);
            if (String(v ?? "").trim() === "" || !Number.isFinite(n)) return `${c.name} needs a number.`;
            value = n;
          } else if (c.kind === "datetime") {
            const m = String(v ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
            if (!m) return `${c.name} needs a date and time like 2026-11-02 09:30.`;
            value = `${m[1]} ${m[2]}:00`;
          }
          const base = current && modeOf(current, c) === "FIXED" ? current : mappingFor("FIXED", c, current, titleColumn);
          setColumnMapping(c, { ...base, fixed_value: value });
          return fixedValueError(c, value);
        },
        options: async (key) => {
          const c = planColumn(String(key));
          if (!c) return [];
          if (c.kind === "enum") return c.enum_values.map((e) => ({ value: e, label: e }));
          if (c.relation && selectedConnId) {
            const rows: any[] = await api.getLookupValues(selectedConnId, c.relation.table);
            return rows.slice(0, 50).map((r) => ({ value: r.id, label: String(r.label ?? r.name ?? r.title ?? r.slug ?? r.id) }));
          }
          return [];
        },
        target: (key) => `builder.col.${String(key).slice(6)}`,
      },
      "instructions.*": {
        get: (key) => { const c = planColumn(String(key)); return c ? mappings[c.name]?.instructions ?? "" : null; },
        set: (v, key) => {
          const c = planColumn(String(key));
          if (!c) return `There is no column '${String(key).slice(13)}' in ${targetTable || "this table"}.`;
          const mode = modeOf(mappings[c.name], c);
          if (!["AI", "AI_CREATE", "AI_REUSE"].includes(mode)) return `${c.name} is not filled by AI (it is ${mode}); set how.${c.name} to an AI choice first.`;
          setColumnMapping(c, { ...mappings[c.name]!, instructions: String(v ?? "").slice(0, 500) });
          return null;
        },
        target: (key) => `builder.col.${String(key).slice(13)}`,
      },
    },
    actions: { back: { run: () => goBack(1) }, next: { run: () => goNext(2) } },
  }), step === 2);

  useOrbitSurface("builder.content", () => ({
    target: stepTarget(3),
    fields: {
      provider: {
        get: () => aiConfig.provider,
        set: (v) => { setAiConfig((p) => ({ ...p, provider: String(v) })); return null; },
        options: () => (availableProviders.length ? availableProviders.map((p: any) => ({ value: p.provider_id, label: p.name ?? p.provider_id })) : [{ value: "ollama", label: "Ollama (local)" }]),
        target: () => stepTarget(3),
      },
      model: { get: () => aiConfig.model, set: (v) => { setAiConfig((p) => ({ ...p, model: String(v ?? "").trim() })); return null; }, target: () => stepTarget(3) },
      topic: { get: () => aiConfig.topic, set: (v) => { const t = String(v ?? "").trim(); if (!t) return "Topic is required."; setAiConfig((p) => ({ ...p, topic: t })); return null; }, target: () => stepTarget(3) },
      tone: { get: () => genOptions.tone, set: (v) => { setGenOptions((p) => ({ ...p, tone: String(v ?? "") })); return null; }, target: () => stepTarget(3) },
      length: {
        get: () => genOptions.length,
        set: (v) => { const l = String(v ?? "").toLowerCase(); if (!["short", "medium", "long"].includes(l)) return "Use short, medium or long."; setGenOptions((p) => ({ ...p, length: l as GenerationOptions["length"] })); return null; },
        options: () => [{ value: "short", label: "Short (about 350 words)" }, { value: "medium", label: "Medium (about 750 words)" }, { value: "long", label: "Long (about 1,300 words)" }],
        target: () => stepTarget(3),
      },
      content_format: {
        get: () => genOptions.content_format,
        set: (v) => { const f = String(v ?? "").toLowerCase(); if (!["markdown", "html"].includes(f)) return "Use markdown or html."; setGenOptions((p) => ({ ...p, content_format: f as GenerationOptions["content_format"] })); return null; },
        options: () => [{ value: "markdown", label: "Markdown" }, { value: "html", label: "HTML" }],
        target: () => stepTarget(3),
      },
      image_provider: {
        get: () => genOptions.image_provider,
        set: (v) => { const f = String(v ?? "").toLowerCase(); if (!["auto", "openai", "gemini", "local"].includes(f)) return "Use auto, openai, gemini or local."; setGenOptions((p) => ({ ...p, image_provider: f as GenerationOptions["image_provider"] })); return null; },
        options: () => [{ value: "auto", label: "Best available" }, { value: "openai", label: "OpenAI images (your key)" }, { value: "gemini", label: "Gemini images (your key)" }, { value: "local", label: "Designed cover (local, free)" }],
        target: () => stepTarget(3),
      },
      image_style: { get: () => genOptions.image_style, set: (v) => { setGenOptions((p) => ({ ...p, image_style: String(v ?? "").slice(0, 200) })); return null; }, target: () => stepTarget(3) },
      documents: {
        get: () => aiConfig.document_ids.map((id) => knowledgeDocs.find((d) => d.id === id)?.title ?? id).join(", "),
        set: (v) => {
          const wanted = String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
          const ids: number[] = [];
          for (const w of wanted) {
            const doc = knowledgeDocs.find((d) => String(d.id) === w || d.title.toLowerCase() === w.toLowerCase());
            if (!doc) return `No knowledge document "${w}". Documents: ${knowledgeDocs.map((d) => d.title).join(", ") || "none uploaded yet"}.`;
            if (!ids.includes(doc.id)) ids.push(doc.id);
          }
          setAiConfig((p) => ({ ...p, document_ids: ids }));
          return null;
        },
        options: () => knowledgeDocs.map((d) => ({ value: d.id, label: d.title })),
        target: () => stepTarget(3),
      },
    },
    describe: () => ({
      provider: aiConfig.provider, model: aiConfig.model || "(provider default)", topic: aiConfig.topic, tone: genOptions.tone,
      length: genOptions.length, content_format: genOptions.content_format, writes_images: hasImage,
      image_provider: genOptions.image_provider, image_provider_resolved: fieldPlan?.image_provider?.reason,
      documents: aiConfig.document_ids.map((id) => knowledgeDocs.find((d) => d.id === id)?.title ?? id),
      available_documents: knowledgeDocs.map((d) => d.title),
    }),
    actions: { back: { run: () => goBack(2) }, next: { run: () => goNext(3) } },
  }), step === 3);

  useOrbitSurface("builder.schedule", () => ({
    target: stepTarget(4),
    fields: {
      frequency: { get: () => schedule.frequency, set: (v) => { const f = String(v).toUpperCase(); if (!["DAILY", "WEEKLY", "ONE_TIME"].includes(f)) return "Use DAILY, WEEKLY or ONE_TIME."; setSchedule((p) => ({ ...p, frequency: f as any, end_date: f === "ONE_TIME" ? null : p.end_date })); return null; }, options: () => [{ value: "DAILY", label: "Daily" }, { value: "WEEKLY", label: "Weekly" }, { value: "ONE_TIME", label: "One time" }], target: () => stepTarget(4) },
      start_date: { get: () => schedule.start_date, set: (v) => { if (!dateOk(v)) return "Use YYYY-MM-DD."; setSchedule((p) => ({ ...p, start_date: String(v) })); return null; }, target: () => stepTarget(4) },
      end_date: { get: () => schedule.end_date ?? "", set: (v) => { const s = String(v ?? "").trim(); if (s && !dateOk(s)) return "Use YYYY-MM-DD or leave empty for no end date."; setSchedule((p) => ({ ...p, end_date: s || null })); return null; }, target: () => stepTarget(4) },
      weekly_days: { get: () => schedule.weekly_days.join(","), set: (v) => { const days = String(v ?? "").split(",").map((x) => Number(x.trim())).filter((d) => d >= 1 && d <= 7); if (!days.length) return "Use ISO weekdays 1-7, e.g. 1,4 for Monday and Thursday."; setSchedule((p) => ({ ...p, weekly_days: days })); return null; }, target: () => stepTarget(4) },
      timezone: { get: () => schedule.timezone, set: (v) => { const z = String(v ?? "").trim(); if (!z) return "Timezone is required."; setSchedule((p) => ({ ...p, timezone: z })); return null; }, target: () => stepTarget(4) },
      generation_time: { get: () => schedule.generation_time, set: (v) => { if (!timeOk(v)) return "Use HH:MM (24h)."; setSchedule((p) => ({ ...p, generation_time: String(v) })); return null; }, target: () => stepTarget(4) },
      publication_time: { get: () => schedule.publication_time, set: (v) => { if (!timeOk(v)) return "Use HH:MM (24h)."; setSchedule((p) => ({ ...p, publication_time: String(v) })); return null; }, target: () => stepTarget(4) },
      require_approval: { get: () => String(approval.require_approval), set: (v) => { setApproval((p) => ({ ...p, require_approval: String(v) === "true" })); return null; }, options: () => [{ value: "true", label: "Require approval" }, { value: "false", label: "No approval" }], target: () => stepTarget(4) },
      timeout_policy: {
        get: () => approval.timeout_policy,
        set: (v) => { const t = String(v ?? "").toUpperCase(); if (!["KEEP_DRAFT", "AUTO_PUBLISH_LATEST", "CANCEL"].includes(t)) return "Use KEEP_DRAFT, AUTO_PUBLISH_LATEST or CANCEL."; setApproval((p) => ({ ...p, timeout_policy: t as ApprovalConfig["timeout_policy"] })); return null; },
        options: () => [
          { value: "KEEP_DRAFT", label: "Keep it as a draft (nothing is published)" },
          { value: "AUTO_PUBLISH_LATEST", label: "Publish it anyway" },
          { value: "CANCEL", label: "Cancel the run" },
        ],
        target: () => stepTarget(4),
      },
      reviewer_email: { get: () => approval.reviewer_email, set: (v) => { const e = String(v ?? "").trim(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return "That is not a valid email."; setApproval((p) => ({ ...p, reviewer_email: e })); return null; }, target: () => stepTarget(4) },
    },
    actions: { back: { run: () => goBack(3) }, next: { run: () => goNext(4) } },
  }), step === 4);

  useOrbitSurface("builder.review", () => ({
    target: stepTarget(5),
    describe: () => ({
      name, table: targetTable, mode, schedule, approval: approval.require_approval, reviewer: approval.reviewer_email || undefined,
      preview: preview
        ? {
            record: Object.fromEntries(Object.entries(preview.payload ?? {}).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 160) : v])),
            write_plan: preview.meta?.write_plan,
            missing_fields: preview.meta?.missing_fields,
            next_runs: preview.schedule?.next_runs,
          }
        : null,
      preview_error: previewError?.message,
    }),
    actions: {
      preview: { run: async () => { await handlePreview(); return { success: true, message: "Preview generated (shown on screen)." }; } },
      back: { run: () => goBack(4) },
      create: {
        enabled: () => !!selectedConnId && !!name.trim() && !isSubmitting,
        run: async () => {
          try {
            setIsSubmitting(true);
            const res: any = await api.createAutomation(buildAutomationPayload());
            sessionStorage.removeItem(DRAFT_KEY);
            navigate("/automations");
            return { success: true, message: res?.message || "Automation created and enabled.", resource: res?.automation?.id ? { type: "Automation", id: res.automation.id } : undefined };
          } catch (err: any) {
            setError(err.message);
            return { success: false, message: err.message || "Creating the automation failed." };
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    },
  }), step === 5);

  // ---------------------------------------------------------------- render helpers
  const wizardSteps = [
    { num: 1, label: "Setup" },
    { num: 2, label: "Fields" },
    { num: 3, label: manual ? "Content" : "AI & content" },
    { num: 4, label: "Schedule" },
    { num: 5, label: "Preview & save" },
  ];

  const navButtons = (n: number, nextLabel: string) => (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between">
      {n > 1 ? (
        <button type="button" onClick={() => goBack(n - 1)} className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      ) : <span />}
      <button type="button" onClick={() => goNext(n)} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700">
        <span>{nextLabel}</span> <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const card = "bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5 shadow-xs";
  const stepMotion = { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 }, transition: { duration: 0.2 } };

  return (
    <motion.div id="automation-builder-anchor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">New automation</span>
            <span className="text-xs text-slate-400">Step {step} of 5</span>
            {draftRestored && (
              <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"><Check className="h-3 w-3" /> Draft restored</span>
            )}
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">Create a database automation</h2>
          <p className="mt-0.5 text-xs text-slate-500">Writes new rows into any table you choose: blog posts, articles, news, products, FAQs.</p>
        </div>
        {draftRestored && (
          <button type="button" onClick={handleClearDraft} className="flex items-center gap-1 self-start text-[11px] font-semibold text-slate-400 hover:text-slate-600 sm:self-auto">
            <RotateCcw className="h-3 w-3" /> Start over
          </button>
        )}
      </div>

      {/* Progress */}
      <nav aria-label="Progress" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4">
        <ol className="flex gap-1 overflow-x-auto pb-1 text-xs font-semibold sm:justify-between">
          {wizardSteps.map((s) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <li key={s.num} className="shrink-0">
                <button
                  type="button"
                  onClick={() => s.num < step && setStep(s.num)}
                  disabled={s.num > step}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition ${active ? "border border-indigo-200 bg-indigo-50 text-indigo-700" : done ? "cursor-pointer text-emerald-700 hover:bg-emerald-50" : "cursor-not-allowed text-slate-400"}`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${active ? "bg-indigo-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {done ? <Check className="h-3.5 w-3.5" /> : s.num}
                  </span>
                  <span className={`whitespace-nowrap ${active ? "" : "hidden sm:inline"}`}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div initial={false} animate={{ width: `${(step / 5) * 100}%` }} transition={{ duration: 0.3 }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600" />
        </div>
      </nav>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} role="alert" className="flex items-start justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><span className="font-medium">{error}</span></div>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* STEP 1 ------------------------------------------------------------ */}
        {step === 1 && (
          <motion.div key="s1" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(1), el) : orbitTargets.unregister(stepTarget(1)))} className={card}>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Database className="h-4 w-4 text-indigo-600" /> What should this automation create?</h3>
              <p className="mt-0.5 text-xs text-slate-500">Pick a starting template or describe it in your own words, then choose where the rows go.</p>
            </div>

            {loadingConnections ? (
              <div className="space-y-2 py-10 text-center text-xs text-slate-500">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600" />
                <p>Loading your database connections…</p>
              </div>
            ) : connections.length === 0 ? (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-800">
                <p className="text-sm font-semibold">Connect a database first</p>
                <p className="text-slate-600">Automations write into one of your own MySQL databases. Add and test a connection, then come back.</p>
                <Link to="/connections" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"><Database className="h-3.5 w-3.5" /> Go to Connections</Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {workflowTemplates.map((t) => {
                    const Icon = t.icon;
                    const sel = selectedTemplateId === t.id;
                    return (
                      <button key={t.id} type="button" onClick={t.apply} aria-pressed={sel} className={`flex flex-col justify-between rounded-xl border p-3 text-left transition ${sel ? "border-indigo-600 bg-white ring-2 ring-indigo-500/20" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80"}`}>
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${t.color}`}>{t.badge}</span>
                            <Icon className="h-3.5 w-3.5 text-slate-500" />
                          </div>
                          <h5 className="text-xs font-bold text-slate-900">{t.title}</h5>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{t.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2 rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/80 via-purple-50/50 to-slate-50 p-3 sm:p-4">
                  <label htmlFor="nl-plan" className="flex items-center gap-2 text-xs font-bold text-slate-900"><Cpu className="h-4 w-4 text-indigo-600" /> Or describe it in plain words</label>
                  <textarea id="nl-plan" rows={2} value={naturalPrompt} onChange={(e) => setNaturalPrompt(e.target.value)} placeholder="e.g. One practical article about cloud databases every weekday for two weeks, in the right category, with a banner image. Email me to approve; publish at 9 AM." className="w-full resize-none rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20" />
                  <div className="flex justify-end">
                    <button type="button" disabled={isProposing || !selectedConnId || !naturalPrompt.trim()} onClick={handleProposeAutomation} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50">
                      {isProposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {isProposing ? "Reading your schema…" : "Fill in the steps for me"}
                    </button>
                  </div>
                  {proposeFeedback && <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-900"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{proposeFeedback}</p>}
                </div>

                <div>
                  <label htmlFor="automation-name" className="mb-1.5 block text-xs font-semibold text-slate-700">Name</label>
                  <input id="automation-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily tech blog" className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Database connection</label>
                    <SearchableSelect value={selectedConnId} onChange={(v) => setSelectedConnId(Number(v))} placeholder="Choose a connection" options={connections.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name || c.database || ""})`, badge: c.driver || c.db_type || "mysql" }))} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Table to write into</label>
                    <SearchableSelect
                      value={targetTable}
                      onChange={(v) => setTargetTable(String(v))}
                      placeholder={schema ? "Choose a table" : "Loading tables…"}
                      searchPlaceholder="Search tables…"
                      options={(schema?.tables ?? []).filter((t: any) => t.category !== "RESTRICTED").map((t: any) => ({ value: t.name, label: t.name, badge: t.category === "RECOMMENDED" ? "recommended" : t.category === "REVIEW_REQUIRED" ? "review" : undefined }))}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Account, credential and payment tables are hidden: automations can never write to them.</p>
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">Content source</span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Content source">
                    {[
                      { v: "AI_GENERATED" as Mode, l: "AI writes it", d: "Text, linked records and images are generated for each run.", icon: Sparkles },
                      { v: "MANUAL" as Mode, l: "Fixed values (no AI)", d: "Every run writes the values you set; no model is called.", icon: Sliders },
                    ].map((o) => {
                      const Icon = o.icon;
                      const active = mode === o.v;
                      return (
                        <button key={o.v} type="button" role="radio" aria-checked={active} onClick={() => setMode(o.v)} className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${active ? "border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/15" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                          <span><span className="block text-xs font-bold text-slate-900">{o.l}</span><span className="block text-[11px] text-slate-500">{o.d}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {navButtons(1, "Continue to fields")}
              </>
            )}
          </motion.div>
        )}

        {/* STEP 2 ------------------------------------------------------------ */}
        {step === 2 && (
          <motion.div key="s2" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(2), el) : orbitTargets.unregister(stepTarget(2)))} className={card}>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><TableProperties className="h-4 w-4 text-indigo-600" /> How each column of <code className="rounded bg-slate-100 px-1.5 text-indigo-700">{targetTable}</code> is filled</h3>
                <p className="mt-0.5 text-xs text-slate-500">Read from your live database. Safe choices are already selected; change only what you need.</p>
              </div>
              <button type="button" onClick={loadFieldPlan} disabled={planLoading} className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${planLoading ? "animate-spin" : ""}`} /> Re-read table
              </button>
            </div>
            {planLoading && !fieldPlan ? (
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
            ) : planError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                <p className="font-semibold">Could not read this table.</p>
                <p className="mt-1">{planError}</p>
                <button type="button" onClick={loadFieldPlan} className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white">Try again</button>
              </div>
            ) : fieldPlan && selectedConnId ? (
              <FieldMappingStep plan={fieldPlan} mappings={mappings} onChange={(col, m) => setMappings((p) => ({ ...p, [col]: m }))} problems={problems} connectionId={selectedConnId} manual={manual} length={genOptions.length} format={genOptions.content_format} timezone={schedule.timezone} />
            ) : null}
            {navButtons(2, manual ? "Continue" : "Continue to AI settings")}
          </motion.div>
        )}

        {/* STEP 3 ------------------------------------------------------------ */}
        {step === 3 && (
          <motion.div key="s3" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(3), el) : orbitTargets.unregister(stepTarget(3)))} className={card}>
            {manual ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p className="flex items-center gap-1.5 font-bold text-slate-900"><Sliders className="h-4 w-4" /> AI is off for this automation</p>
                <p>Each run writes the fixed values from the previous step. No model or image service is called.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Cpu className="h-4 w-4 text-indigo-600" /> What should the AI write?</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Each run picks a new angle on this topic and avoids repeating recent titles.</p>
                  </div>
                  <button type="button" onClick={() => setShowDocUploadModal(true)} className="inline-flex items-center gap-1.5 self-start rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"><Upload className="h-3.5 w-3.5" /> Add a document</button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="topic" className="text-xs font-semibold text-slate-700">Topic and direction</label>
                    <InlineAiFieldAssist fieldName="topic" currentValue={aiConfig.topic} topic={name} targetTable={targetTable} onApply={(v) => setAiConfig((p) => ({ ...p, topic: v }))} />
                  </div>
                  <textarea id="topic" rows={3} value={aiConfig.topic} onChange={(e) => setAiConfig((p) => ({ ...p, topic: e.target.value }))} placeholder="e.g. Practical guides on running MySQL in production for small teams: indexing, backups, migrations and monitoring." className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20" />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">Tone</label>
                    <SearchableSelect value={TONES.includes(genOptions.tone) ? genOptions.tone : "__custom"} onChange={(v) => setGenOptions((p) => ({ ...p, tone: v === "__custom" ? "" : String(v) }))} options={[...TONES.map((t) => ({ value: t, label: t })), { value: "__custom", label: "Custom…" }]} showSearch={false} />
                    {!TONES.includes(genOptions.tone) && (
                      <input value={genOptions.tone} onChange={(e) => setGenOptions((p) => ({ ...p, tone: e.target.value }))} placeholder="Describe the tone" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20" />
                    )}
                  </div>
                  {hasBody && (
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">Length of the main text</span>
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Length">
                        {(["short", "medium", "long"] as const).map((l) => (
                          <button key={l} type="button" role="radio" aria-checked={genOptions.length === l} onClick={() => setGenOptions((p) => ({ ...p, length: l }))} className={`rounded-lg py-1.5 text-xs font-semibold capitalize transition ${genOptions.length === l ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}>
                            {l} <span className="hidden font-normal text-slate-400 sm:inline">~{l === "short" ? 350 : l === "medium" ? 750 : 1300}w</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasBody && (
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">Format stored in the database</span>
                      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Body format">
                        {([["markdown", "Markdown"], ["html", "HTML"]] as const).map(([v, l]) => (
                          <button key={v} type="button" role="radio" aria-checked={genOptions.content_format === v} onClick={() => setGenOptions((p) => ({ ...p, content_format: v }))} className={`rounded-lg py-1.5 text-xs font-semibold transition ${genOptions.content_format === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}>{l}</button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">Choose HTML if your website shows the column as-is (most WYSIWYG CMSs).</p>
                    </div>
                  )}
                  {hasImage && (
                    <div>
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><ImageIcon className="h-3.5 w-3.5 text-indigo-600" /> Images</span>
                      <SearchableSelect
                        value={genOptions.image_provider}
                        onChange={(v) => setGenOptions((p) => ({ ...p, image_provider: v as any }))}
                        showSearch={false}
                        options={[
                          { value: "auto", label: "Best available (recommended)" },
                          { value: "openai", label: "OpenAI images (your key)" },
                          { value: "gemini", label: "Gemini images (your key)" },
                          { value: "local", label: "Designed cover (local, free)" },
                        ]}
                      />
                      {fieldPlan?.image_provider && genOptions.image_provider === "auto" && <p className="mt-1 text-[11px] text-slate-500">{fieldPlan.image_provider.reason}</p>}
                      <input value={genOptions.image_style} onChange={(e) => setGenOptions((p) => ({ ...p, image_style: e.target.value }))} placeholder="Optional style, e.g. flat illustration, warm colors" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20" />
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-slate-50 to-purple-50/40 p-3 sm:p-4">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                    <span className="flex items-center gap-2 text-xs font-bold text-slate-900"><Server className="h-4 w-4 text-indigo-600" /> Text model</span>
                    <Link to="/ai-providers" className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">Manage providers and keys →</Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      { id: "ollama", name: "Ollama", note: "Local, free" },
                      { id: "gemini", name: "Gemini", note: "Your key" },
                      { id: "anthropic", name: "Claude", note: "Your key" },
                      { id: "openai", name: "OpenAI", note: "Your key" },
                      { id: "mock", name: "Test mode", note: "Fake text" },
                    ].map((p) => {
                      const info = availableProviders.find((x) => x.provider_id === p.id);
                      const ready = info?.is_available || p.id === "mock";
                      const sel = aiConfig.provider === p.id;
                      return (
                        <button key={p.id} type="button" aria-pressed={sel} onClick={() => {
                          const models = info?.models || (info as any)?.available_models || [];
                          setAiConfig((prev) => ({ ...prev, provider: p.id, model: info?.current_model || models[0] || "" }));
                        }} className={`rounded-xl border p-2.5 text-left transition ${sel ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                          <span className="block text-xs font-bold">{p.name}</span>
                          <span className={`text-[10px] ${sel ? "text-indigo-100" : ready ? "text-emerald-600" : "text-amber-600"}`}>{ready ? `● ${p.note}` : "Not set up"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const info = availableProviders.find((x) => x.provider_id === aiConfig.provider);
                    const models: string[] = info?.models || (info as any)?.available_models || [];
                    return (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {models.length > 0 ? (
                          <SearchableSelect value={aiConfig.model} onChange={(v) => setAiConfig((p) => ({ ...p, model: String(v) }))} options={models.map((m) => ({ value: m, label: m }))} placeholder="Choose a model" />
                        ) : (
                          <input value={aiConfig.model} onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))} placeholder="Model name (leave empty for the default)" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20" />
                        )}
                        <p className="self-center text-[11px] text-slate-500">
                          {aiConfig.provider === "ollama" ? "Runs on this machine: private and free. Small models are faster; larger ones write better." : aiConfig.provider === "mock" ? "Test mode writes placeholder text without calling a model. Use it only to try the flow." : "Uses your own encrypted API key."}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><BookOpen className="h-3.5 w-3.5 text-indigo-600" /> Ground it in your documents (optional)</span>
                    <span className="text-[11px] text-slate-400">{aiConfig.document_ids.length} of {knowledgeDocs.length} selected</span>
                  </div>
                  {knowledgeDocs.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                      No documents yet. Upload Markdown, text or PDF files so the AI can use your facts.
                      <button type="button" onClick={() => setShowDocUploadModal(true)} className="ml-1 font-semibold text-indigo-600 hover:underline">Upload one</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <button type="button" onClick={() => setDocDropdownOpen((o) => !o)} aria-expanded={docDropdownOpen} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-xs hover:border-slate-300">
                        <span className={aiConfig.document_ids.length ? "font-semibold text-slate-900" : "text-slate-500"}>
                          {aiConfig.document_ids.length ? `${aiConfig.document_ids.length} document${aiConfig.document_ids.length > 1 ? "s" : ""} selected` : "Choose documents…"}
                        </span>
                        {docDropdownOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      </button>
                      {docDropdownOpen && (
                        <div className="absolute left-0 right-0 z-30 mt-1 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                          <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input value={docSearchFilter} onChange={(e) => setDocSearchFilter(e.target.value)} placeholder="Search documents…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                          <div className="max-h-48 space-y-1 overflow-y-auto">
                            {knowledgeDocs.filter((d) => d.title.toLowerCase().includes(docSearchFilter.toLowerCase())).map((doc) => {
                              const sel = aiConfig.document_ids.includes(doc.id);
                              return (
                                <label key={doc.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-xs ${sel ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"}`}>
                                  <input type="checkbox" checked={sel} onChange={(e) => setAiConfig((p) => ({ ...p, document_ids: e.target.checked ? [...p.document_ids, doc.id] : p.document_ids.filter((i) => i !== doc.id) }))} className="rounded border-slate-300 text-indigo-600" />
                                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                                  <span className="text-[10px] text-slate-400">{doc.chunk_count || 0} chunks</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            {navButtons(3, "Continue to schedule")}
          </motion.div>
        )}

        {/* STEP 4 ------------------------------------------------------------ */}
        {step === 4 && (
          <motion.div key="s4" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(4), el) : orbitTargets.unregister(stepTarget(4)))} className={card}>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Clock className="h-4 w-4 text-indigo-600" /> When should it run?</h3>
              <p className="mt-0.5 text-xs text-slate-500">Content is generated first; it is written to your database at the publication time.</p>
            </div>
            <ScheduleStep
              schedule={schedule}
              onScheduleChange={setSchedule}
              approval={approval}
              onApprovalChange={setApproval}
              userEmail={user?.email}
              targetTable={targetTable}
              onValidity={(v) => setScheduleValid(v)}
            />
            {navButtons(4, "Continue to preview")}
          </motion.div>
        )}

        {/* STEP 5 ------------------------------------------------------------ */}
        {step === 5 && (
          <motion.div key="s5" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(5), el) : orbitTargets.unregister(stepTarget(5)))} className={card}>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Eye className="h-4 w-4 text-indigo-600" /> Preview a real run, then save</h3>
              <p className="mt-0.5 text-xs text-slate-500">The preview runs the same steps as a scheduled run, including images and the exact database plan, but writes nothing.</p>
            </div>

            <div className="rounded-xl border border-slate-200">
              <button type="button" onClick={() => setShowRecap((s) => !s)} aria-expanded={showRecap} className="flex w-full items-center justify-between px-3.5 py-2.5 text-left">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><Workflow className="h-3.5 w-3.5 text-indigo-600" /> Your settings</span>
                {showRecap ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {showRecap && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 px-3.5 py-3 text-xs sm:grid-cols-2">
                  {[
                    ["Name", name || "—", 1],
                    ["Writes into", `${targetTable} · ${selectedConnection?.name ?? ""}`, 1],
                    ["Columns", `${Object.values(mappings).filter((m) => m.mapping_type !== "DB_DEFAULT" && m.mapping_type !== "LEAVE_EMPTY").length} filled · ${fieldPlan?.columns.filter((c) => ["AI", "AI_CREATE", "AI_REUSE"].includes(modeOf(mappings[c.name], c))).length ?? 0} by AI`, 2],
                    ["Content", manual ? "Fixed values (AI off)" : `${aiConfig.provider}${aiConfig.model ? ` · ${aiConfig.model}` : ""} · ${genOptions.length}${hasImage ? " · with images" : ""}`, 3],
                    ["Schedule", `${schedule.frequency === "ONE_TIME" ? "Once" : schedule.frequency === "DAILY" ? "Daily" : "Weekly"} · generate ${formatTime12(schedule.generation_time)} → publish ${formatTime12(schedule.publication_time)} (${schedule.timezone})`, 4],
                    ["Approval", approval.require_approval ? `Email ${approval.reviewer_email || user?.email || "you"} · if no reply: ${approval.timeout_policy === "AUTO_PUBLISH_LATEST" ? "publish" : approval.timeout_policy === "CANCEL" ? "cancel" : "keep draft"}` : "Off: publishes automatically", 4],
                  ].map(([k, v, s]) => (
                    <div key={String(k)} className="flex min-w-0 items-start justify-between gap-2">
                      <dt className="shrink-0 text-slate-400">{k}</dt>
                      <dd className="min-w-0 text-right font-semibold text-slate-800">
                        <span className="break-words">{v}</span>
                        <button type="button" onClick={() => setStep(Number(s))} className="ml-1.5 text-[10px] font-semibold text-indigo-600 hover:underline">Edit</button>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs">
                <p className="font-bold text-slate-900">Sample preview</p>
                <p className="text-slate-500">{manual ? "Checks your fixed values against the live table." : "Usually 20 seconds to 3 minutes on a local model."}</p>
              </div>
              <button type="button" onClick={handlePreview} disabled={isPreviewing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 shadow-2xs transition hover:bg-indigo-50 disabled:opacity-60">
                {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                {isPreviewing ? `Generating… ${previewSeconds}s` : preview ? "Generate another preview" : "Generate sample preview"}
              </button>
            </div>

            {isPreviewing && (
              <div className="space-y-2" aria-live="polite">
                <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            )}
            {previewError && (
              <div role="alert" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                <p className="font-bold">The preview could not be generated</p>
                <p>{previewError.message}</p>
                {previewError.events && previewError.events.length > 0 && (
                  <ul className="list-disc pl-4 text-rose-700">{previewError.events.map((e: any, i: number) => <li key={i}>{e.message}</li>)}</ul>
                )}
              </div>
            )}
            {preview && !isPreviewing && (
              <ContentPreview payload={preview.payload} meta={preview.meta} targetTable={targetTable} timezone={schedule.timezone} publicationTime={preview.schedule?.next_run?.publication_at ?? null} />
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => goBack(4)} className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
              <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {isSubmitting ? "Saving…" : "Save and schedule"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document upload modal */}
      <AnimatePresence>
        {showDocUploadModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDocUploadModal(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" />
            <motion.div role="dialog" aria-modal="true" aria-labelledby="doc-upload-title" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} className="relative z-10 w-full max-w-md space-y-4 rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 id="doc-upload-title" className="flex items-center gap-2 text-sm font-bold text-slate-900"><Upload className="h-4 w-4 text-indigo-600" /> Add a knowledge document</h3>
                <button onClick={() => setShowDocUploadModal(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
              </div>
              <form onSubmit={handleUploadDocumentInline} className="space-y-4">
                <div>
                  <label htmlFor="doc-title" className="mb-1.5 block text-xs font-semibold text-slate-700">Title</label>
                  <input id="doc-title" required value={newDocTitle} onChange={(e) => setNewDocTitle(e.target.value)} placeholder="e.g. Product handbook" className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" />
                </div>
                <div onClick={() => docFileInputRef.current?.click()} className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/40 p-4 text-center transition hover:border-indigo-300">
                  <input ref={docFileInputRef} type="file" accept=".md,.txt,.pdf" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setNewDocFile(f);
                    if (f && !newDocTitle) setNewDocTitle(f.name.replace(/\.[^/.]+$/, ""));
                  }} />
                  {newDocFile ? <span className="block truncate text-xs font-bold text-emerald-700">{newDocFile.name}</span> : <span className="text-xs text-slate-600"><Upload className="mx-auto mb-1 h-5 w-5 text-indigo-500" />Choose a .md, .txt or .pdf file</span>}
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                  <button type="button" onClick={() => setShowDocUploadModal(false)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Cancel</button>
                  <button type="submit" disabled={isUploadingDoc || !newDocFile} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {isUploadingDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{isUploadingDoc ? "Indexing…" : "Upload and select"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
