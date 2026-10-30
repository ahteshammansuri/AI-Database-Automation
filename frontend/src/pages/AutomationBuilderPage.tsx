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
import { FieldError, ModalShell, PageHeader } from "../components/ui/kit";
import { BuilderStartSkeleton } from "../components/ui/PageSkeletons";
import { usePlatform } from "../context/PlatformContext";
import { ariaFor, clearError, focusFirstError, invalid, knowledgeFileRules, rules, serverFieldErrors, validate, type FieldErrors } from "../lib/validation";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { FieldMappingStep } from "../components/automation/FieldMappingStep";
import { FieldPlan, Mapping, Mode as ColumnMode, PlanColumn, explain, mappingFor, mappingProblems, modeOf, modeOptions, serializeMappings } from "../components/automation/fieldPlan";
import { ScheduleStep, ScheduleConfig, ApprovalConfig } from "../components/automation/ScheduleStep";
import { ContentPreview } from "../components/content/ContentPreview";
import { WorkProgress, type StepStatus, type WorkStep } from "../components/ui/WorkProgress";
import type { ProgressEvent } from "../services/api";
import { defaultTimeZone, gapMinutes, todayIn, addDays, formatTime12 } from "../lib/schedule";
import { bestTableFor, templateLabel, type TemplateKind } from "../lib/tableMatch";

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

/** Where each builder field lives: its input id and wizard step (for messages under the field). */
const BUILDER_FIELD: Record<string, { id: string; step: number }> = {
  name: { id: "automation-name", step: 1 },
  connection: { id: "automation-connection", step: 1 },
  table: { id: "automation-table", step: 1 },
  topic: { id: "topic", step: 3 },
  tone: { id: "automation-tone", step: 3 },
  image_style: { id: "automation-image-style", step: 3 },
  model: { id: "automation-model", step: 3 },
  timezone: { id: "schedule-timezone", step: 4 },
  start_date: { id: "schedule-start", step: 4 },
  end_date: { id: "schedule-end", step: 4 },
  weekly_days: { id: "schedule-weekdays", step: 4 },
  generation_time: { id: "schedule-generation", step: 4 },
  publication_time: { id: "schedule-publication", step: 4 },
  reviewer_email: { id: "reviewer-email", step: 4 },
};
/** Server field names that differ from the builder's. */
const SERVER_ALIASES: Record<string, string> = {
  connection_id: "connection", target_table: "table", prompt_context: "topic", ai_model: "model",
  "generation_options.tone": "tone", "generation_options.image_style": "image_style",
};
/** The id to scroll to for a field: inputs by id, schedule pickers by their message. */
const builderFocusId = (f: string) => (BUILDER_FIELD[f]?.id.startsWith("schedule-") ? `${BUILDER_FIELD[f].id}-error` : BUILDER_FIELD[f]?.id ?? f);

