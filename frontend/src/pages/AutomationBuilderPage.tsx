import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Workflow,
  Cpu,
  Zap,
  Database,
  TableProperties,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Eye,
  ArrowRight,
  ArrowLeft,
  Sliders,
  FileText,
  Clock,
  ShieldCheck,
  Tag,
  Check,
  PlusCircle,
  X,
  BookOpen,
  Trash2,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  ChevronDown,
  ChevronUp,
  Search,
  Server,
  Sparkles
} from "lucide-react";
import { api } from "../services/api";

const stockImagePresets = [
  { label: "Tech Architecture", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80" },
  { label: "Data Network", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80" },
  { label: "Modern Analytics", url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80" },
  { label: "Cloud Infrastructure", url: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&auto=format&fit=crop&q=80" },
];
import {
  ConnectionProfile,
  SchemaResponse,
  SchemaTable,
  SchemaColumn,
  KnowledgeDocument,
  FieldMapping,
  AIProviderInfo
} from "../types";
import { SearchableRelationshipSelect } from "../components/common/SearchableRelationshipSelect";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { SchemaFieldControl } from "../components/common/SchemaFieldControl";
import { useToast } from "../context/ToastContext";

export const AutomationBuilderPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [step, setStep] = useState<number>(1);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [loadingConnections, setLoadingConnections] = useState<boolean>(true);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);

  // Wizard state
  const [name, setName] = useState<string>("");
  const [targetTable, setTargetTable] = useState<string>("posts");
  const [operation, setOperation] = useState<string>("INSERT");
  const [mode, setMode] = useState<"AI_GENERATED" | "MANUAL">("AI_GENERATED");

  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([
    { column: "title", source: "AI_GENERATED" },
    { column: "slug", source: "RUNTIME_VALUE", rule: "slugify(title)" },
    { column: "excerpt", source: "AI_GENERATED" },
    { column: "content", source: "AI_GENERATED" },
    { column: "category_id", source: "FIXED_VALUE", value: 1 },
    { column: "author_id", source: "FIXED_VALUE", value: 1 },
    { column: "status", source: "FIXED_VALUE", value: "published" },
  ]);

  // Relational Lookup Options cache: { [colName]: [{ id: any, label: string }] }
  const [lookupOptions, setLookupOptions] = useState<Record<string, { id: any; label: string }[]>>({});
  const [loadingLookups, setLoadingLookups] = useState<Record<string, boolean>>({});

  const [aiConfig, setAiConfig] = useState({
    provider: "ollama",
    model: "llama3.2:1b",
    topic: "",
    tone: "Professional, educational, and engaging",
    document_ids: [] as number[],
  });
  const [availableProviders, setAvailableProviders] = useState<AIProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  const detectedTimezone = typeof Intl !== "undefined" && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata" : "Asia/Kolkata";

  const [scheduleConfig, setScheduleConfig] = useState({
    frequency: "DAILY",
    start_date: new Date().toISOString().split("T")[0],
    timezone: detectedTimezone,
    generation_time: "08:00",
    publication_time: "09:00",
  });

  const [approvalPolicy, setApprovalPolicy] = useState({
    require_approval: false,
    reviewer_email: "",
    timeout_action: "PUBLISH_PENDING",
    max_regenerations: 3,
  });

  // Inline Quick Document Uploader Modal State in Step 3
  const [showDocUploadModal, setShowDocUploadModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  // Step 3: AI Context Multi-Select & Tag State
  const [selectedContextTags, setSelectedContextTags] = useState<string[]>([]);
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [docSearchFilter, setDocSearchFilter] = useState("");
  const [customTagInput, setCustomTagInput] = useState("");

  // Natural Language AI Quick-Start Proposer State
  const [naturalPrompt, setNaturalPrompt] = useState<string>("");
  const [isProposing, setIsProposing] = useState<boolean>(false);
  const [proposeFeedback, setProposeFeedback] = useState<string | null>(null);

  const [previewResult, setPreviewResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState<boolean>(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const workflowTemplates = [
    {
      id: "daily_blog",
      title: "Daily Blog Generator",
      description: "Generates practical tech articles, SEO slugs, and categories with 30-min lead time",
      icon: FileText,
      badge: "Most Popular",
      color: "text-indigo-600 bg-indigo-50 border-indigo-200",
      apply: () => {
        setSelectedTemplateId("daily_blog");
        setName("Daily Technical Blog Pipeline");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Modern Full-Stack Architecture, Database Optimization & Reliability",
          tone: "Authoritative, educational, and engaging",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "DAILY",
          generation_time: "08:30",
          publication_time: "09:00",
        }));
        setApprovalPolicy(prev => ({
          ...prev,
          require_approval: false,
        }));
        toast.success("Template Applied", "Configured Daily Blog Generator blueprint.");
      }
    },
    {
      id: "product_seo",
      title: "Product Description & SEO",
      description: "Enriches catalog items with compelling copy, feature bullets, and search tags",
      icon: Sparkles,
      badge: "E-Commerce",
      color: "text-emerald-600 bg-emerald-50 border-emerald-200",
      apply: () => {
        setSelectedTemplateId("product_seo");
        setName("Product Description & SEO Enrichment");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Feature highlights, customer benefits, SEO title, meta description, and schema tags",
          tone: "Persuasive, benefit-focused, and concise",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "WEEKLY",
          generation_time: "09:00",
          publication_time: "09:30",
        }));
        setApprovalPolicy(prev => ({
          ...prev,
          require_approval: true,
        }));
        toast.success("Template Applied", "Configured Product Description & SEO blueprint.");
      }
    },
    {
      id: "faq_generator",
      title: "FAQ & Troubleshooting",
      description: "Builds question-and-answer pairs grounded in uploaded knowledge base docs",
      icon: BookOpen,
      badge: "Knowledge Base",
      color: "text-violet-600 bg-violet-50 border-violet-200",
      apply: () => {
        setSelectedTemplateId("faq_generator");
        setName("Knowledge Base & FAQ Generator");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Frequently asked questions, troubleshooting steps, and direct solutions",
          tone: "Direct, helpful, and troubleshooting-oriented",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "DAILY",
          generation_time: "10:00",
          publication_time: "10:30",
        }));
        setApprovalPolicy(prev => ({
          ...prev,
          require_approval: true,
        }));
        toast.success("Template Applied", "Configured FAQ & Troubleshooting blueprint.");
      }
    },
    {
      id: "metadata_completion",
      title: "Missing Metadata Completion",
      description: "Fills empty excerpts, summary fields, and canonical tags from existing content",
      icon: Tag,
      badge: "Data Quality",
      color: "text-blue-600 bg-blue-50 border-blue-200",
      apply: () => {
        setSelectedTemplateId("metadata_completion");
        setName("Content Metadata & Excerpt Completion");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Summarize existing text, generate 150-char excerpt, and propose SEO focus keyphrase",
          tone: "Objective, concise, and accurate",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "DAILY",
          generation_time: "07:00",
          publication_time: "07:30",
        }));
        toast.success("Template Applied", "Configured Missing Metadata Completion blueprint.");
      }
    },
    {
      id: "content_rewrite",
      title: "Content Rewrite & Polish",
      description: "Improves wording, shortens fluff, and raises readability scores for drafts",
      icon: RefreshCw,
      badge: "Editorial",
      color: "text-amber-600 bg-amber-50 border-amber-200",
      apply: () => {
        setSelectedTemplateId("content_rewrite");
        setName("Editorial Rewrite & Tone Enhancer");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Clarify technical concepts, remove passive voice, and improve executive readability",
          tone: "Executive, clear, and compelling",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "DAILY",
          generation_time: "08:00",
          publication_time: "08:30",
        }));
        setApprovalPolicy(prev => ({
          ...prev,
          require_approval: true,
        }));
        toast.success("Template Applied", "Configured Content Rewrite blueprint.");
      }
    },
    {
      id: "localization",
      title: "Multi-Region Localization",
      description: "Adapts technical terms, currency symbols, and examples for target markets",
      icon: Sliders,
      badge: "Global",
      color: "text-cyan-600 bg-cyan-50 border-cyan-200",
      apply: () => {
        setSelectedTemplateId("localization");
        setName("Regional Content Localization Pipeline");
        setOperation("INSERT");
        setMode("AI_GENERATED");
        setAiConfig(prev => ({
          ...prev,
          topic: "Adapt vocabulary, date formats, and examples for multi-region audiences",
          tone: "Localized, accessible, and culturally attuned",
        }));
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "WEEKLY",
          generation_time: "11:00",
          publication_time: "11:30",
        }));
        toast.success("Template Applied", "Configured Multi-Region Localization blueprint.");
      }
    },
    {
      id: "manual_schedule",
      title: "Manual Scheduled Content",
      description: "Deterministic scheduling for human-written content with AI strictly disabled",
      icon: Calendar,
      badge: "No AI",
      color: "text-slate-600 bg-slate-100 border-slate-300",
      apply: () => {
        setSelectedTemplateId("manual_schedule");
        setName("Curated Human Publication Schedule");
        setOperation("INSERT");
        setMode("MANUAL");
        setScheduleConfig(prev => ({
          ...prev,
          frequency: "DAILY",
          generation_time: "08:30",
          publication_time: "09:00",
        }));
        setApprovalPolicy(prev => ({
          ...prev,
          require_approval: false,
        }));
        toast.success("Template Applied", "Configured Manual Scheduled Content blueprint (AI Disabled).");
      }
    },
  ];

  // Restore draft from sessionStorage on initial load
  useEffect(() => {
    try {
      const savedDraft = sessionStorage.getItem("automation_builder_draft");
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed.name) setName(parsed.name);
        if (parsed.targetTable) setTargetTable(parsed.targetTable);
        if (parsed.operation) setOperation(parsed.operation);
        if (parsed.mode) setMode(parsed.mode);
        if (parsed.fieldMappings) setFieldMappings(parsed.fieldMappings);
        if (parsed.aiConfig) setAiConfig(parsed.aiConfig);
        if (parsed.scheduleConfig) setScheduleConfig(parsed.scheduleConfig);
        if (parsed.approvalPolicy) setApprovalPolicy(parsed.approvalPolicy);
        if (parsed.step) setStep(parsed.step);
        setDraftRestored(true);
      }
    } catch {
      // ignore draft parse error
    }
  }, []);

  // Autosave draft to sessionStorage on state changes
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "automation_builder_draft",
        JSON.stringify({
          name,
          targetTable,
          operation,
          mode,
          fieldMappings,
          aiConfig,
          scheduleConfig,
          approvalPolicy,
          step,
        })
      );
    } catch {
      // ignore quota error
    }
  }, [name, targetTable, operation, mode, fieldMappings, aiConfig, scheduleConfig, approvalPolicy, step]);

  const handleClearDraft = () => {
    sessionStorage.removeItem("automation_builder_draft");
    setName("");
    setAiConfig({
      provider: "ollama",
      model: "llama3.2:1b",
      topic: "",
      tone: "Professional, educational, and engaging",
      document_ids: [],
    });
    setScheduleConfig({
      frequency: "DAILY",
      start_date: new Date().toISOString().split("T")[0],
      timezone: "Asia/Kolkata",
      generation_time: "08:00",
      publication_time: "09:00",
    });
    setStep(1);
    setDraftRestored(false);
  };

  // 1. Initial Connection, Docs & AI Providers Loading
  useEffect(() => {
    const init = async () => {
      try {
        setLoadingConnections(true);
        setLoadingProviders(true);
        const [conns, docs, provs] = await Promise.all([
          api.listConnections(),
          api.listKnowledge(),
          api.listAIProviders().catch(() => [])
        ]);
        const safeConns = Array.isArray(conns) ? conns : [];
        const safeProvs = Array.isArray(provs) ? provs : [];
        setConnections(safeConns);
        setKnowledgeDocs(Array.isArray(docs) ? docs : []);
        setAvailableProviders(safeProvs);

        if (safeConns.length > 0) {
          const cid = searchParams.get("connectionId") ? parseInt(searchParams.get("connectionId")!) : safeConns[0].id;
          setSelectedConnId(cid);
        }

        // Auto-select preferred AI provider (prefer Ollama if available)
        const ollamaProv = safeProvs.find(p => p.provider_id === "ollama" && p.is_available);
        if (ollamaProv) {
          const oModels = ollamaProv.models || (ollamaProv as any).available_models || [];
          const bestModel = oModels.includes("llama3.2:1b") ? "llama3.2:1b" : (ollamaProv.current_model || oModels[0] || "llama3.2:1b");
          setAiConfig(prev => ({
            ...prev,
            provider: "ollama",
            model: (prev.model && prev.model !== "mock-llama3-synthetic") ? prev.model : bestModel
          }));
        } else if (safeProvs.length > 0) {
          const activeProv = safeProvs.find(p => p.is_available) || safeProvs[0];
          setAiConfig(prev => ({
            ...prev,
            provider: activeProv.provider_id,
            model: activeProv.current_model || "default"
          }));
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingConnections(false);
        setLoadingProviders(false);
      }
    };
    init();
  }, [searchParams]);

  // 2. Fetch Schema when selected connection changes
  useEffect(() => {
    if (!selectedConnId) return;
    const fetchSchema = async () => {
      try {
        const s = await api.getSchema(selectedConnId);
        setSchema(s);
        const tblParam = searchParams.get("table");
        if (tblParam) {
          setTargetTable(tblParam);
        } else if (s && s.tables && s.tables.length > 0) {
          const allowlisted = s.tables.find((t: any) => t.category === "RECOMMENDED" || t.category === "ALLOWLISTED");
          setTargetTable(allowlisted ? allowlisted.name : s.tables[0].name);
        }
      } catch (err: any) {
        setError(err.message);
      }
    };
    fetchSchema();
  }, [selectedConnId, searchParams]);

  // Helper to determine referenced table for relational fields
  const resolveReferencedTable = (colName: string, currentTable?: SchemaTable | null): string | null => {
    if (currentTable?.relationships) {
      const rel = currentTable.relationships.find(
        (r) => (r.constrained_column || (r as any).foreign_key) === colName
      );
      if (rel && rel.referenced_table) {
        return rel.referenced_table;
      }
    }
    if (colName && colName.endsWith("_id")) {
      const base = colName.replace(/_id$/, "");
      const candidates = [
        base + "s",
        base + "es",
        base && base.endsWith("y") ? base.slice(0, -1) + "ies" : base + "s",
        base,
      ];
      const availableTables = schema?.tables?.map((t) => t.name) || [];
      for (const cand of candidates) {
        if (availableTables.includes(cand)) {
          return cand;
        }
      }
      return candidates[0];
    }
    return null;
  };

  // Fetch real lookup values from target database for relational fields in Step 2
  const fetchLookupsForColumn = async (colName: string, refTable: string) => {
    if (!selectedConnId || !refTable) return;
    try {
      setLoadingLookups((prev) => ({ ...prev, [colName]: true }));
      const records = await api.getLookupValues(selectedConnId, refTable);
      if (Array.isArray(records) && records.length > 0) {
        setLookupOptions((prev) => ({ ...prev, [colName]: records }));
        // Auto-set mapping value to first real record if not set
        setFieldMappings((prev) =>
          prev.map((m) => {
            if (m.column === colName && (m.value === undefined || m.value === 1)) {
              return { ...m, value: records[0].id };
            }
            return m;
          })
        );
      }
    } catch (err) {
      console.warn(`Lookup fetch error for ${refTable}:`, err);
    } finally {
      setLoadingLookups((prev) => ({ ...prev, [colName]: false }));
    }
  };

  // Dynamically adapt field mappings when table changes
  useEffect(() => {
    if (!schema || !targetTable) return;
    const currentTbl = schema.tables.find(t => t.name === targetTable);
    if (currentTbl && currentTbl.columns) {
      const generatedMappings: FieldMapping[] = currentTbl.columns
        .filter(c => !c.is_primary_key && c.name !== "created_at" && c.name !== "updated_at")
        .map(c => {
          if (c.name === "slug") {
            return { column: c.name, source: "RUNTIME_VALUE", rule: "slugify(title)" };
          }
          if (c.is_foreign_key || c.name.endsWith("_id")) {
            const refTable = resolveReferencedTable(c.name, currentTbl);
            if (refTable) {
              fetchLookupsForColumn(c.name, refTable);
            }
            return {
              column: c.name,
              source: "FIXED_VALUE",
              value: 1,
              relation_config: {
                referenced_table: refTable || c.name.replace(/_id$/, "s"),
                lookup_field: "name",
                creation_policy: "CREATE_IF_MISSING",
              }
            };
          }
          if (c.data_type.includes("text") || c.name.includes("content") || c.name.includes("title") || c.name.includes("excerpt") || c.name.includes("description")) {
            return { column: c.name, source: "AI_GENERATED" };
          }
          if (c.enum_values && c.enum_values.length > 0) {
            return { column: c.name, source: "FIXED_VALUE", value: c.enum_values[0] };
          }
          return { column: c.name, source: "FIXED_VALUE", value: c.default_value || "default" };
        });
      if (generatedMappings.length > 0) {
        setFieldMappings(generatedMappings);
      }
    }
  }, [targetTable, schema]);

  const handleAddFieldMapping = () => {
    setFieldMappings((prev) => [
      ...prev,
      { column: `custom_field_${prev.length + 1}`, source: "FIXED_VALUE", value: "" },
    ]);
  };

  const handleRemoveFieldMapping = (colName: string) => {
    setFieldMappings((prev) => prev.filter((m) => m.column !== colName));
  };

  // Inline Document Upload Handler in Step 3
  const handleUploadDocumentInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocFile) return;

    try {
      setIsUploadingDoc(true);
      setError(null);
      const title = newDocTitle || newDocFile.name.replace(/\.[^/.]+$/, "");
      const res = await api.uploadKnowledge(title, newDocFile);

      // Refresh knowledge documents list
      const updatedDocs = await api.listKnowledge();
      const safeDocs = Array.isArray(updatedDocs) ? updatedDocs : [];
      setKnowledgeDocs(safeDocs);

      // Automatically select newly uploaded document in AI config
      if (res && res.id) {
        setAiConfig((prev) => ({
          ...prev,
          document_ids: [...prev.document_ids, res.id],
        }));
      } else if (safeDocs.length > 0) {
        const latestDoc = safeDocs[safeDocs.length - 1];
        setAiConfig((prev) => ({
          ...prev,
          document_ids: [...prev.document_ids, latestDoc.id],
        }));
      }

      setNewDocTitle("");
      setNewDocFile(null);
      setShowDocUploadModal(false);
    } catch (err: any) {
      setError(`Document upload failed: ${err.message}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const handleProposeAutomation = async () => {
    if (!selectedConnId) {
      setError("Please select a target database connection first.");
      return;
    }
    if (!naturalPrompt.trim()) {
      setError("Please describe your automation goal in plain language.");
      return;
    }
    try {
      setIsProposing(true);
      setError(null);
      setProposeFeedback(null);
      const res = await api.proposeAutomationPlan(selectedConnId, naturalPrompt);
      if (res && res.plan) {
        const plan = res.plan;
        if (plan.name) setName(plan.name);
        if (plan.target_table) setTargetTable(plan.target_table);
        if (plan.operation_mode) {
          setMode(plan.operation_mode === "MANUAL_SCHEDULE" ? "MANUAL" : "AI_GENERATED");
        }
        if (plan.field_mappings && Array.isArray(plan.field_mappings) && plan.field_mappings.length > 0) {
          const adapted = plan.field_mappings.map((fm: any) => ({
            column: fm.field_name || fm.column,
            source: fm.mapping_type === "DERIVED_SLUG" ? "RUNTIME_VALUE" : (fm.mapping_type || "FIXED_VALUE"),
            rule: fm.source_field ? `slugify(${fm.source_field})` : undefined,
            value: fm.fixed_value !== undefined ? fm.fixed_value : undefined,
            relation_config: fm.relation_config,
          }));
          setFieldMappings(adapted);
        }
        if (plan.ai_config || plan.prompt_context) {
          setAiConfig((prev) => ({
            ...prev,
            topic: plan.prompt_context || plan.ai_config?.topic || prev.topic,
            tone: plan.ai_config?.tone || prev.tone,
          }));
        }
        if (plan.schedule_config) {
          setScheduleConfig((prev) => ({
            ...prev,
            frequency: plan.schedule_config.frequency || prev.frequency,
            generation_time: plan.schedule_config.generation_time || prev.generation_time,
            publication_time: plan.schedule_config.publication_time || prev.publication_time,
          }));
        }
        if (plan.approval_policy) {
          setApprovalPolicy((prev) => ({
            ...prev,
            require_approval: plan.approval_policy.require_approval ?? prev.require_approval,
            timeout_action: plan.approval_policy.timeout_policy === "KEEP_DRAFT" ? "KEEP_DRAFT" : "PUBLISH_PENDING",
          }));
        }
        setProposeFeedback(plan.explanation || "AI generated pipeline configuration successfully! Review settings below.");
      }
    } catch (err: any) {
      setError(`Failed to propose pipeline: ${err.message}`);
    } finally {
      setIsProposing(false);
    }
  };

  const handleTestPreview = async () => {
    try {
      setIsTesting(true);
      setError(null);
      const combinedTopic = [aiConfig.topic, ...selectedContextTags].filter(Boolean).join(" • ") || "Scalable System Architecture and Database Sharding";
      const res = await api.previewAIGeneration({
        provider: aiConfig.provider,
        model: aiConfig.model,
        topic: combinedTopic,
        tone: aiConfig.tone,
        target_table: targetTable,
        fields: fieldMappings.filter(m => m.source === "AI_GENERATED").map(m => m.column),
        context_document_ids: aiConfig.document_ids
      });
      setPreviewResult(res);
    } catch (err: any) {
      setError(`Preview generation error: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedConnId) {
      setError("Please select a target database connection.");
      return;
    }
    if (!name.trim()) {
      setError("Please specify an automation name.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const currentTbl = schema?.tables?.find(t => t.name === targetTable);
      const mappedFields = fieldMappings.map(m => {
        const colNameStr = m.column || "";
        const isRelational = colNameStr.endsWith("_id");
        const refTable = isRelational ? resolveReferencedTable(colNameStr, currentTbl) : null;
        return {
          field_name: m.column,
          mapping_type: m.source === "RUNTIME_VALUE" ? "DERIVED_SLUG" : m.source,
          source_field: m.rule ? "title" : undefined,
          fixed_value: m.value !== undefined ? m.value : (isRelational ? 1 : "active"),
          relation_config: m.relation_config || (
            isRelational ? {
              policy: "CREATE_IF_MISSING",
              creation_policy: "CREATE_IF_MISSING",
              referenced_table: refTable || m.column.replace(/_id$/, "s"),
              lookup_column: "name",
            } : undefined
          ),
        };
      });

      await api.createAutomation({
        name,
        connection_id: selectedConnId,
        target_table: targetTable,
        operation_mode: mode === "AI_GENERATED" ? "AI_CREATE" : "MANUAL_SCHEDULE",
        field_mappings: mappedFields,
        ai_provider: mode === "AI_GENERATED" ? aiConfig.provider : undefined,
        ai_model: mode === "AI_GENERATED" ? aiConfig.model : undefined,
        prompt_context: mode === "AI_GENERATED" ? ([aiConfig.topic, ...selectedContextTags].filter(Boolean).join(" • ") || `Generate rich content for table ${targetTable}`) : undefined,
        knowledge_document_ids: mode === "AI_GENERATED" ? aiConfig.document_ids : [],
        schedule_type: scheduleConfig.frequency,
        start_date: scheduleConfig.start_date,
        generation_time: scheduleConfig.generation_time,
        publication_time: scheduleConfig.publication_time,
        timezone: scheduleConfig.timezone,
        requires_approval: approvalPolicy.require_approval,
        reviewer_email: approvalPolicy.reviewer_email || undefined,
        timeout_policy: approvalPolicy.timeout_action === "PUBLISH_PENDING" ? "AUTO_PUBLISH_LATEST" : "KEEP_DRAFT",
        is_active: true
      });

      // Clear draft on successful creation
      sessionStorage.removeItem("automation_builder_draft");
      toast.success("Automation Activated!", "Workflow scheduled and enabled successfully.");
      navigate("/automations");
    } catch (err: any) {
      setError(`Failed to save automation: ${err.message}`);
      toast.error("Failed to Save Automation", err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const wizardSteps = [
    { num: 1, label: "Connection & Table" },
    { num: 2, label: "Field Mappings" },
    { num: 3, label: "AI & Context" },
    { num: 4, label: "Schedule & Approval" },
    { num: 5, label: "Preview & Enable" },
  ];

  const contextDomainPresets = [
    "Database Engineering & Query Optimization",
    "Zero-Downtime Schema Migrations",
    "Connection Pooling & Replica Scaling",
    "Distributed Cache Invalidation",
    "REST & GraphQL API Architecture",
    "Security, Multi-Tenancy & RBAC",
    "E-Commerce Catalog & Product Specs",
    "Product FAQs & Knowledge Base",
    "DevOps, CI/CD & Reliability"
  ];

  const toneOptions = [
    "Professional, educational, and engaging",
    "In-depth Technical & Architectural",
    "Clear, Concise & Executive-Level",
    "Conversational & Community-Focused",
    "Step-by-Step Practical Tutorial",
    "Custom Editorial Tone"
  ];

  return (
    <motion.div
      id="automation-builder-anchor"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Pipeline Configuration Wizard
            </span>
            <span className="text-xs text-slate-400">• Step {step} of 5</span>
            {draftRestored && (
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full flex items-center gap-1">
                <Check className="w-3 h-3" /> Draft Autosaved
              </span>
            )}
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Create Database Automation</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configures relational foreign keys, inline RAG context, start date schedules, and approval decisions
          </p>
        </div>

        {draftRestored && (
          <button
            type="button"
            onClick={handleClearDraft}
            className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold flex items-center gap-1 self-start sm:self-auto"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Draft</span>
          </button>
        )}
      </div>

      {/* Steps Progress Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
        <div className="flex items-center justify-between text-xs font-semibold overflow-x-auto gap-2 pb-1">
          {wizardSteps.map((s) => {
            const isActive = step === s.num;
            const isCompleted = step > s.num;

            return (
              <motion.button
                key={s.num}
                type="button"
                onClick={() => {
                  if (s.num < step) setStep(s.num);
                }}
                disabled={s.num > step}
                whileHover={s.num < step ? { scale: 1.02 } : {}}
                whileTap={s.num < step ? { scale: 0.98 } : {}}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all ${
                  isActive
                    ? "bg-indigo-50/80 text-indigo-700 border border-indigo-200 shadow-2xs"
                    : isCompleted
                    ? "text-emerald-700 hover:bg-emerald-50/50 cursor-pointer"
                    : "text-slate-400 opacity-60 cursor-not-allowed"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-xs"
                      : isCompleted
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isCompleted ? <Check className="w-3.5 h-3.5" /> : s.num}
                </span>
                <span className="whitespace-nowrap">{s.label}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Progress track line */}
        <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: `${(step / 5) * 100}%` }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full"
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between shadow-2xs"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* Step 1: Connection & Table */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-600" />
                  Target Database & Table Setup
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Select your verified MySQL connection and schema destination</p>
              </div>
            </div>

            {/* AI Natural Language Quick-Start Proposer Card */}
            <div className="p-4 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-slate-50/90 border border-indigo-200/80 rounded-2xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-2xs">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">AI Natural Language Pipeline Builder</h4>
                    <p className="text-[11px] text-slate-500">Describe your publishing goal in plain English — AI will configure target tables, field mappings, relational resolution, and scheduling.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={naturalPrompt}
                  onChange={(e) => setNaturalPrompt(e.target.value)}
                  placeholder="e.g. Create 1 useful article about Cloud Databases per day for 10 days. Assign it to Cloud Architecture category (create if missing), generate SEO fields, send preview at 8 AM, and publish at 9 AM unless I reject it."
                  className="w-full bg-white border border-indigo-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition resize-none"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500 font-medium">Quick examples:</span>
                    <button
                      type="button"
                      onClick={() => setNaturalPrompt("Create 1 insightful article about Cloud Architecture per day. Assign to Cloud Systems category (create if missing), generate SEO metadata, preview at 8 AM, publish at 9 AM.")}
                      className="px-2 py-0.5 bg-white/80 hover:bg-white border border-indigo-150 text-indigo-700 rounded-lg text-[10px] font-semibold transition"
                    >
                      Cloud Architecture Daily
                    </button>
                    <button
                      type="button"
                      onClick={() => setNaturalPrompt("Weekly technical deep dives on Database Indexing and Sharding. Require manual email approval, publish Mondays at 10 AM.")}
                      className="px-2 py-0.5 bg-white/80 hover:bg-white border border-indigo-150 text-indigo-700 rounded-lg text-[10px] font-semibold transition"
                    >
                      Database Performance Weekly
                    </button>
                  </div>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isProposing || !selectedConnId}
                    onClick={handleProposeAutomation}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <Zap className={`w-3.5 h-3.5 ${isProposing ? "animate-spin" : ""}`} />
                    <span>{isProposing ? "Analyzing Schema & Planning..." : "Auto-Configure Pipeline with AI"}</span>
                  </motion.button>
                </div>
              </div>

              {proposeFeedback && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2 shadow-2xs"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-bold">Pipeline Auto-Configured:</span>
                    <p className="text-[11px] leading-relaxed text-emerald-900">{proposeFeedback}</p>
                  </div>
                </motion.div>
              )}
            </div>

            {loadingConnections ? (
              <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p>Loading authorized database connections...</p>
              </div>
            ) : connections.length === 0 ? (
              <div className="p-6 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-3">
                <p className="font-semibold text-sm">No target database connection detected</p>
                <p className="text-slate-600">
                  Connect your MySQL database in the Connections manager first to introspect schemas and create automated pipelines.
                </p>
                <Link
                  to="/connections"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-xs transition"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Go to Connections →</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 1-Click SaaS Workflow Templates */}
                <div className="p-4 bg-slate-50/80 border border-slate-200/90 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span>SaaS Workflow Templates (1-Click Blueprints)</span>
                      </h4>
                      <p className="text-[11px] text-slate-500">Pick a starting configuration to automatically configure name, prompt, timing, and mappings</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                    {workflowTemplates.map((t) => {
                      const Icon = t.icon;
                      const isSelected = selectedTemplateId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={t.apply}
                          className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between ${
                            isSelected
                              ? "bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20"
                              : "bg-white hover:bg-slate-50/90 border-slate-200/90 hover:border-slate-300 shadow-2xs"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.color}`}>
                                {t.badge}
                              </span>
                              <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                                <Icon className="w-3 h-3" />
                              </div>
                            </div>
                            <h5 className="text-xs font-bold text-slate-900">{t.title}</h5>
                            <p className="text-[10px] text-slate-500 mt-1 leading-snug line-clamp-2">{t.description}</p>
                          </div>
                          <div className="mt-2 text-[10px] font-semibold text-indigo-600 flex items-center gap-1">
                            <span>Use Blueprint</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Automation Pipeline Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Daily Tech Insights Publisher"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Target MySQL Connection</label>
                    <SearchableSelect
                      value={selectedConnId}
                      onChange={(val) => setSelectedConnId(Number(val))}
                      placeholder="Select MySQL Connection..."
                      searchPlaceholder="Search database connections..."
                      options={connections.map((c) => ({
                        value: c.id,
                        label: `${c.name} (${(c as any).database_name || c.database || ""})`,
                        badge: (c as any).driver || "mysql",
                      }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Target Destination Table</label>
                    <SearchableSelect
                      value={targetTable}
                      onChange={(val) => setTargetTable(String(val))}
                      placeholder="Select Target Table..."
                      searchPlaceholder="Search available tables..."
                      options={
                        schema?.tables && schema.tables.length > 0
                          ? schema.tables
                              .filter((t) => t.category !== "RESTRICTED")
                              .map((t) => ({
                                value: t.name,
                                label: t.name,
                                badge: t.category || "table",
                              }))
                          : [{ value: "posts", label: "posts", badge: "default" }]
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Operation Type</label>
                    <SearchableSelect
                      value={operation}
                      onChange={(val) => setOperation(String(val))}
                      placeholder="Select Operation Type..."
                      options={[
                        { value: "INSERT", label: "Create Records (Parameterized INSERT)", badge: "INSERT" },
                        { value: "UPDATE", label: "Update Records (Scoped Key UPDATE)", badge: "UPDATE" },
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Execution Engine</label>
                    <SearchableSelect
                      value={mode}
                      onChange={(val) => setMode(val as any)}
                      placeholder="Select Execution Engine..."
                      options={[
                        { value: "AI_GENERATED", label: "AI-Generated Content (Ollama / Local LLM)", badge: "AI Engine" },
                        { value: "MANUAL", label: "Manual Publishing (Zero AI Calls)", badge: "Direct SQL" },
                      ]}
                    />
                  </div>
                </div>

                <div className="pt-5 border-t border-slate-100 flex justify-end">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      if (!name.trim()) {
                        setError("Please enter a name for this automation pipeline.");
                        return;
                      }
                      setError(null);
                      setStep(2);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
                  >
                    <span>Continue to Field Mappings</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Step 2: Field Mappings & Real Relational Dropdowns */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
          >
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <TableProperties className="w-4 h-4 text-indigo-600" />
                  Field Behaviors & Relational Allowlist Mapping
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Target table: <span className="font-mono text-indigo-600 font-semibold">{targetTable}</span>. Foreign keys fetch real records directly from referenced tables.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddFieldMapping}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Field Mapping</span>
              </button>
            </div>

            <div className="space-y-3">
              {fieldMappings.map((m, idx) => {
                const colNameStr = m.column || "";
                const isRelational = colNameStr.endsWith("_id");
                const currentTbl = schema?.tables?.find((t) => t.name === targetTable);
                const colDef = currentTbl?.columns?.find((c) => c.name === m.column);
                const refTable = isRelational ? resolveReferencedTable(colNameStr, currentTbl) : null;
                const options = isRelational && lookupOptions[colNameStr];
                const isMediaCol = colNameStr.includes("banner") || colNameStr.includes("image") || colNameStr.includes("thumbnail");
                const isBooleanCol = colDef?.data_type === "tinyint(1)" || colNameStr.startsWith("is_") || colNameStr === "featured";
                const isEnumCol = Boolean(colDef?.enum_values && colDef.enum_values.length > 0);
                const isStatusCol = colNameStr === "status" && !isEnumCol;
                const isCustomCol = colNameStr.startsWith("custom_field_");

                return (
                  <motion.div
                    key={m.column + "_" + idx}
                    whileHover={{ borderColor: "#cbd5e1" }}
                    className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl grid grid-cols-12 gap-3 items-center text-xs transition-shadow hover:shadow-2xs"
                  >
                    {/* Column identifier */}
                    <div className="col-span-3 min-w-0">
                      {isCustomCol ? (
                        <input
                          type="text"
                          value={m.column}
                          onChange={(e) => {
                            const updated = [...fieldMappings];
                            updated[idx].column = e.target.value;
                            setFieldMappings(updated);
                          }}
                          placeholder="Column name"
                          className="w-full bg-white border border-slate-300 rounded px-2 py-1 font-mono text-xs font-bold text-indigo-700"
                        />
                      ) : (
                        <span className="font-mono font-bold text-indigo-700 block truncate">{m.column}</span>
                      )}
                      {isRelational && refTable && (
                        <span className="text-[10px] text-slate-400 font-mono block truncate">references {refTable}</span>
                      )}
                      {colDef?.data_type && !isCustomCol && (
                        <span className="text-[10px] text-slate-400 font-mono block truncate">{colDef.data_type}</span>
                      )}
                    </div>

                    {/* Source selector */}
                    <div className="col-span-3">
                      <SearchableSelect
                        value={m.source}
                        onChange={(val) => {
                          const updated = [...fieldMappings];
                          updated[idx].source = val as any;
                          if (val === "RELATIONSHIP_LOOKUP") {
                            updated[idx].relation_config = {
                              referenced_table: refTable || m.column.replace(/_id$/, "s"),
                              lookup_field: "name",
                              creation_policy: "CREATE_IF_MISSING",
                            };
                          }
                          setFieldMappings(updated);
                        }}
                        options={[
                          { value: "AI_GENERATED", label: "AI_GENERATED", badge: "AI" },
                          { value: "RUNTIME_VALUE", label: "RUNTIME_VALUE (Slugify)", badge: "Computed" },
                          { value: "FIXED_VALUE", label: "FIXED_VALUE / LOOKUP", badge: "Fixed" },
                          ...(isRelational ? [{ value: "RELATIONSHIP_LOOKUP", label: "RELATIONSHIP_LOOKUP (Taxonomy)", badge: "FK" }] : []),
                        ]}
                      />
                    </div>

                    {/* Value configuration with rich select dropdowns */}
                    <div className="col-span-5 text-slate-500 text-[11px]">
                      {m.source === "RUNTIME_VALUE" && (
                        <span className="text-emerald-700 font-mono font-medium block">Derived automatically: slugify(title)</span>
                      )}

                      {m.source === "AI_GENERATED" && !isRelational && (
                        <div className="flex items-center gap-1.5 text-indigo-600 font-medium">
                          <Cpu className="w-3.5 h-3.5 shrink-0" />
                          <span>Generated via LLM structured payload</span>
                        </div>
                      )}

                      {m.source === "AI_GENERATED" && isRelational && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-indigo-600 font-medium">
                            <Cpu className="w-3.5 h-3.5 shrink-0" />
                            <span>AI generates name/slug; resolved to real DB ID</span>
                          </div>
                          <span className="text-[10px] text-emerald-700 font-semibold block">
                            Policy: Atomically create in {refTable || 'taxonomy'} if missing
                          </span>
                        </div>
                      )}

                      {(m.source === "RELATIONSHIP_LOOKUP" || (m.source === "FIXED_VALUE" && isRelational)) && (
                        <div className="space-y-2">
                          <SearchableRelationshipSelect
                            connectionId={selectedConnId || 1}
                            targetTable={refTable || m.column.replace(/_id$/, "s")}
                            value={m.value}
                            onChange={(val, rec) => {
                              const updated = [...fieldMappings];
                              updated[idx].value = val;
                              if (rec?.label) {
                                updated[idx].relation_config = {
                                  referenced_table: refTable || m.column.replace(/_id$/, "s"),
                                  lookup_field: "name",
                                  creation_policy: "CREATE_IF_MISSING",
                                };
                              }
                              setFieldMappings(updated);
                            }}
                            placeholder={`Search ${refTable || 'related'} records...`}
                          />

                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder={`Or category name to auto-resolve (e.g. Technology)...`}
                              value={typeof m.value === "string" ? m.value : ""}
                              onChange={(e) => {
                                const updated = [...fieldMappings];
                                updated[idx].value = e.target.value || 1;
                                updated[idx].relation_config = {
                                  referenced_table: refTable || m.column.replace(/_id$/, "s"),
                                  lookup_field: "name",
                                  creation_policy: "CREATE_IF_MISSING",
                                };
                                setFieldMappings(updated);
                              }}
                              className="flex-1 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs placeholder:text-slate-400"
                            />
                            <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold whitespace-nowrap">
                              Create if missing
                            </span>
                          </div>
                        </div>
                      )}

                      {m.source === "FIXED_VALUE" && !isRelational && isEnumCol && colDef?.enum_values ? (
                        <SearchableSelect
                          value={m.value || colDef.enum_values[0]}
                          onChange={(val) => {
                            const updated = [...fieldMappings];
                            updated[idx].value = String(val);
                            setFieldMappings(updated);
                          }}
                          placeholder="Select enum option..."
                          options={colDef.enum_values.map((v) => ({
                            value: v,
                            label: `${v} (Enum Option)`,
                            badge: "Enum",
                          }))}
                        />
                      ) : m.source === "FIXED_VALUE" && isStatusCol ? (
                        <SearchableSelect
                          value={m.value || "published"}
                          onChange={(val) => {
                            const updated = [...fieldMappings];
                            updated[idx].value = String(val);
                            setFieldMappings(updated);
                          }}
                          placeholder="Select status..."
                          options={[
                            { value: "published", label: "published (Live)", badge: "Live" },
                            { value: "draft", label: "draft (Pending Review)", badge: "Draft" },
                            { value: "archived", label: "archived", badge: "Archive" },
                            { value: "pending", label: "pending", badge: "Pending" },
                          ]}
                        />
                      ) : m.source === "FIXED_VALUE" && isBooleanCol ? (
                        <SearchableSelect
                          value={m.value !== undefined ? m.value : 1}
                          onChange={(val) => {
                            const updated = [...fieldMappings];
                            updated[idx].value = Number(val);
                            setFieldMappings(updated);
                          }}
                          placeholder="Select boolean value..."
                          options={[
                            { value: 1, label: "1 (Active / Enabled)", badge: "Active" },
                            { value: 0, label: "0 (Inactive / Disabled)", badge: "Inactive" },
                          ]}
                        />
                      ) : m.source === "FIXED_VALUE" && isMediaCol ? (
                        <div className="space-y-1">
                          <SearchableSelect
                            value={stockImagePresets.some((p) => p.url === m.value) ? m.value : "custom"}
                            onChange={(val) => {
                              const updated = [...fieldMappings];
                              if (val !== "custom") {
                                updated[idx].value = String(val);
                              }
                              setFieldMappings(updated);
                            }}
                            placeholder="Select stock preset..."
                            options={[
                              ...stockImagePresets.map((p) => ({
                                value: p.url,
                                label: `${p.label} (Stock Preset)`,
                                badge: "Preset",
                              })),
                              { value: "custom", label: "Custom Image URL...", badge: "Custom" },
                            ]}
                          />
                          {(!stockImagePresets.some((p) => p.url === m.value) || m.value === "custom") && (
                            <input
                              type="text"
                              placeholder="https://..."
                              value={m.value === "custom" ? "" : m.value || ""}
                              onChange={(e) => {
                                const updated = [...fieldMappings];
                                updated[idx].value = e.target.value;
                                setFieldMappings(updated);
                              }}
                              className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs"
                            />
                          )}
                        </div>
                      ) : m.source === "FIXED_VALUE" ? (
                        colDef ? (
                          <SchemaFieldControl
                            column={colDef}
                            value={m.value}
                            onChange={(val) => {
                              const updated = [...fieldMappings];
                              updated[idx].value = val;
                              setFieldMappings(updated);
                            }}
                            targetTable={targetTable}
                            topic={aiConfig.topic || name}
                            compact
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              placeholder="Constant Value"
                              value={m.value || ""}
                              onChange={(e) => {
                                const updated = [...fieldMappings];
                                updated[idx].value = e.target.value;
                                setFieldMappings(updated);
                              }}
                              className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500"
                            />
                            <InlineAiFieldAssist
                              fieldName={m.column}
                              currentValue={typeof m.value === "string" ? m.value : ""}
                              topic={aiConfig.topic || name}
                              targetTable={targetTable}
                              onApply={(newVal) => {
                                const updated = [...fieldMappings];
                                updated[idx].value = newVal;
                                setFieldMappings(updated);
                              }}
                              compact
                            />
                          </div>
                        )
                      ) : null}
                    </div>

                    {/* Delete action */}
                    <div className="col-span-1 text-right">
                      {fieldMappings.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFieldMapping(m.column)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                          title="Remove field mapping"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="pt-5 border-t border-slate-100 flex justify-between">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(1)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(3)}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                <span>Continue to AI Context</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Step 3: AI Context & Inline Knowledge Document Uploader */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
          >
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-600" />
                  AI Content Prompting & RAG Knowledge Context
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Guide the local LLM on subject topics and attach indexed documents directly without losing your wizard progress.
                </p>
              </div>

              {/* In-place Quick Ingest Button */}
              <button
                type="button"
                onClick={() => setShowDocUploadModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition shadow-2xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload New Doc Here</span>
              </button>
            </div>

            <div className="space-y-6">
              {/* 0. AI Provider & Model Engine Selection */}
              <div className="p-4 bg-gradient-to-r from-indigo-50/70 via-slate-50 to-purple-50/50 border border-indigo-100 rounded-xl space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-900">
                      <Cpu className="w-4 h-4 text-indigo-600" />
                      AI Inference Engine & Model
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Select which AI provider powers this automation. By default, local Ollama provides free, private generation.
                    </p>
                  </div>
                  <Link
                    to="/ai-providers"
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold inline-flex items-center gap-1 self-start sm:self-auto"
                  >
                    <span>Manage Keys / Providers</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>

                {/* Provider selection buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: "ollama", name: "Ollama (Local)", icon: Server, badge: "Local & Free" },
                    { id: "gemini", name: "Google Gemini", icon: Sparkles, badge: "Cloud Fast" },
                    { id: "anthropic", name: "Anthropic Claude", icon: Cpu, badge: "Cloud Smart" },
                    { id: "openai", name: "OpenAI", icon: Zap, badge: "GPT-4o" },
                    { id: "mock", name: "Local Mock", icon: Sliders, badge: "Offline Dev" },
                  ].map((item) => {
                    const isSelected = aiConfig.provider === item.id;
                    const provInfo = availableProviders.find(p => p.provider_id === item.id);
                    const isAvail = provInfo?.is_available || item.id === "mock";
                    const IconComponent = item.icon;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          const models = provInfo?.models || (provInfo as any)?.available_models || [];
                          const defaultM = provInfo?.current_model || models[0] || (item.id === "ollama" ? "llama3.2:1b" : item.id === "gemini" ? "gemini-1.5-flash" : item.id === "openai" ? "gpt-4o-mini" : "default");
                          setAiConfig({
                            ...aiConfig,
                            provider: item.id,
                            model: defaultM,
                          });
                        }}
                        className={`p-2.5 rounded-xl text-left border transition relative cursor-pointer ${
                          isSelected
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                            : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <IconComponent className={`w-3.5 h-3.5 ${isSelected ? "text-white" : "text-indigo-600"}`} />
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                            isSelected
                              ? "bg-indigo-700/80 text-white"
                              : isAvail
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {item.badge}
                          </span>
                        </div>
                        <div className="font-bold text-xs leading-tight truncate">{item.name}</div>
                        <div className={`text-[10px] truncate mt-0.5 ${isSelected ? "text-indigo-100" : "text-slate-400"}`}>
                          {isAvail ? "● Ready" : "Configure key"}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Model selection dropdown & status indicator */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Active Model
                    </label>
                    {(() => {
                      const curProv = availableProviders.find(p => p.provider_id === aiConfig.provider);
                      const modelList = curProv?.models || (curProv as any)?.available_models || (
                        aiConfig.provider === "ollama" ? ["llama3.2:1b", "llama3:latest"]
                        : aiConfig.provider === "gemini" ? ["gemini-1.5-flash", "gemini-1.5-pro"]
                        : aiConfig.provider === "openai" ? ["gpt-4o-mini", "gpt-4o"]
                        : aiConfig.provider === "anthropic" ? ["claude-3-5-sonnet", "claude-3-5-haiku-latest"]
                        : ["mock-llama3-synthetic", "mock-mistral-synthetic"]
                      );

                      return (
                        <SearchableSelect
                          value={aiConfig.model}
                          onChange={(val) => setAiConfig({ ...aiConfig, model: String(val) })}
                          placeholder="Select AI model..."
                          options={modelList.map((m: string) => ({
                            value: m,
                            label: `${m}${m === "llama3.2:1b" ? " (Fast CPU)" : ""}`,
                            badge: m === "llama3.2:1b" ? "Recommended" : undefined,
                          }))}
                        />
                      );
                    })()}
                  </div>

                  <div className="flex items-center text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-3 py-1.5">
                    {aiConfig.provider === "ollama" ? (
                      <span className="text-emerald-700 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span><strong>Local Ollama Active:</strong> Zero API cost, private local execution.</span>
                      </span>
                    ) : aiConfig.provider === "mock" ? (
                      <span className="text-slate-600">
                        <strong>Deterministic Mock:</strong> Fast local testing without model downloads.
                      </span>
                    ) : (
                      <span className="text-indigo-700">
                        <strong>Cloud Inference:</strong> Uses your securely encrypted API key.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 1. Primary Subject Topic & Editorial Brief */}
              <div className="space-y-2 p-4 bg-slate-50/70 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      Primary Subject Topic & Content Brief
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      The core subject or instructions guiding this automated publication series.
                    </p>
                  </div>
                  <InlineAiFieldAssist
                    fieldName="topic"
                    currentValue={aiConfig.topic}
                    topic={name}
                    targetTable={targetTable}
                    onApply={(newVal) => setAiConfig({ ...aiConfig, topic: newVal })}
                  />
                </div>
                <textarea
                  rows={2}
                  value={aiConfig.topic}
                  onChange={(e) => setAiConfig({ ...aiConfig, topic: e.target.value })}
                  placeholder="e.g. Modern Database Indexing Strategies & Connection Pooling with MySQL..."
                  className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                />
              </div>

              {/* 2. Domain Context Tags & Themes (Multi-Select Tags/Chips) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800">
                      <Tag className="w-3.5 h-3.5 text-indigo-600" />
                      Content Themes & Domain Context Tags
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Select domain tags to direct the AI content generation context without writing manual boilerplate.
                    </p>
                  </div>
                  {selectedContextTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedContextTags([])}
                      className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold transition"
                    >
                      Clear Selection ({selectedContextTags.length})
                    </button>
                  )}
                </div>

                {/* Preset Domain Tags */}
                <div className="flex flex-wrap gap-2">
                  {contextDomainPresets.map((tag) => {
                    const isSelected = selectedContextTags.includes(tag);
                    return (
                      <motion.button
                        key={tag}
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedContextTags(selectedContextTags.filter(t => t !== tag));
                          } else {
                            setSelectedContextTags([...selectedContextTags, tag]);
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition border cursor-pointer ${
                          isSelected
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 text-white" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>{tag}</span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Custom Focus Tag / Topic Input */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Add custom keyword or theme tag and press Enter..."
                      value={customTagInput}
                      onChange={(e) => setCustomTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const trimmed = customTagInput.trim();
                          if (trimmed && !selectedContextTags.includes(trimmed)) {
                            setSelectedContextTags([...selectedContextTags, trimmed]);
                            setCustomTagInput("");
                          }
                        }
                      }}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = customTagInput.trim();
                      if (trimmed && !selectedContextTags.includes(trimmed)) {
                        setSelectedContextTags([...selectedContextTags, trimmed]);
                        setCustomTagInput("");
                      }
                    }}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    + Add Tag
                  </button>
                </div>

                {/* Active Context Tags Display */}
                {selectedContextTags.length > 0 && (
                  <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-1.5">
                    <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider block">
                      Active AI Context Tags ({selectedContextTags.length}):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedContextTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-indigo-200 text-indigo-900 rounded-lg text-xs font-semibold shadow-2xs"
                        >
                          <span>{tag}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedContextTags(selectedContextTags.filter(t => t !== tag))}
                            className="hover:text-rose-600 text-slate-400 p-0.5 rounded transition"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Editorial Tone Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  Editorial Tone & Style
                </label>
                <div className="relative">
                  <SearchableSelect
                    value={toneOptions.includes(aiConfig.tone) ? aiConfig.tone : "Custom Editorial Tone"}
                    onChange={(val) => {
                      if (val !== "Custom Editorial Tone") {
                        setAiConfig({ ...aiConfig, tone: String(val) });
                      } else {
                        setAiConfig({ ...aiConfig, tone: "Custom Editorial Tone" });
                      }
                    }}
                    placeholder="Select editorial tone..."
                    options={toneOptions.map((opt) => ({
                      value: opt,
                      label: opt,
                    }))}
                  />
                </div>
                {aiConfig.tone === "Custom Editorial Tone" && (
                  <input
                    type="text"
                    placeholder="Specify custom editorial tone (e.g. Conversational, technical, and lighthearted)..."
                    onChange={(e) => setAiConfig({ ...aiConfig, tone: e.target.value })}
                    className="mt-2 w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  />
                )}
              </div>

              {/* 3. Knowledge Base Documents (Searchable Multi-Select Dropdown with Tag Pills) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                      Attach Knowledge Base Documents (RAG Context)
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Provide real business documents to feed the vector similarity search during generation.
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {aiConfig.document_ids.length} of {knowledgeDocs.length} selected
                  </span>
                </div>

                {knowledgeDocs.length === 0 ? (
                  <div className="p-5 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center text-xs space-y-2">
                    <BookOpen className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="font-semibold text-slate-700">No documents indexed in your knowledge base yet</p>
                    <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                      Upload a Markdown (.md), Text (.txt), or PDF (.pdf) file to embed and attach as domain context.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowDocUploadModal(true)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-indigo-700 transition inline-flex items-center gap-1.5 mt-2"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload & Index Document</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* Dropdown trigger */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setDocDropdownOpen(!docDropdownOpen)}
                        className="w-full flex items-center justify-between bg-slate-50/50 border border-slate-200 hover:border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-left transition"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span className={aiConfig.document_ids.length > 0 ? "font-semibold text-slate-900" : "text-slate-500"}>
                            {aiConfig.document_ids.length > 0
                              ? `${aiConfig.document_ids.length} document${aiConfig.document_ids.length > 1 ? "s" : ""} selected for RAG retrieval`
                              : "Click to select indexed documents from dropdown..."}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {aiConfig.document_ids.length > 0 && (
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-full">
                              {aiConfig.document_ids.length}
                            </span>
                          )}
                          {docDropdownOpen ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {/* Dropdown menu */}
                      {docDropdownOpen && (
                        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl p-3 space-y-2.5">
                          {/* Search bar inside dropdown */}
                          <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                            <input
                              type="text"
                              placeholder="Search indexed documents by title..."
                              value={docSearchFilter}
                              onChange={(e) => setDocSearchFilter(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                            />
                          </div>

                          {/* Quick selection actions */}
                          <div className="flex items-center justify-between text-[11px] px-1 border-b border-slate-100 pb-2">
                            <span className="text-slate-500 font-medium">
                              Showing {knowledgeDocs.filter(d => d.title.toLowerCase().includes(docSearchFilter.toLowerCase())).length} documents
                            </span>
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => setAiConfig({ ...aiConfig, document_ids: knowledgeDocs.map(d => d.id) })}
                                className="text-indigo-600 hover:text-indigo-700 font-semibold"
                              >
                                Select All
                              </button>
                              <span className="text-slate-200">|</span>
                              <button
                                type="button"
                                onClick={() => setAiConfig({ ...aiConfig, document_ids: [] })}
                                className="text-slate-500 hover:text-slate-700"
                              >
                                Deselect All
                              </button>
                            </div>
                          </div>

                          {/* Document options */}
                          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                            {knowledgeDocs
                              .filter(d => d.title.toLowerCase().includes(docSearchFilter.toLowerCase()) || (d.filename && d.filename.toLowerCase().includes(docSearchFilter.toLowerCase())))
                              .map((doc) => {
                                const isSelected = aiConfig.document_ids.includes(doc.id);
                                return (
                                  <label
                                    key={doc.id}
                                    className={`flex items-center gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition ${
                                      isSelected
                                        ? "bg-indigo-50/80 text-indigo-900 font-medium"
                                        : "hover:bg-slate-50 text-slate-700"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        const ids = e.target.checked
                                          ? [...aiConfig.document_ids, doc.id]
                                          : aiConfig.document_ids.filter(id => id !== doc.id);
                                        setAiConfig({ ...aiConfig, document_ids: ids });
                                      }}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <span className="block truncate text-xs">{doc.title}</span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {doc.file_type ? `.${doc.file_type}` : ""} • {doc.chunk_count || 0} chunks
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                    )}
                                  </label>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selected Document Tag Pills */}
                    {aiConfig.document_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {aiConfig.document_ids.map((id) => {
                          const doc = knowledgeDocs.find(d => d.id === id);
                          if (!doc) return null;
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg text-xs font-semibold shadow-2xs"
                            >
                              <BookOpen className="w-3 h-3 text-indigo-600" />
                              <span className="max-w-[180px] truncate">{doc.title}</span>
                              <span className="text-[10px] font-mono text-indigo-500">({doc.chunk_count || 0} chunks)</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAiConfig({
                                    ...aiConfig,
                                    document_ids: aiConfig.document_ids.filter(docId => docId !== id)
                                  });
                                }}
                                className="hover:text-rose-600 text-slate-400 ml-0.5 rounded transition"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 flex justify-between">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(4)}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                <span>Continue to Scheduling</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Schedule & Approval Guardrails with Start Date Picker */}
        {step === 4 && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
          >
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                Scheduling & Approval Guardrails
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure starting date, generation time, publication time, and reviewer notification rules.
              </p>
            </div>

            <div className="space-y-4">
              {/* Frequency and Start Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Schedule Frequency</label>
                  <SearchableSelect
                    value={scheduleConfig.frequency}
                    onChange={(val) => setScheduleConfig({ ...scheduleConfig, frequency: String(val) })}
                    placeholder="Select frequency..."
                    options={[
                      { value: "DAILY", label: "Daily Recurring", badge: "Daily" },
                      { value: "WEEKLY", label: "Weekly Recurring", badge: "Weekly" },
                      { value: "ONE_TIME", label: "One-Time Run", badge: "Once" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Starting Date</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={scheduleConfig.start_date}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, start_date: e.target.value })}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">First date when this automation pipeline begins</p>
                </div>
              </div>

              {/* Generation and Publication Times with 30-min Lead Time Enforcement */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span>Background Generation Time</span>
                      <span className="text-[10px] text-indigo-600 font-normal">Runs 30m before publication</span>
                    </label>
                    <input
                      type="time"
                      value={scheduleConfig.generation_time}
                      onChange={(e) => {
                        const newGen = e.target.value;
                        setScheduleConfig((prev) => ({
                          ...prev,
                          generation_time: newGen,
                        }));
                      }}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">When AI creates draft payload</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span>Target Publication Time</span>
                      <span className="text-[10px] text-emerald-600 font-normal">Atomic MySQL commit</span>
                    </label>
                    <input
                      type="time"
                      value={scheduleConfig.publication_time}
                      onChange={(e) => {
                        const newPub = e.target.value;
                        // Auto-derive generation time as pub - 30 mins
                        const [ph, pm] = newPub.split(":").map(Number);
                        let totalMins = ph * 60 + pm - 30;
                        if (totalMins < 0) totalMins += 24 * 60;
                        const gh = Math.floor(totalMins / 60).toString().padStart(2, "0");
                        const gm = (totalMins % 60).toString().padStart(2, "0");
                        setScheduleConfig((prev) => ({
                          ...prev,
                          publication_time: newPub,
                          generation_time: `${gh}:${gm}`,
                        }));
                      }}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">When records publish to target DB</p>
                  </div>
                </div>

                {/* Lead-Time Status Badge & Auto-Fix Banner */}
                {(() => {
                  const [gh, gm] = (scheduleConfig.generation_time || "08:00").split(":").map(Number);
                  const [ph, pm] = (scheduleConfig.publication_time || "09:00").split(":").map(Number);
                  let diff = (ph * 60 + pm) - (gh * 60 + gm);
                  if (diff <= 0) diff += 24 * 60;
                  const isValid = diff >= 30;

                  return (
                    <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                      isValid
                        ? "bg-indigo-50/60 border-indigo-200/80 text-indigo-900"
                        : "bg-rose-50 border-rose-200 text-rose-800"
                    }`}>
                      <div className="flex items-center gap-2">
                        {isValid ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        <div>
                          <span className="font-bold">
                            {isValid ? `Lead time compliant (${diff} min buffer)` : `Lead time violation (${diff} min buffer)`}
                          </span>
                          <p className="text-[11px] opacity-80 mt-0.5">
                            {isValid
                              ? "Content generation has sufficient lead time before the publication deadline."
                              : "Minimum 30 minutes lead time required to ensure AI generation and validations complete."}
                          </p>
                        </div>
                      </div>

                      {!isValid && (
                        <button
                          type="button"
                          onClick={() => {
                            let totalMins = gh * 60 + gm + 30;
                            if (totalMins >= 24 * 60) totalMins -= 24 * 60;
                            const newPh = Math.floor(totalMins / 60).toString().padStart(2, "0");
                            const newPm = (totalMins % 60).toString().padStart(2, "0");
                            setScheduleConfig((prev) => ({
                              ...prev,
                              publication_time: `${newPh}:${newPm}`,
                            }));
                          }}
                          className="px-2.5 py-1 bg-rose-600 text-white hover:bg-rose-700 rounded-lg text-[11px] font-bold shrink-0 transition"
                        >
                          Auto-Fix (+30 min)
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-xs font-bold text-slate-900">
                      Require email approval before publishing
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {approvalPolicy.require_approval
                        ? "Approval ON: Draft enters PENDING_APPROVAL and sends signed email review link."
                        : "Approval OFF: Valid records publish directly to target MySQL at scheduled publication time."}
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={approvalPolicy.require_approval}
                      onChange={(e) =>
                        setApprovalPolicy({
                          ...approvalPolicy,
                          require_approval: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                {approvalPolicy.require_approval && (
                  <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Reviewer Notification Email</label>
                      <input
                        type="email"
                        placeholder="editor@example.com"
                        value={approvalPolicy.reviewer_email}
                        onChange={(e) => setApprovalPolicy({ ...approvalPolicy, reviewer_email: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Timeout Policy (If Unreviewed)</label>
                      <SearchableSelect
                        value={approvalPolicy.timeout_action}
                        onChange={(val) => setApprovalPolicy({ ...approvalPolicy, timeout_action: String(val) })}
                        placeholder="Select timeout policy..."
                        options={[
                          { value: "PUBLISH_PENDING", label: "Auto-Publish Pending Version (Configurable Policy)", badge: "Auto-Publish" },
                          { value: "KEEP_DRAFT", label: "Keep as Draft / Withhold Publication", badge: "Draft" },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Schedule Preview Card */}
              <div className="p-4 bg-indigo-50/70 border border-indigo-200/80 rounded-xl text-xs space-y-1.5 shadow-2xs">
                <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Active Schedule Execution Summary</span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Pipeline initiates on <strong className="text-indigo-900">{scheduleConfig.start_date || "Today"}</strong>. AI generates new content drafts {scheduleConfig.frequency === "DAILY" ? "daily" : scheduleConfig.frequency === "WEEKLY" ? "weekly" : "one-time"} at <strong className="text-indigo-900">{scheduleConfig.generation_time}</strong>, dispatches email review to <strong className="text-slate-800">{approvalPolicy.reviewer_email || "configured reviewer"}</strong>, and publishes approved records to target MySQL at <strong className="text-emerald-700">{scheduleConfig.publication_time}</strong> ({scheduleConfig.timezone}).
                </p>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 flex justify-between">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(3)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </motion.button>
              {(() => {
                const [gh, gm] = (scheduleConfig.generation_time || "08:00").split(":").map(Number);
                const [ph, pm] = (scheduleConfig.publication_time || "09:00").split(":").map(Number);
                let diff = (ph * 60 + pm) - (gh * 60 + gm);
                if (diff <= 0) diff += 24 * 60;
                const isValid = diff >= 30;

                return (
                  <motion.button
                    type="button"
                    disabled={!isValid}
                    whileHover={{ scale: isValid ? 1.02 : 1 }}
                    whileTap={{ scale: isValid ? 0.98 : 1 }}
                    onClick={() => {
                      if (!isValid) {
                        toast.error("Lead Time Violation", "Publication time must be at least 30 minutes after generation time.");
                        return;
                      }
                      setStep(5);
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition shadow-xs ${
                      isValid
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                        : "bg-slate-300 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    <span>Continue to Preview & Enable</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.button>
                );
              })()}
            </div>
          </motion.div>
        )}

        {/* Step 5: Preview & Enable with Real AI Generation */}
        {step === 5 && (
          <motion.div
            key="step5"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-xs"
          >
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Validate & Enable Live Automation Pipeline
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Generate a live structured preview from the local AI service to test schema adherence without touching target tables
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/80 border border-slate-200 rounded-xl gap-3">
              <div>
                <h4 className="text-xs font-bold text-slate-900">Dry-Run AI Simulator</h4>
                <p className="text-[11px] text-slate-500">Executes structured prompt & schema normalization through AI service</p>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleTestPreview}
                disabled={isTesting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs font-bold transition shadow-2xs self-start sm:self-auto"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{isTesting ? "Executing AI Model..." : "Generate Sample Preview"}</span>
              </motion.button>
            </div>

            <AnimatePresence>
              {previewResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 bg-slate-900 text-slate-100 rounded-xl space-y-2 overflow-hidden shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      Validated Structured Output Payload
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">Schema Conformance Verified</span>
                  </div>
                  <pre className="p-3 bg-black/40 rounded-lg text-[11px] text-emerald-300 font-mono overflow-x-auto max-h-60 border border-slate-800 leading-relaxed">
                    {JSON.stringify(previewResult.data || previewResult, null, 2)}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-5 border-t border-slate-100 flex justify-between">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(4)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Registering Pipeline...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Save and Enable Automation</span>
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline Quick Document Upload Modal for Step 3 */}
      <AnimatePresence>
        {showDocUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDocUploadModal(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative z-10 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Upload Knowledge Document</h3>
                    <p className="text-[11px] text-slate-500">Auto-indexes into your FAISS vector store</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDocUploadModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 font-bold text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleUploadDocumentInline} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Document Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. System Performance Guidelines"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    File Attachment (.md, .txt, .pdf)
                  </label>
                  <div
                    onClick={() => docFileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl p-4 text-center cursor-pointer transition bg-slate-50/40"
                  >
                    <input
                      ref={docFileInputRef}
                      type="file"
                      required={!newDocFile}
                      accept=".md,.txt,.pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setNewDocFile(f);
                        if (f && !newDocTitle) {
                          setNewDocTitle(f.name.replace(/\.[^/.]+$/, ""));
                        }
                      }}
                      className="hidden"
                    />

                    {newDocFile ? (
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-emerald-700 block truncate">
                          {newDocFile.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {(newDocFile.size / 1024).toFixed(1)} KB • Click to replace
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-5 h-5 text-indigo-500 mx-auto" />
                        <span className="text-xs font-semibold text-slate-800 block">
                          Choose or drop document
                        </span>
                        <span className="text-[10px] text-slate-400">Markdown, Plaintext, or PDF</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowDocUploadModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isUploadingDoc || !newDocFile}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  >
                    {isUploadingDoc ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Embedding Chunks...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload & Auto-Select</span>
                      </>
                    )}
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