export const AutomationBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const { config } = usePlatform();
  const minGap = config.automation.min_gap_minutes;
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const tz0 = defaultTimeZone();

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
  const [proposeSeconds, setProposeSeconds] = useState(0);
  useEffect(() => {
    if (!isProposing) return;
    setProposeSeconds(0);
    const t = setInterval(() => setProposeSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isProposing]);
  const [proposeFeedback, setProposeFeedback] = useState<string | null>(null);

  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<{ message: string; events?: any[] } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [previewEvents, setPreviewEvents] = useState<ProgressEvent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages shown directly under the field they are about (client checks on Next, and the server's 422).
  // Each remembers the value it was about; once the value changes (typing, picking, a template or Orbit), it hides.
  const [errorState, setErrorState] = useState<{ errors: FieldErrors; at: Record<string, unknown> }>({ errors: {}, at: {} });
  const watched: Record<string, unknown> = { name, connection: selectedConnId, table: targetTable, topic: aiConfig.topic, model: aiConfig.model, tone: genOptions.tone, image_style: genOptions.image_style };
  const setFieldErrors = (errors: FieldErrors) => setErrorState({ errors, at: watched });
  const fieldErrors: FieldErrors = Object.fromEntries(
    Object.entries(errorState.errors).filter(([f]) => !(f in watched) || watched[f] === errorState.at[f]),
  );
  const [docErrors, setDocErrors] = useState<FieldErrors>({});
  const [draftRestored, setDraftRestored] = useState(false);
  // Autosave starts only after the stored draft has been read, so it never overwrites it with defaults.
  const [hydrated, setHydrated] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showRecap, setShowRecap] = useState(true);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  // Set once the customer picks documents themselves; suggestions never override their choice.
  const [docsTouched, setDocsTouched] = useState(false);

  const manual = mode === "MANUAL";

  // ---------------------------------------------------------------- templates
  // A template also picks the table it is meant for (blog -> the posts table), from the live schema.
  const [tableNote, setTableNote] = useState<{ found: boolean; text: string } | null>(null);
  const [pendingKind, setPendingKind] = useState<TemplateKind | null>(null);
  const pickTableFor = (kind: TemplateKind, tables: any[]) => {
    const hit = bestTableFor(kind, tables);
    if (hit) {
      setTargetTable(hit.table);
      setTableNote({ found: true, text: `Picked “${hit.table}” for this template. ${hit.reason}` });
    } else {
      setTableNote({ found: false, text: `No table in this database looks like ${templateLabel(kind)}. Choose the table to write into.` });
    }
  };
  useEffect(() => {
    if (pendingKind && schema?.tables) {
      pickTableFor(pendingKind, schema.tables);
      setPendingKind(null);
    }
  }, [schema, pendingKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (id: string, cfg: { name: string; topic: string; tone: string; frequency: ScheduleConfig["frequency"]; gen: string; pub: string; approval: boolean; manual?: boolean; length?: GenerationOptions["length"]; kind?: TemplateKind }) => {
    setSelectedTemplateId(id);
    if (cfg.kind) {
      if (schema?.tables) pickTableFor(cfg.kind, schema.tables);
      else setPendingKind(cfg.kind);
    } else {
      setTableNote(null);
    }
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
      apply: () => applyTemplate("daily_blog", { name: "Daily blog post", topic: "Practical, original articles for our readers about our product area", tone: TONES[0], frequency: "DAILY", gen: "08:30", pub: "09:00", approval: true, kind: "blog" }) },
    { id: "weekly_deep_dive", title: "Weekly deep dive", description: "One long, detailed article each week, reviewed by email", icon: BookOpen, badge: "Long form", color: "text-violet-600 bg-violet-50 border-violet-200",
      apply: () => applyTemplate("weekly_deep_dive", { name: "Weekly deep dive", topic: "In-depth guides with examples and step-by-step instructions", tone: TONES[1], frequency: "WEEKLY", gen: "09:00", pub: "11:00", approval: true, length: "long", kind: "longform" }) },
    { id: "news", title: "News and updates", description: "Short, timely news items published twice a day", icon: Zap, badge: "Short", color: "text-amber-600 bg-amber-50 border-amber-200",
      apply: () => applyTemplate("news", { name: "News updates", topic: "Short news items and announcements relevant to our audience", tone: TONES[3], frequency: "DAILY", gen: "07:30", pub: "08:00", approval: true, length: "short", kind: "news" }) },
    { id: "product_seo", title: "Product descriptions", description: "Benefit-led product copy with SEO fields", icon: Sparkles, badge: "E-commerce", color: "text-emerald-600 bg-emerald-50 border-emerald-200",
      apply: () => applyTemplate("product_seo", { name: "Product descriptions", topic: "Product highlights, customer benefits and clear specifications", tone: TONES[5], frequency: "WEEKLY", gen: "09:00", pub: "09:30", approval: true, length: "short", kind: "product" }) },
    { id: "faq", title: "FAQ entries", description: "Question-and-answer pairs grounded in your documents", icon: BookOpen, badge: "Knowledge", color: "text-sky-600 bg-sky-50 border-sky-200",
      apply: () => applyTemplate("faq", { name: "FAQ entries", topic: "Frequently asked questions with direct, accurate answers", tone: TONES[3], frequency: "DAILY", gen: "10:00", pub: "10:30", approval: true, length: "short", kind: "faq" }) },
    { id: "manual_schedule", title: "Manual (no AI)", description: "Fixed values on a schedule; AI is never called", icon: Calendar, badge: "No AI", color: "text-slate-600 bg-slate-100 border-slate-300",
      apply: () => applyTemplate("manual_schedule", { name: "Scheduled fixed content", topic: "", tone: TONES[0], frequency: "DAILY", gen: "08:30", pub: "09:00", approval: false, manual: true }) },
  ];

  // ---------------------------------------------------------------- draft persistence
  // The draft lives on the server (every step, the connection, the table and each column choice), so it survives
  // closing the tab or opening the builder on another device. A draft from the old per-tab storage is moved over once.
  const applyDraft = (d: any) => {
    if (d.name !== undefined && d.name !== null) setName(d.name);
    if (d.targetTable !== undefined && d.targetTable !== null) setTargetTable(d.targetTable);
    if (d.mode) setMode(d.mode);
    if (d.aiConfig) {
      setAiConfig((p) => ({
        ...p,
        ...d.aiConfig,
        provider: d.aiConfig.provider ?? p.provider,
        model: d.aiConfig.model ?? "",
        topic: d.aiConfig.topic ?? "",
        document_ids: Array.isArray(d.aiConfig.document_ids) ? d.aiConfig.document_ids : [],
      }));
    }
    if (d.genOptions) {
      setGenOptions((p) => ({
        ...p,
        ...d.genOptions,
        tone: d.genOptions.tone ?? p.tone,
        length: d.genOptions.length ?? p.length,
        content_format: d.genOptions.content_format ?? p.content_format,
        image_provider: d.genOptions.image_provider ?? p.image_provider,
        image_style: d.genOptions.image_style ?? "",
      }));
    }
    if (d.schedule) {
      setSchedule({
        ...defaultSchedule(tz0),
        ...d.schedule,
        weekly_days: Array.isArray(d.schedule.weekly_days) ? d.schedule.weekly_days : [],
      });
    }
    if (d.approval) {
      setApproval((p) => ({
        ...p,
        ...d.approval,
        reviewer_email: d.approval.reviewer_email ?? "",
      }));
    }
    if (d.mappings && d.targetTable) {
      setMappings(d.mappings);
      mappingsTableRef.current = `${d.connectionId}:${d.targetTable}`;
    }
    if (d.connectionId) setSelectedConnId(d.connectionId);
    if (d.selectedTemplateId) setSelectedTemplateId(d.selectedTemplateId);
    if (d.naturalPrompt !== undefined && d.naturalPrompt !== null) setNaturalPrompt(d.naturalPrompt);
    if (d.docsTouched) setDocsTouched(true);
    if (d.step) setStep(Math.min(d.step, 5));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let d: any = null;
      try {
        const res = await api.getDraft("automation");
        d = res?.draft ? { ...res.draft.payload, step: res.draft.step } : null;
        setDraftSavedAt(res?.draft?.updated_at ?? null);
      } catch {
        // offline: fall back to an old per-tab draft below
      }
      if (!d) {
        try {
          const raw = sessionStorage.getItem(DRAFT_KEY);
          d = raw ? JSON.parse(raw) : null;
        } catch {
          d = null;
        }
      }
      if (cancelled) return;
      if (d && (d.name || d.targetTable || (d.step ?? 1) > 1)) {
        applyDraft(d);
        setDraftRestored(true);
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated) return;
    // Nothing started yet (only automatic defaults): no draft to keep.
    if (!(name || "").trim() && !selectedTemplateId && !(naturalPrompt || "").trim() && step === 1) {
      setDraftState("idle");
      return;
    }
    const payload = { name, targetTable, mode, aiConfig, genOptions, schedule, approval, mappings, connectionId: selectedConnId, selectedTemplateId, naturalPrompt, docsTouched };
    setDraftState("saving");
    const t = setTimeout(async () => {
      try {
        const res = await api.saveDraft("automation", payload, step);
        setDraftSavedAt(res?.saved_at ?? new Date().toISOString());
        setDraftState("saved");
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        setDraftState("error");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [hydrated, name, targetTable, mode, aiConfig, genOptions, schedule, approval, mappings, selectedConnId, step, selectedTemplateId, naturalPrompt, docsTouched]);

  const discardDraft = () => {
    sessionStorage.removeItem(DRAFT_KEY);
    api.deleteDraft("automation").catch(() => {});
  };

  const handleClearDraft = () => {
    discardDraft();
    setSelectedTemplateId(null);
    setNaturalPrompt("");
    setDocsTouched(false);
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
    if (!selectedConnId || !hydrated) return;
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
  }, [selectedConnId, searchParams, hydrated]);

  // The table currently chosen; a field plan that arrives for an older choice is ignored.
  const currentPlanKey = useRef("");
  useEffect(() => {
    currentPlanKey.current = `${selectedConnId}:${targetTable}`;
  }, [selectedConnId, targetTable]);

  const loadFieldPlan = useCallback(async () => {
    if (!selectedConnId || !targetTable) return;
    const key = `${selectedConnId}:${targetTable}`;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan: FieldPlan = await api.getFieldPlan(selectedConnId, targetTable, genOptions.image_provider);
      if (currentPlanKey.current !== key) return;
      setFieldPlan(plan);
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
    if (hydrated) loadFieldPlan();
  }, [selectedConnId, targetTable, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

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
    name: (name || "").trim(),
    connection_id: selectedConnId,
    target_table: targetTable,
    operation_mode: manual ? "MANUAL_SCHEDULE" : "AI_CREATE",
    field_mappings: serializeMappings(fieldPlan, mappings),
    ai_provider: manual ? undefined : aiConfig.provider,
    ai_model: manual ? undefined : (aiConfig.model || "").trim() || undefined,
    prompt_context: manual ? undefined : (aiConfig.topic || "").trim() || undefined,
    generation_options: manual ? undefined : {
      tone: genOptions.tone,
      length: genOptions.length,
      content_format: genOptions.content_format,
      image_provider: genOptions.image_provider,
      image_style: (genOptions.image_style || "").trim() || undefined,
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
    reviewer_email: (approval.reviewer_email || "").trim() || undefined,
    timeout_policy: approval.timeout_policy,
    is_active: true,
  });

  // ---------------------------------------------------------------- actions
  const handleProposeAutomation = async () => {
    if (!selectedConnId) return setError("Select a database connection first.");
    if (!(naturalPrompt || "").trim()) return setError("Describe what you want to automate first.");
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
    const found = validate({ title: newDocTitle, file: newDocFile }, { title: [rules.maxLength(255, "Title")], file: knowledgeFileRules(config.platform.knowledge_max_upload_mb) });
    setDocErrors(found);
    if (Object.keys(found).length || !newDocFile) {
      focusFirstError(found, (f) => (f === "file" ? "doc-file" : "doc-title"));
      return;
    }
    try {
      setIsUploadingDoc(true);
      const res = await api.uploadKnowledge(newDocTitle || newDocFile.name.replace(/\.[^/.]+$/, ""), newDocFile);
      const docs = await api.listKnowledge();
      setKnowledgeDocs(Array.isArray(docs) ? docs : []);
      if (res?.id) setAiConfig((p) => ({ ...p, document_ids: [...p.document_ids, res.id] }));
      setNewDocTitle("");
      setNewDocFile(null);
      setDocErrors({});
      setShowDocUploadModal(false);
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      setDocErrors(Object.keys(fields).length ? fields : { file: `Upload failed: ${err.message}` });
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // Documents that match the topic are suggested and, until the customer picks documents themselves, selected.
  const [suggestedDocs, setSuggestedDocs] = useState<{ id: number; title: string; score: number }[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    const topic = (aiConfig.topic || "").trim();
    if (step !== 3 || manual || knowledgeDocs.length === 0 || topic.length < 8) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSuggesting(true);
      try {
        const res = await api.suggestKnowledge(topic);
        if (cancelled) return;
        const found = res?.suggestions ?? [];
        setSuggestedDocs(found);
        if (!docsTouched) setAiConfig((p) => ({ ...p, document_ids: found.map((d) => d.id) }));
      } catch {
        // suggestions are optional
      } finally {
        if (!cancelled) setSuggesting(false);
      }
    }, 900);
    return () => { cancelled = true; clearTimeout(t); };
  }, [aiConfig.topic, step, manual, knowledgeDocs.length, docsTouched]);

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
      setPreviewEvents([]);
      const res = await api.previewAutomationStream(
        { ...buildAutomationPayload(), name: (name || "").trim() || "Preview", include_images: true },
        (e) => setPreviewEvents((prev) => [...prev, e]),
      );
      setPreview(res);
    } catch (err: any) {
      setPreviewError({ message: err.message, events: err.data?.events });
    } finally {
      setIsPreviewing(false);
    }
  };

  // The preview's steps for this configuration, and where each one is (from the server's own events).
  const previewSteps: WorkStep[] = [
    { key: "read", label: `Read “${targetTable || "your table"}” from your database`, detail: previewEvents.find((e) => e.stage === "TABLE_READ")?.message },
    ...(!manual && aiConfig.document_ids.length ? [{ key: "docs", label: "Search your documents", detail: previewEvents.find((e) => e.stage.startsWith("RAG_CONTEXT"))?.message }] : []),
    ...(!manual ? [{ key: "write", label: `Write the content with ${aiConfig.model || aiConfig.provider}`, detail: [...previewEvents].reverse().find((e) => e.stage.startsWith("AI_INFERENCE") || e.stage.startsWith("NOVELTY"))?.message }] : []),
    ...(!manual && hasImage ? [{ key: "images", label: "Create the images", detail: [...previewEvents].reverse().find((e) => e.stage.startsWith("IMAGE"))?.message }] : []),
    { key: "check", label: "Check the row against your table (nothing is written)", detail: previewEvents.find((e) => e.stage === "WRITE_CHECKED")?.message },
  ];
  const previewStatus: Record<string, StepStatus> = (() => {
    const has = (pred: (s: string) => boolean) => previewEvents.some((e) => pred(e.stage));
    const done: Record<string, boolean> = {
      read: has((s) => s === "TABLE_READ"),
      docs: has((s) => s.startsWith("RAG_CONTEXT")),
      write: has((s) => s === "AI_INFERENCE_COMPLETED"),
      images: has((s) => s.startsWith("WRITE_CHECK")),
      check: has((s) => s === "WRITE_CHECKED"),
    };
    const out: Record<string, StepStatus> = {};
    let activeSet = false;
    for (const st of previewSteps) {
      if (done[st.key]) out[st.key] = "done";
      else if (!activeSet) {
        out[st.key] = previewError ? "failed" : isPreviewing ? "active" : "pending";
        activeSet = true;
      } else out[st.key] = "pending";
    }
    return out;
  })();

  /** Show messages under their fields, on the earliest step that has one. */
  const showFieldErrors = (found: FieldErrors) => {
    setFieldErrors(found);
    const steps = Object.keys(found).map((f) => BUILDER_FIELD[f]?.step).filter(Boolean) as number[];
    if (steps.length) setStep(Math.min(...steps));
    // Wait for the step to animate in before scrolling to the first message.
    setTimeout(() => focusFirstError(found, builderFocusId), steps.length && Math.min(...steps) !== step ? 420 : 40);
  };

  const handleSubmit = async () => {
    for (const n of [1, 3, 4]) {
      const { fields } = stepCheck(n);
      if (Object.keys(fields).length) {
        setError(null);
        showFieldErrors(fields);
        return;
      }
    }
    try {
      setIsSubmitting(true);
      setError(null);
      const res: any = await api.createAutomation(buildAutomationPayload());
      discardDraft();
      const next = res?.automation?.schedule_summary?.next_run;
      toast.success("Automation saved", next ? `First run: ${new Date(next.generation_at).toLocaleString()}` : "It is now scheduled.");
      navigate("/automations");
    } catch (err: any) {
      const fields = serverFieldErrors(err, SERVER_ALIASES);
      const placed = Object.fromEntries(Object.entries(fields).filter(([f]) => BUILDER_FIELD[f]));
      const rest = Object.entries(fields).filter(([f]) => !BUILDER_FIELD[f]);
      if (Object.keys(placed).length) {
        setError(null);
        showFieldErrors(placed);
      } else if (rest.some(([f]) => f.startsWith("field_mappings"))) {
        // A column rule the server rejected: it belongs to the Fields step.
        setError(rest.map(([, m]) => m).join(" "));
        setStep(2);
      } else {
        setError(`Could not save: ${err.message}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------- navigation guards
  /**
   * What stops the user leaving step n: `fields` are shown under their inputs, `message` describes the whole
   * step (also returned to Orbit), and `inline` means the step already shows its own messages in place.
   */
  const stepCheck = (n: number): { fields: FieldErrors; message: string | null; inline?: boolean } => {
    if (n === 1) {
      const fields = validate({ name, connection: selectedConnId, table: targetTable }, {
        name: [rules.required("Name", "Give the automation a name."), rules.maxLength(255, "Name")],
        connection: [rules.required("Database connection", "Choose a database connection.")],
        table: [rules.required("Table", "Choose the table to write into.")],
      });
      return { fields, message: Object.values(fields)[0] ?? null };
    }
    if (n === 2) {
      if (!fieldPlan) return { fields: {}, message: planError || "The table's columns are still loading." };
      if (problemCount > 0) return { fields: {}, message: `Fix ${problemCount} column${problemCount === 1 ? "" : "s"} first (marked in red).`, inline: true };
    }
    if (n === 3 && !manual) {
      const fields = validate({ topic: aiConfig.topic, tone: genOptions.tone, image_style: genOptions.image_style, model: aiConfig.model }, {
        topic: [rules.required("Topic", "Describe what the content should be about."), rules.maxLength(4000, "Topic")],
        tone: [rules.maxLength(200, "Tone")],
        image_style: [rules.maxLength(300, "Image style")],
        model: [rules.maxLength(120, "Model")],
      });
      return { fields, message: Object.values(fields)[0] ?? null };
    }
    if (n === 4) {
      const fields = validate({ reviewer_email: approval.require_approval ? approval.reviewer_email : "" }, {
        reviewer_email: [rules.email("Reviewer email"), rules.maxLength(255, "Reviewer email")],
      });
      const gap = gapMinutes(schedule.generation_time, schedule.publication_time);
      if (gap === null || gap < minGap) return { fields, message: `Publication must be at least ${minGap} minutes after generation.`, inline: true };
      if (!scheduleValid) return { fields, message: "Fix the schedule fields marked in red first.", inline: true };
      return { fields, message: Object.values(fields)[0] ?? null };
    }
    return { fields: {}, message: null };
  };
  const goNext = (from: number) => {
    const { fields, message, inline } = stepCheck(from);
    if (message) {
      setFieldErrors(fields);
      if (Object.keys(fields).length) {
        setError(null);
        setTimeout(() => focusFirstError(fields, builderFocusId), 40);
      } else if (inline) {
        // Messages are already under the fields on this step: bring the first one into view.
        setError(null);
        document.querySelector("#automation-builder-anchor [data-invalid='true'], #automation-builder-anchor [role='alert']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setError(message);
      }
      return { success: false, message };
    }
    setError(null);
    setFieldErrors({});
    setStep(from + 1);
    return { success: true, message: `Moved to step ${from + 1}.` };
  };
  const goBack = (to: number) => {
    setError(null);
    setFieldErrors({});
    setStep(to);
    return { success: true, message: `Back to step ${to}.` };
  };

  // Editing one setting from the review returns straight to the review (after checking the steps in between).
  const [returnToReview, setReturnToReview] = useState(false);
  useEffect(() => {
    if (step === 5) setReturnToReview(false);
  }, [step]);
  const editFromReview = (s: number) => {
    setReturnToReview(true);
    setError(null);
    setFieldErrors({});
    setStep(s);
  };
  const backToReview = () => {
    for (let n = step; n <= 4; n++) {
      const { message } = stepCheck(n);
      if (message) {
        if (n !== step) {
          setStep(n);
          setTimeout(() => goNext(n), 60);
        } else {
          goNext(n);
        }
        return { success: false, message };
      }
    }
    setError(null);
    setFieldErrors({});
    setStep(5);
    return { success: true, message: "Back to the review." };
  };
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameDraftError, setNameDraftError] = useState<string | null>(null);
  const saveInlineName = () => {
    const t = (nameDraft || "").trim();
    if (!t) return setNameDraftError("Give the automation a name.");
    if (t.length > 255) return setNameDraftError("Name must be 255 characters or fewer.");
    setName(t);
    setEditingName(false);
    setNameDraftError(null);
  };

  // Schedule fields report edits themselves (ScheduleStep calls this).
  const clearFieldError = useCallback((f: string) => setErrorState((st) => ({ ...st, errors: clearError(st.errors, f) })), []);

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
      propose_plan: { enabled: () => !!selectedConnId && !!(naturalPrompt || "").trim(), run: async () => { await handleProposeAutomation(); return { success: true, message: "Plan applied; review each step.", data: { name, targetTable, mode } }; } },
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
        enabled: () => !!selectedConnId && !!(name || "").trim() && !isSubmitting,
        run: async () => {
          try {
            setIsSubmitting(true);
            const res: any = await api.createAutomation(buildAutomationPayload());
            discardDraft();
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
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-6 sm:flex-row sm:justify-between">
      {n > 1 && !returnToReview ? (
        <button type="button" onClick={() => goBack(n - 1)} className="da-btn da-btn-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      ) : <span />}
      {returnToReview ? (
        <button type="button" onClick={backToReview} className="da-btn da-btn-primary px-5">
          <Check className="h-3.5 w-3.5" /> <span>Done, back to review</span>
        </button>
      ) : (
        <button type="button" onClick={() => goNext(n)} className="da-btn da-btn-primary px-5">
          <span>{nextLabel}</span> <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
  const reviewBanner = returnToReview && step < 5 ? (
    <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-[13px] text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2"><Eye className="h-4 w-4 shrink-0 text-indigo-600" /> You came here from the review. Change what you need; everything else is kept.</span>
      <button type="button" onClick={backToReview} className="da-btn da-btn-sm shrink-0 border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"><ArrowLeft className="h-3.5 w-3.5" /> Back to review</button>
    </div>
  ) : null;

  const card = "da-card p-5 sm:p-8 space-y-6";
  const stepMotion = { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <motion.div id="automation-builder-anchor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Automate"
        title="Create an automation"
        description="Writes new rows into any table you choose: blog posts, articles, news, products, FAQs. Set it up once; it runs on schedule in the background."
        actions={
          <>
            <span className="da-chip da-chip-indigo px-3 py-1 text-[12px]">Step {step} of 5</span>
            {draftState === "saving" && <span className="da-chip px-3 py-1 text-[12px]"><Loader2 className="h-3 w-3 animate-spin" /> Saving draft…</span>}
            {draftState === "saved" && <span className="da-chip da-chip-emerald px-3 py-1 text-[12px]" title={draftSavedAt ? new Date(draftSavedAt).toLocaleString() : undefined}><Check className="h-3 w-3" /> Draft saved</span>}
            {draftState === "error" && <span className="da-chip da-chip-amber px-3 py-1 text-[12px]"><AlertCircle className="h-3 w-3" /> Draft not saved (offline?)</span>}
            {draftState === "idle" && draftRestored && <span className="da-chip da-chip-amber px-3 py-1 text-[12px]"><Check className="h-3 w-3" /> Draft restored</span>}
            {(draftRestored || name || selectedTemplateId) && (
              <button type="button" onClick={handleClearDraft} className="da-btn da-btn-ghost da-btn-sm">
                <RotateCcw className="h-3.5 w-3.5" /> Start over
              </button>
            )}
          </>
        }
      />

      {/* Progress */}
      <nav aria-label="Progress" className="da-card p-3 sm:p-4">
        <ol className="flex gap-1 overflow-x-auto pb-1 text-[13px] font-semibold sm:justify-between">
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
                  className={`flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 transition ${active ? "bg-slate-950 text-white shadow-[0_10px_24px_-12px_rgba(15,23,42,0.7)]" : done ? "cursor-pointer text-emerald-700 hover:bg-emerald-50" : "cursor-not-allowed text-slate-400"}`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${active ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {done ? <Check className="h-3.5 w-3.5" /> : s.num}
                  </span>
                  <span className={`whitespace-nowrap ${active ? "" : "hidden sm:inline"}`}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div initial={false} animate={{ width: `${(step / 5) * 100}%` }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" />
        </div>
      </nav>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} role="alert" className="flex items-start justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><span className="font-medium">{error}</span></div>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {reviewBanner}

      <AnimatePresence mode="wait">
        {/* STEP 1 ------------------------------------------------------------ */}
        {step === 1 && (
          <motion.div key="s1" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(1), el) : orbitTargets.unregister(stepTarget(1)))} className={card}>
            <div>
              <h3 className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em] text-slate-950"><Database className="h-4 w-4 text-indigo-600" /> What should this automation create?</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">Pick a starting template or describe it in your own words, then choose where the rows go.</p>
            </div>

            {loadingConnections ? (
              <BuilderStartSkeleton />
            ) : connections.length === 0 ? (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-[13px] text-amber-800">
                <p className="text-[15px] font-bold">Connect a database first</p>
                <p className="text-slate-600">Automations write into one of your own MySQL databases. Add and test a connection, then come back.</p>
                <Link to="/connections" className="da-btn da-btn-primary"><Database className="h-3.5 w-3.5" /> Go to Connections</Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {workflowTemplates.map((t) => {
                    const Icon = t.icon;
                    const sel = selectedTemplateId === t.id;
                    return (
                      <button key={t.id} type="button" onClick={t.apply} aria-pressed={sel} className={`group flex flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-300 ${sel ? "border-indigo-500 bg-indigo-50/40 ring-4 ring-indigo-500/10" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lift"}`}>
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${t.color}`}>{t.badge}</span>
                            <Icon className="h-3.5 w-3.5 text-slate-500" />
                          </div>
                          <h5 className="text-[14px] font-bold text-slate-900">{t.title}</h5>
                          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-slate-500">{t.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 p-4 sm:p-5">
                  <label htmlFor="nl-plan" className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-indigo-600 shadow-xs"><Sparkles className="h-4 w-4" /></span> Or describe it in plain words</label>
                  <textarea id="nl-plan" rows={2} value={naturalPrompt} onChange={(e) => setNaturalPrompt(e.target.value)} placeholder="e.g. One practical article about cloud databases every weekday for two weeks, in the right category, with a banner image. Email me to approve; publish at 9 AM." className="da-input resize-none" />
                  <div className="flex justify-end">
                    <button type="button" disabled={isProposing || !selectedConnId || !(naturalPrompt || "").trim()} onClick={handleProposeAutomation} className="da-btn da-btn-accent">
                      {isProposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {isProposing ? "Reading your schema…" : "Fill in the steps for me"}
                    </button>
                  </div>
                  {isProposing && (
                    <div className="space-y-2 rounded-xl border border-indigo-100 bg-white/80 p-3 text-[12.5px] text-slate-600" aria-live="polite">
                      <p className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" /> Your planning model is reading your tables and drafting the steps…</span>
                        <span className="font-mono tabular-nums text-slate-400">{proposeSeconds}s</span>
                      </p>
                      <div className="h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/3 animate-[da-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" /></div>
                      {proposeSeconds > 20 && <p className="text-[11.5px] text-slate-400">Local models can take a minute or two.</p>}
                    </div>
                  )}
                  {proposeFeedback && <p className="flex items-start gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[12.5px] text-emerald-900"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{proposeFeedback}</p>}
                </div>

                <div>
                  <label htmlFor="automation-name" className="da-label">Name</label>
                  <input id="automation-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily tech blog"
                    className={`da-input${invalid(fieldErrors.name)}`} {...ariaFor("automation-name", fieldErrors.name)} />
                  <FieldError id="automation-name" message={fieldErrors.name} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="da-label">Database connection</label>
                    <SearchableSelect id="automation-connection" invalid={!!fieldErrors.connection} value={selectedConnId} onChange={(v) => setSelectedConnId(Number(v))} placeholder="Choose a connection" options={connections.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name || c.database || ""})`, badge: c.driver || c.db_type || "mysql" }))} />
                    <FieldError id="automation-connection" message={fieldErrors.connection} />
                  </div>
                  <div>
                    <label className="da-label">Table to write into</label>
                    <SearchableSelect
                      id="automation-table"
                      invalid={!!fieldErrors.table}
                      value={targetTable}
                      onChange={(v) => { setTargetTable(String(v)); setTableNote(null); }}
                      placeholder={schema ? "Choose a table" : "Loading tables…"}
                      searchPlaceholder="Search tables…"
                      options={(schema?.tables ?? []).filter((t: any) => t.category !== "RESTRICTED").map((t: any) => ({ value: t.name, label: t.name, badge: t.category === "RECOMMENDED" ? "recommended" : t.category === "REVIEW_REQUIRED" ? "review" : undefined }))}
                    />
                    <FieldError id="automation-table" message={fieldErrors.table} />
                    {tableNote ? (
                      <p className={`mt-1.5 flex items-start gap-1.5 text-[12px] ${tableNote.found ? "text-emerald-700" : "text-amber-700"}`}>
                        {tableNote.found ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span>{tableNote.text}</span>
                      </p>
                    ) : (
                      <p className="da-help">Account, credential and payment tables are hidden: automations can never write to them.</p>
                    )}
                  </div>
                </div>

                <div>
                  <span className="da-label">Content source</span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Content source">
                    {[
                      { v: "AI_GENERATED" as Mode, l: "AI writes it", d: "Text, linked records and images are generated for each run.", icon: Sparkles },
                      { v: "MANUAL" as Mode, l: "Fixed values (no AI)", d: "Every run writes the values you set; no model is called.", icon: Sliders },
                    ].map((o) => {
                      const Icon = o.icon;
                      const active = mode === o.v;
                      return (
                        <button key={o.v} type="button" role="radio" aria-checked={active} onClick={() => setMode(o.v)} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${active ? "border-indigo-500 bg-indigo-50/50 ring-4 ring-indigo-500/10" : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50/60"}`}>
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                          <span><span className="block text-[14px] font-bold text-slate-900">{o.l}</span><span className="mt-0.5 block text-[12.5px] text-slate-500">{o.d}</span></span>
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
                <h3 className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em] text-slate-950"><TableProperties className="h-4 w-4 text-indigo-600" /> How each column of <code className="rounded bg-slate-100 px-1.5 text-indigo-700">{targetTable}</code> is filled</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">Read from your live database. Safe choices are already selected; change only what you need.</p>
              </div>
              <button type="button" onClick={loadFieldPlan} disabled={planLoading} className="da-btn da-btn-secondary da-btn-sm shrink-0 self-start">
                <RefreshCw className={`h-3.5 w-3.5 ${planLoading ? "animate-spin" : ""}`} /> Re-read table
              </button>
            </div>
            {planLoading && !fieldPlan ? (
              <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
            ) : planError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                <p className="font-semibold">Could not read this table.</p>
                <p className="mt-1">{planError}</p>
                <button type="button" onClick={loadFieldPlan} className="da-btn da-btn-danger da-btn-sm mt-3">Try again</button>
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
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 text-[13px] text-slate-600">
                <p className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900"><Sliders className="h-4 w-4" /> AI is off for this automation</p>
                <p>Each run writes the fixed values from the previous step. No model or image service is called.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <h3 className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em] text-slate-950"><Cpu className="h-4 w-4 text-indigo-600" /> What should the AI write?</h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">Each run picks a new angle on this topic and avoids repeating recent titles.</p>
                  </div>
                  <button type="button" onClick={() => setShowDocUploadModal(true)} className="da-btn da-btn-sm self-start border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"><Upload className="h-3.5 w-3.5" /> Add a document</button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="topic" className="text-[12.5px] font-semibold text-slate-700">Topic and direction</label>
                    <InlineAiFieldAssist fieldName="topic" currentValue={aiConfig.topic || ""} topic={name} targetTable={targetTable} onApply={(v) => setAiConfig((p) => ({ ...p, topic: v }))} />
                  </div>
                  <textarea id="topic" rows={3} value={aiConfig.topic || ""} onChange={(e) => setAiConfig((p) => ({ ...p, topic: e.target.value }))} placeholder="e.g. Practical guides on running MySQL in production for small teams: indexing, backups, migrations and monitoring."
                    className={`da-input${invalid(fieldErrors.topic)}`} {...ariaFor("topic", fieldErrors.topic)} />
                  <FieldError id="topic" message={fieldErrors.topic} />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="da-label">Tone</label>
                    <SearchableSelect value={TONES.includes(genOptions.tone) ? genOptions.tone : "__custom"} onChange={(v) => setGenOptions((p) => ({ ...p, tone: v === "__custom" ? "" : String(v) }))} options={[...TONES.map((t) => ({ value: t, label: t })), { value: "__custom", label: "Custom…" }]} showSearch={false} />
                    {!TONES.includes(genOptions.tone) && (
                      <input id="automation-tone" value={genOptions.tone} onChange={(e) => setGenOptions((p) => ({ ...p, tone: e.target.value }))} placeholder="Describe the tone"
                        className={`da-input mt-2${invalid(fieldErrors.tone)}`} {...ariaFor("automation-tone", fieldErrors.tone)} />
                    )}
                    <FieldError id="automation-tone" message={fieldErrors.tone} />
                  </div>
                  {hasBody && (
                    <div>
                      <span className="da-label">Length of the main text</span>
                      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label="Length">
                        {(["short", "medium", "long"] as const).map((l) => (
                          <button key={l} type="button" role="radio" aria-checked={genOptions.length === l} onClick={() => setGenOptions((p) => ({ ...p, length: l }))} className={`rounded-xl py-2 text-[13px] font-semibold capitalize transition ${genOptions.length === l ? "bg-white text-slate-950 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}>
                            {l} <span className="hidden font-normal text-slate-400 sm:inline">~{l === "short" ? 350 : l === "medium" ? 750 : 1300}w</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasBody && (
                    <div>
                      <span className="da-label">Format stored in the database</span>
                      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="radiogroup" aria-label="Body format">
                        {([["markdown", "Markdown"], ["html", "HTML"]] as const).map(([v, l]) => (
                          <button key={v} type="button" role="radio" aria-checked={genOptions.content_format === v} onClick={() => setGenOptions((p) => ({ ...p, content_format: v }))} className={`rounded-xl py-2 text-[13px] font-semibold transition ${genOptions.content_format === v ? "bg-white text-slate-950 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}>{l}</button>
                        ))}
                      </div>
                      <p className="da-help">Choose HTML if your website shows the column as-is (most WYSIWYG CMSs).</p>
                    </div>
                  )}
                  {hasImage && (
                    <div>
                      <span className="da-label flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5 text-indigo-600" /> Images</span>
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
                      <input id="automation-image-style" value={genOptions.image_style || ""} onChange={(e) => setGenOptions((p) => ({ ...p, image_style: e.target.value }))} placeholder="Optional style, e.g. flat illustration, warm colors"
                        className={`da-input mt-2${invalid(fieldErrors.image_style)}`} {...ariaFor("automation-image-style", fieldErrors.image_style)} />
                      <FieldError id="automation-image-style" message={fieldErrors.image_style} />
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-4 sm:p-5">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                    <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><Server className="h-4 w-4 text-indigo-600" /> Text model</span>
                    <Link to="/ai-providers" className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700">Manage providers and keys →</Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { id: "ollama", name: "Ollama", note: "Local, free" },
                      { id: "gemini", name: "Gemini", note: "Your key" },
                      { id: "anthropic", name: "Claude", note: "Your key" },
                      { id: "openai", name: "OpenAI", note: "Your key" },
                    ].map((p) => {
                      const info = availableProviders.find((x) => x.provider_id === p.id);
                      const ready = info?.is_available;
                      const sel = aiConfig.provider === p.id;
                      return (
                        <button key={p.id} type="button" aria-pressed={sel} onClick={() => {
                          const models = info?.models || (info as any)?.available_models || [];
                          setAiConfig((prev) => ({ ...prev, provider: p.id, model: info?.current_model || models[0] || "" }));
                        }} className={`rounded-2xl border p-3 text-left transition-all ${sel ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_28px_-14px_rgba(15,23,42,0.8)]" : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-indigo-200"}`}>
                          <span className="block text-[13px] font-bold">{p.name}</span>
                          <span className={`text-[11px] ${sel ? "text-indigo-200" : ready ? "text-emerald-600" : "text-amber-600"}`}>{ready ? `● ${p.note}` : "Not set up"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const info = availableProviders.find((x) => x.provider_id === aiConfig.provider);
                    const models: string[] = info?.models || (info as any)?.available_models || [];
                    return (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          {models.length > 0 ? (
                            <SearchableSelect id="automation-model" invalid={!!fieldErrors.model} value={aiConfig.model} onChange={(v) => setAiConfig((p) => ({ ...p, model: String(v) }))} options={models.map((m) => ({ value: m, label: m }))} placeholder="Choose a model" />
                          ) : (
                            <input id="automation-model" value={aiConfig.model || ""} onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))} placeholder="Model name (leave empty for the default)"
                              className={`da-input${invalid(fieldErrors.model)}`} {...ariaFor("automation-model", fieldErrors.model)} />
                          )}
                          <FieldError id="automation-model" message={fieldErrors.model} />
                        </div>
                        <p className="self-center text-[12.5px] leading-relaxed text-slate-500">
                          {aiConfig.provider === "ollama" ? "Runs on this machine: private and free. Small models are faster; larger ones write better." : "Uses your own encrypted API key."}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><BookOpen className="h-3.5 w-3.5 text-indigo-600" /> Ground it in your documents (optional)</span>
                    <span className="text-[12px] text-slate-400">{aiConfig.document_ids.length} of {knowledgeDocs.length} selected</span>
                  </div>
                  {knowledgeDocs.length > 0 && (aiConfig.topic || "").trim().length >= 8 && (
                    <p className="mb-2 flex items-start gap-1.5 text-[12px] text-slate-500" aria-live="polite">
                      {suggesting ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-indigo-500" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                      <span>
                        {suggesting ? "Looking for documents that match your topic…"
                          : suggestedDocs.length
                            ? <>{suggestedDocs.length === 1 ? "This document matches" : "These documents match"} your topic: <strong className="text-slate-700">{suggestedDocs.map((d) => d.title).join(", ")}</strong>{docsTouched ? "." : " (selected for you)."}</>
                            : "None of your documents clearly matches this topic. You can still pick any."}
                      </span>
                    </p>
                  )}
                  {knowledgeDocs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center text-[13px] text-slate-500">
                      No documents yet. Upload Markdown, text or PDF files so the AI can use your facts.
                      <button type="button" onClick={() => setShowDocUploadModal(true)} className="ml-1 font-semibold text-indigo-600 hover:underline">Upload one</button>
                    </div>
                  ) : (
                    <div className={`relative ${docDropdownOpen ? "z-50" : ""}`}>
                      <button type="button" onClick={() => setDocDropdownOpen((o) => !o)} aria-expanded={docDropdownOpen} className="da-input flex items-center justify-between text-left hover:border-slate-300">
                        <span className={aiConfig.document_ids.length ? "font-semibold text-slate-900" : "text-slate-500"}>
                          {aiConfig.document_ids.length ? `${aiConfig.document_ids.length} document${aiConfig.document_ids.length > 1 ? "s" : ""} selected` : "Choose documents…"}
                        </span>
                        {docDropdownOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      </button>
                      {docDropdownOpen && (
                        <div className="absolute left-0 right-0 z-[100] mt-2 space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lift">
                          <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input value={docSearchFilter} onChange={(e) => setDocSearchFilter(e.target.value)} placeholder="Search documents…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                          <div className="max-h-48 space-y-1 overflow-y-auto">
                            {knowledgeDocs.filter((d) => d.title.toLowerCase().includes(docSearchFilter.toLowerCase())).map((doc) => {
                              const sel = aiConfig.document_ids.includes(doc.id);
                              return (
                                <label key={doc.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-xs ${sel ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"}`}>
                                  <input type="checkbox" checked={sel} onChange={(e) => { setDocsTouched(true); setAiConfig((p) => ({ ...p, document_ids: e.target.checked ? [...p.document_ids, doc.id] : p.document_ids.filter((i) => i !== doc.id) })); }} className="rounded border-slate-300 text-indigo-600" />
                                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                                  {suggestedDocs.some((d) => d.id === doc.id) && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Matches topic</span>}
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
              <h3 className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em] text-slate-950"><Clock className="h-4 w-4 text-indigo-600" /> When should it run?</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">Content is generated first; it is written to your database at the publication time.</p>
            </div>
            <ScheduleStep
              schedule={schedule}
              onScheduleChange={setSchedule}
              approval={approval}
              onApprovalChange={setApproval}
              userEmail={user?.email}
              targetTable={targetTable}
              onValidity={(v) => setScheduleValid(v)}
              fieldErrors={Object.fromEntries(Object.entries(fieldErrors).filter(([f]) => BUILDER_FIELD[f]?.step === 4))}
              onFieldEdited={clearFieldError}
            />
            {navButtons(4, "Continue to preview")}
          </motion.div>
        )}

        {/* STEP 5 ------------------------------------------------------------ */}
        {step === 5 && (
          <motion.div key="s5" {...stepMotion} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(stepTarget(5), el) : orbitTargets.unregister(stepTarget(5)))} className={card}>
            <div>
              <h3 className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em] text-slate-950"><Eye className="h-4 w-4 text-indigo-600" /> Preview a real run, then save</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">The preview runs the same steps as a scheduled run, including images and the exact database plan, but writes nothing.</p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <button type="button" onClick={() => setShowRecap((s) => !s)} aria-expanded={showRecap} className="flex w-full items-center justify-between bg-slate-50/70 px-4 py-3 text-left hover:bg-slate-50">
                <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><Workflow className="h-4 w-4 text-indigo-600" /> Your settings</span>
                {showRecap ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {showRecap && (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 border-t border-slate-100 px-4 py-4 text-[13px] sm:grid-cols-2">
                  {[
                    ["Name", name || "—", 1],
                    ["Writes into", `${targetTable} · ${selectedConnection?.name ?? ""}`, 1],
                    ["Columns", `${Object.values(mappings).filter((m) => m.mapping_type !== "DB_DEFAULT" && m.mapping_type !== "LEAVE_EMPTY").length} filled · ${fieldPlan?.columns.filter((c) => ["AI", "AI_CREATE", "AI_REUSE"].includes(modeOf(mappings[c.name], c))).length ?? 0} by AI`, 2],
                    ["Content", manual ? "Fixed values (AI off)" : `${aiConfig.provider}${aiConfig.model ? ` · ${aiConfig.model}` : ""} · ${genOptions.length}${hasImage ? " · with images" : ""}`, 3],
                    ["Schedule", `${schedule.frequency === "ONE_TIME" ? "Once" : schedule.frequency === "DAILY" ? "Daily" : "Weekly"} · generate ${formatTime12(schedule.generation_time)} → publish ${formatTime12(schedule.publication_time)} (${schedule.timezone})`, 4],
                    ["Approval", approval.require_approval ? `Email ${approval.reviewer_email || user?.email || "you"} · if no reply: ${approval.timeout_policy === "AUTO_PUBLISH_LATEST" ? "publish" : approval.timeout_policy === "CANCEL" ? "cancel" : "keep draft"}` : "Off: publishes automatically", 4],
                  ].map(([k, v, s]) => (
                    <div key={String(k)} className="flex min-w-0 items-start justify-between gap-2">
                      <dt className="shrink-0 pt-0.5 text-slate-400">{k}</dt>
                      {k === "Name" && editingName ? (
                        <dd className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <input id="review-name" autoFocus value={nameDraft} onChange={(e) => { setNameDraft(e.target.value); setNameDraftError(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveInlineName(); } if (e.key === "Escape") setEditingName(false); }}
                              className={`da-input py-1.5 text-[13px]${invalid(nameDraftError ?? undefined)}`} {...ariaFor("review-name", nameDraftError ?? undefined)} />
                            <button type="button" onClick={saveInlineName} className="da-btn da-btn-primary da-btn-sm">Save</button>
                            <button type="button" onClick={() => { setEditingName(false); setNameDraftError(null); }} className="da-btn da-btn-ghost da-btn-sm">Cancel</button>
                          </div>
                          <FieldError id="review-name" message={nameDraftError ?? undefined} />
                        </dd>
                      ) : (
                        <dd className="min-w-0 text-right font-semibold text-slate-800">
                          <span className="break-words">{v}</span>
                          <button type="button" onClick={() => (k === "Name" ? (setNameDraft(name), setEditingName(true)) : editFromReview(Number(s)))} className="ml-2 text-[11.5px] font-semibold text-indigo-600 hover:underline">Edit</button>
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-cyan-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[13px]">
                <p className="text-[14px] font-bold text-slate-900">Sample preview</p>
                <p className="text-slate-500">{manual ? "Checks your fixed values against the live table." : "Usually 20 seconds to 3 minutes on a local model."}</p>
              </div>
              <button type="button" onClick={handlePreview} disabled={isPreviewing} className="da-btn da-btn-accent">
                {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                {isPreviewing ? `Generating… ${previewSeconds}s` : preview ? "Generate another preview" : "Generate sample preview"}
              </button>
            </div>

            {isPreviewing && (
              <WorkProgress
                title="Generating a sample run"
                steps={previewSteps}
                status={previewStatus}
                seconds={previewSeconds}
                latest={previewEvents.length ? previewEvents[previewEvents.length - 1].message : "Starting…"}
                hint={aiConfig.provider === "ollama" ? "On a local model, writing usually takes 20 seconds to 3 minutes." : undefined}
              />
            )}
            {previewError && (
              <div role="alert" className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-800">
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

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-6 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => goBack(4)} className="da-btn da-btn-secondary"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
              <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="da-btn da-btn-primary px-6">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {isSubmitting ? "Saving…" : "Save and schedule"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document upload modal */}
      <ModalShell
        open={showDocUploadModal}
        onClose={() => { setShowDocUploadModal(false); setDocErrors({}); }}
        size="sm"
        icon={Upload}
        title="Add a knowledge document"
        description="Markdown, text or PDF. It is indexed and selected for this automation."
      >
        <form onSubmit={handleUploadDocumentInline} noValidate className="space-y-4">
          <div>
            <label htmlFor="doc-title" className="da-label">Title</label>
            <input id="doc-title" value={newDocTitle} onChange={(e) => { setNewDocTitle(e.target.value); setDocErrors((x) => clearError(x, "title")); }} placeholder="e.g. Product handbook"
              className={`da-input${invalid(docErrors.title)}`} {...ariaFor("doc-title", docErrors.title)} />
            <FieldError id="doc-title" message={docErrors.title} />
            {!docErrors.title && <p className="da-help">Optional. The file name is used when left empty.</p>}
          </div>
          <div>
            <button id="doc-file" type="button" onClick={() => docFileInputRef.current?.click()} {...ariaFor("doc-file", docErrors.file)}
              className={`block w-full cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${docErrors.file ? "border-rose-300 bg-rose-50/40" : "border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
              {newDocFile ? <span className="block truncate text-[13px] font-bold text-emerald-700">{newDocFile.name}</span> : <span className="text-[13px] text-slate-600"><Upload className="mx-auto mb-2 h-6 w-6 text-indigo-500" />Choose a .md, .txt or .pdf file (up to 10 MB)</span>}
            </button>
            <input ref={docFileInputRef} type="file" accept=".md,.markdown,.txt,.pdf" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setNewDocFile(f);
              setDocErrors((x) => clearError(x, "file"));
              if (f && !newDocTitle) setNewDocTitle(f.name.replace(/\.[^/.]+$/, ""));
              e.target.value = "";
            }} />
            <FieldError id="doc-file" message={docErrors.file} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => { setShowDocUploadModal(false); setDocErrors({}); }} className="da-btn da-btn-ghost">Cancel</button>
            <button type="submit" disabled={isUploadingDoc} className="da-btn da-btn-primary">
              {isUploadingDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{isUploadingDoc ? "Indexing…" : "Upload and select"}
            </button>
          </div>
        </form>
      </ModalShell>
    </motion.div>
  );
};
