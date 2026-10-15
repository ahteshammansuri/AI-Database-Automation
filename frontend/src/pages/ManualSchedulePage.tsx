import React, { useEffect, useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileEdit,
  Send,
  CheckCircle2,
  AlertCircle,
  Database,
  TableProperties,
  Cpu,
  Image as ImageIcon,
  Calendar,
  Layers,
  ArrowRight,
  Info,
  Clock,
  RefreshCw,
  ExternalLink,
  Upload,
  X,
  Check,
  Tag,
  Wand2,
  Plus
} from "lucide-react";
import { api } from "../services/api";
import { ConnectionProfile, SchemaResponse, SchemaTable, SchemaColumn } from "../types";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { SchemaFieldControl } from "../components/common/SchemaFieldControl";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";

export const ManualSchedulePage: React.FC = () => {
  const navigate = useNavigate();

  // State
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);

  // Dynamic Form Payload state
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [publishMode, setPublishMode] = useState<"NOW" | "SCHEDULED">("NOW");
  const [scheduledTime, setScheduledTime] = useState<string>("");

  // Relational Lookup Options cache: { [columnName]: [{ id: any, label: string }] }
  const [lookupOptions, setLookupOptions] = useState<Record<string, { id: any; label: string }[]>>({});
  const [loadingLookups, setLoadingLookups] = useState<Record<string, boolean>>({});

  // Dynamic custom additional fields
  const [customFields, setCustomFields] = useState<{ id: string; key: string; value: string }[]>([]);

  // UI state
  const [isInitializing, setIsInitializing] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<any | null>(null);

  // AI Content Assistant state
  const [aiTopic, setAiTopic] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [showAiHelper, setShowAiHelper] = useState(false);

  // File upload input ref for image
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stock image presets for image/banner fields
  const stockImagePresets = [
    { label: "Tech Architecture", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80" },
    { label: "Data Network", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80" },
    { label: "Modern Analytics", url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80" },
    { label: "Cloud Infrastructure", url: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&auto=format&fit=crop&q=80" },
  ];

  // 1. Initial atomic load: connections AND target schema together (zero flicker)
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        setIsInitializing(true);
        setError(null);
        const list = await api.listConnections();
        const safeList = Array.isArray(list) ? list : [];
        if (!isMounted) return;
        setConnections(safeList);

        if (safeList.length > 0) {
          const firstConnId = safeList[0].id;
          setSelectedConnId(firstConnId);

          try {
            const data = await api.getSchema(firstConnId);
            if (!isMounted) return;
            setSchema(data);

            if (data && Array.isArray(data.tables) && data.tables.length > 0) {
              const eligible = data.tables.find(
                (t: any) => t.category === "ALLOWLISTED" || !t.is_sensitive
              );
              const firstTable = eligible || data.tables[0];
              setSelectedTable(firstTable);
              initializeFormData(firstTable, data);
            }
          } catch (schemaErr: any) {
            if (isMounted) setError(schemaErr.message);
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "Failed to load database connections");
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    };
    init();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load Schema when user changes target connection
  const handleConnectionChange = async (newConnId: number) => {
    setSelectedConnId(newConnId);
    try {
      setLoadingSchema(true);
      setError(null);
      setSelectedTable(null);
      setFormData({});
      setCustomFields([]);
      setLookupOptions({});
      setSuccessResult(null);

      const data = await api.getSchema(newConnId);
      setSchema(data);

      if (data && Array.isArray(data.tables) && data.tables.length > 0) {
        const eligible = data.tables.find(
          (t: any) => t.category === "ALLOWLISTED" || !t.is_sensitive
        );
        const firstTable = eligible || data.tables[0];
        setSelectedTable(firstTable);
        initializeFormData(firstTable, data);
      }
    } catch (err: any) {
      setError(err.message || "Failed to introspect database schema");
      setSchema(null);
    } finally {
      setLoadingSchema(false);
    }
  };

  const handleAddCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { id: "cf_" + Math.random().toString(36).substring(2, 9), key: "", value: "" },
    ]);
  };

  const handleRemoveCustomField = (id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleCustomFieldChange = (id: string, key: string, value: string) => {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, key, value } : f))
    );
  };

  // Determine referenced table for a foreign key or _id column
  const resolveReferencedTable = (col: SchemaColumn, currentTable: SchemaTable, schemaData?: SchemaResponse | null): string | null => {
    // 1. Check explicit relationships from schema
    if (currentTable.relationships) {
      const rel = currentTable.relationships.find(
        (r) => (r.constrained_column || (r as any).foreign_key) === col.name
      );
      if (rel && rel.referenced_table) {
        return rel.referenced_table;
      }
    }

    // 2. Derive conventional referenced table name (e.g. category_id -> categories)
    if (col?.name && col.name.endsWith("_id")) {
      const base = col.name.replace(/_id$/, "");
      const candidates = [
        base + "s",
        base + "es",
        base && base.endsWith("y") ? base.slice(0, -1) + "ies" : base + "s",
        base,
      ];
      const availableTables = (schemaData || schema)?.tables?.map((t) => t.name) || [];
      for (const cand of candidates) {
        if (availableTables.includes(cand)) {
          return cand;
        }
      }
      return candidates[0]; // fallback candidate
    }

    return null;
  };

  // Fetch real lookup values from target database for relational fields
  const fetchLookupsForColumn = async (col: SchemaColumn, refTable: string) => {
    if (!selectedConnId || !refTable) return;
    try {
      setLoadingLookups((prev) => ({ ...prev, [col.name]: true }));
      const records = await api.getLookupValues(selectedConnId, refTable);
      if (Array.isArray(records) && records.length > 0) {
        setLookupOptions((prev) => ({ ...prev, [col.name]: records }));
        // If formData doesn't have a value or is default, set to first real option id
        setFormData((prev) => {
          if (!prev[col.name] || prev[col.name] === 1) {
            return { ...prev, [col.name]: records[0].id };
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn(`Lookup fetch error for table ${refTable}:`, err);
    } finally {
      setLoadingLookups((prev) => ({ ...prev, [col.name]: false }));
    }
  };

  // Initialize Form Data dynamically based on discovered table columns
  const initializeFormData = (table: SchemaTable, schemaData?: SchemaResponse | null) => {
    const initial: Record<string, any> = {};

    table.columns.forEach((col) => {
      const colName = col.name.toLowerCase();

      if (col.is_primary_key || colName === "created_at" || colName === "updated_at" || colName === "deleted_at") {
        return;
      }

      if (col.enum_values && col.enum_values.length > 0) {
        initial[col.name] = col.enum_values[0];
      } else if (colName === "status") {
        initial[col.name] = col.data_type.includes("int") ? 1 : "published";
      } else if (colName.includes("banner") || colName.includes("meta_img") || colName.includes("thumbnail") || colName.includes("image")) {
        initial[col.name] = stockImagePresets[0].url;
      } else if (col.is_foreign_key || (colName && colName.endsWith("_id"))) {
        initial[col.name] = 1;
        // Trigger lookup fetch
        const refTable = resolveReferencedTable(col, table, schemaData);
        if (refTable) {
          fetchLookupsForColumn(col, refTable);
        }
      } else if (col.data_type.includes("int") || col.data_type.includes("decimal")) {
        initial[col.name] = col.default_value ? Number(col.default_value) : 0;
      } else {
        initial[col.name] = col.default_value || "";
      }
    });

    setFormData(initial);
  };

  const handleSelectTable = (tableName: string) => {
    if (!schema?.tables) return;
    const table = schema.tables.find(
      (t: any) => (t.name || t.table_name) === tableName
    );
    if (table) {
      setSelectedTable(table);
      initializeFormData(table, schema);
    }
  };

  const handleFieldChange = (colName: string, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [colName]: value };

      if ((colName === "title" || colName === "name") && "slug" in updated) {
        const cleanSlug = String(value)
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/[-\s]+/g, "-");
        updated.slug = cleanSlug;
      }

      return updated;
    });
  };

  // Image Upload handler via File Drop / Input
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>, colName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      handleFieldChange(colName, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // AI Content Generator: Auto-draft content for the form using Python AI Service
  const handleGenerateAiDraft = async () => {
    if (!aiTopic.trim()) {
      setError("Please provide a topic or prompt for AI generation.");
      return;
    }

    try {
      setIsGeneratingAi(true);
      setError(null);

      const targetFields = Object.keys(formData);
      const res = await api.previewAIGeneration({
        topic: aiTopic,
        target_table: selectedTable?.name || "posts",
        fields: targetFields,
      });

      if (res && res.data) {
        const aiData = res.data;
        setFormData((prev) => {
          const merged = { ...prev };
          Object.keys(aiData).forEach((k) => {
            if (k in merged && typeof aiData[k] !== "object") {
              merged[k] = aiData[k];
            }
          });
          if (aiData.title && "slug" in merged) {
            merged.slug = String(aiData.title)
              .toLowerCase()
              .replace(/[^\w\s-]/g, "")
              .trim()
              .replace(/[-\s]+/g, "-");
          }
          if (aiData.excerpt && "short_description" in merged && !merged.short_description) {
            merged.short_description = aiData.excerpt;
          }
          if (aiData.content && "description" in merged && !merged.description) {
            merged.description = aiData.content;
          }
          if (aiData.title && "meta_title" in merged && !merged.meta_title) {
            merged.meta_title = aiData.title;
          }
          if (aiData.excerpt && "meta_description" in merged && !merged.meta_description) {
            merged.meta_description = aiData.excerpt;
          }
          return merged;
        });
        setShowAiHelper(false);
      }
    } catch (err: any) {
      setError(`AI generation failed: ${err.message}`);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // ---- Orbit surface: same state/API as the form; table columns are dynamic fields col.<name> ---
  const colName = (key?: string) => String(key ?? "").replace(/^col\./, "");
  useOrbitSurface("manual.form", () => ({
    describe: () => ({
      connection_id: selectedConnId,
      table: selectedTable?.name ?? null,
      columns: (selectedTable?.columns || [])
        .filter((c: any) => !c.is_primary_key && !["created_at", "updated_at", "deleted_at"].includes(c.name.toLowerCase()))
        .map((c: any) => ({
          field: `col.${c.name}`, type: c.data_type, required: c.is_nullable === false && !c.default_value,
          dropdown: !!lookupOptions[c.name]?.length || undefined, value: formData[c.name] === undefined ? null : String(formData[c.name]).slice(0, 120),
        })),
      tables: (schema?.tables || []).map((t: any) => t.name || t.table_name).slice(0, 60),
      result: successResult?.message,
    }),
    fields: {
      connection: {
        get: () => selectedConnId,
        set: async (v) => {
          const id = Number(v);
          if (!connections.find((c) => c.id === id)) return `Connection ${v} is not in this workspace.`;
          await handleConnectionChange(id);
          return null;
        },
        options: () => connections.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name || c.database || ""})` })),
      },
      table: {
        get: () => selectedTable?.name ?? null,
        set: (v) => {
          const name = String(v);
          if (!(schema?.tables || []).some((t: any) => (t.name || t.table_name) === name)) return `Table '${name}' is not in this schema.`;
          handleSelectTable(name);
          return null;
        },
        options: () => (schema?.tables || []).map((t: any) => ({ value: t.name || t.table_name, label: t.name || t.table_name })),
      },
      "col.*": {
        get: (key) => formData[colName(key)],
        set: (v, key) => {
          const c = colName(key);
          if (!(selectedTable?.columns || []).some((x: any) => x.name === c)) return `Column '${c}' is not in the selected table.`;
          handleFieldChange(c, v);
          return null;
        },
        options: (key) => (lookupOptions[colName(key)] || []).map((o) => ({ value: o.id, label: String(o.label) })),
        target: (key) => `manual.col.${colName(key)}`,
      },
      publish_mode: {
        get: () => publishMode,
        set: (v) => { const m = String(v).toUpperCase(); if (m !== "NOW" && m !== "SCHEDULED") return "Use NOW or SCHEDULED."; setPublishMode(m as any); return null; },
        options: () => [{ value: "NOW", label: "Publish now" }, { value: "SCHEDULED", label: "Schedule" }],
      },
      scheduled_time: { get: () => scheduledTime, set: (v) => { setScheduledTime(String(v ?? "")); return null; } },
      ai_topic: { get: () => aiTopic, set: (v) => { setAiTopic(String(v ?? "")); setShowAiHelper(true); return null; } },
    },
    actions: {
      ai_draft: {
        enabled: () => !!aiTopic.trim() && !!selectedTable,
        run: async () => {
          await handleGenerateAiDraft();
          return { success: true, message: "AI draft filled into the form (review before publishing).", data: { fields: Object.keys(formData) } };
        },
      },
      publish: {
        enabled: () => !!selectedConnId && !!selectedTable && !isSubmitting,
        run: async () => {
          if (!selectedConnId || !selectedTable) return { success: false, message: "Choose the connection and table first." };
          try {
            setIsSubmitting(true);
            setError(null);
            const payload: Record<string, any> = { ...formData };
            customFields.forEach((cf) => { if (cf.key.trim()) payload[cf.key.trim()] = cf.value; });
            const res: any = await api.manualPublish({
              connection_id: selectedConnId, target_table: selectedTable.name, payload,
              publish_now: publishMode === "NOW", scheduled_time: publishMode === "SCHEDULED" ? scheduledTime : undefined,
            });
            setSuccessResult(res);
            return { success: true, message: res?.message || "Done.", resource: res?.execution?.id ? { type: "AutomationExecution", id: res.execution.id } : undefined };
          } catch (err: any) {
            setError(err.message);
            return { success: false, message: err.message || "Publishing failed." };
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    },
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConnId || !selectedTable) {
      setError("Please select both a target database and a valid target table.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setSuccessResult(null);

      const finalPayload = { ...formData };
      customFields.forEach((cf) => {
        if (cf.key.trim()) {
          finalPayload[cf.key.trim()] = cf.value;
        }
      });

      const res = await api.manualPublish({
        connection_id: selectedConnId,
        target_table: selectedTable.name,
        payload: finalPayload,
        publish_now: publishMode === "NOW",
        scheduled_time: publishMode === "SCHEDULED" ? scheduledTime : undefined,
      });

      setSuccessResult(res);
    } catch (err: any) {
      setError(err.message || "Failed to execute manual publication.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const editableColumns = (selectedTable?.columns || []).filter((col) => {
    const name = col.name.toLowerCase();
    return !col.is_primary_key && name !== "created_at" && name !== "updated_at" && name !== "deleted_at";
  });

  // Partition columns into logical visual groups
  const primaryCols = editableColumns.filter((c) => {
    const n = (c?.name || "").toLowerCase();
    return n === "title" || n === "name" || n === "slug" || n === "status" || n.endsWith("_id");
  });

  const contentCols = editableColumns.filter((c) => {
    const n = c.name.toLowerCase();
    return (
      (c.data_type.includes("text") || n.includes("content") || n.includes("excerpt") || n.includes("description")) &&
      !n.includes("meta")
    );
  });

  const mediaCols = editableColumns.filter((c) => {
    const n = c.name.toLowerCase();
    return n.includes("img") || n.includes("image") || n.includes("banner") || n.includes("thumbnail");
  });

  const seoAndOtherCols = editableColumns.filter((c) => {
    return !primaryCols.includes(c) && !contentCols.includes(c) && !mediaCols.includes(c);
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Direct Target Database Writer
            </span>
            <span className="text-xs text-slate-400">• Parameterized Safe Writes</span>
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Manual Content Publishing</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select any connected MySQL database, inspect real relational lookup options, upload images, and publish schema-validated records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/executions"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Execution Log</span>
          </Link>
        </div>
      </div>

      {/* Error alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-start justify-between shadow-2xs"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-bold">Publication Notice</p>
                <p className="mt-0.5 text-rose-700 leading-relaxed">{error}</p>
              </div>
            </div>
            <button onClick={() => setError(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-2">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Skeleton Guard - NEVER flash "no connection" prematurely */}
      {isInitializing || loadingSchema ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-3">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">
            {isInitializing ? "Connecting to Database Workspace..." : "Introspecting Database Schema..."}
          </h3>
          <p className="text-slate-500 text-xs">Loading authorized connection profiles and schema models</p>
        </div>
      ) : connections.length === 0 ? (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center text-slate-500 text-xs shadow-xs space-y-3">
          <Database className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">No database connections found</h3>
          <p className="max-w-md mx-auto">
            You must connect at least one target MySQL database to enable manual publishing.
          </p>
          <Link
            to="/connections"
            className="btn-primary-gradient inline-block px-4 py-2 text-white rounded-xl font-semibold shadow-xs"
          >
            Connect Database
          </Link>
        </div>
      ) : successResult ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="bg-white border border-emerald-200 rounded-2xl p-8 shadow-sm space-y-6"
        >
          {/* Celebratory header */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pb-6 border-b border-slate-100">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                  {successResult.status === "SCHEDULED" ? "QUEUED IN SCHEDULER" : "COMPLETED & COMMITTED"}
                </span>
                <span className="text-xs text-slate-400 font-medium">• Target MySQL Safe Execution</span>
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {successResult.status === "SCHEDULED" ? "Manual Publishing Job Scheduled!" : "Manual Automation Completed Successfully!"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {successResult.message || "Record successfully validated and written directly to your connected database."}
              </p>
            </div>
          </div>

          {/* Details breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs">
              <span className="text-slate-400 text-[11px] block font-medium">Target Table</span>
              <span className="font-mono font-bold text-slate-900 text-sm">{selectedTable?.name || successResult.result?.table}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs">
              <span className="text-slate-400 text-[11px] block font-medium">Generated Primary Key</span>
              <span className="font-mono font-bold text-emerald-700 text-sm">#{successResult.result?.record_id ?? "N/A"}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs">
              <span className="text-slate-400 text-[11px] block font-medium">Columns Written</span>
              <span className="font-mono font-bold text-slate-900 text-sm">
                {successResult.result?.columns_written?.length ?? Object.keys(formData).length} columns
              </span>
            </div>
          </div>

          {/* Written Data Preview */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Inserted Field Values Preview</h4>
            <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-[11px]">
              {Object.entries(formData).map(([k, v]) => (
                <div key={k} className="flex justify-between items-start py-1 border-b border-slate-100 last:border-0">
                  <span className="text-indigo-700 font-semibold">{k}:</span>
                  <span className="text-slate-700 max-w-md truncate text-right">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
              {customFields.map((cf) => cf.key && (
                <div key={cf.id} className="flex justify-between items-start py-1 border-b border-slate-100 last:border-0">
                  <span className="text-violet-700 font-semibold">{cf.key} (custom):</span>
                  <span className="text-slate-700 max-w-md truncate text-right">{cf.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-3 justify-center sm:justify-start">
            <button
              type="button"
              onClick={() => {
                setSuccessResult(null);
                if (selectedTable) initializeFormData(selectedTable, schema);
                setCustomFields([]);
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Publish Another Record</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/executions")}
              className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition inline-flex items-center gap-2"
            >
              <Layers className="w-4 h-4 text-slate-500" />
              <span>View Execution Logs</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/schema?connectionId=${selectedConnId}&table=${selectedTable?.name}`)}
              className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-2xs transition inline-flex items-center gap-1.5"
            >
              <TableProperties className="w-4 h-4 text-slate-500" />
              <span>Inspect in Schema Explorer</span>
            </button>
          </div>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step 1: Target Database & Target Table Selection */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-600" />
                1. Database Connection & Target Table
              </h3>

              {/* AI Assistant Quick Toggle */}
              <button
                type="button"
                onClick={() => setShowAiHelper(!showAiHelper)}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition shadow-2xs"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>AI Draft Assistant</span>
              </button>
            </div>

            {/* AI Assistant Dropdown Drawer */}
            <AnimatePresence>
              {showAiHelper && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-3 overflow-hidden"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
                      Auto-Populate Form with Local AI
                    </span>
                    <span className="text-[11px] text-slate-500">Zero dummy data</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="e.g. Scaling Relational MySQL with Read Replicas & Connection Pooling"
                      className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleGenerateAiDraft())}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateAiDraft}
                      disabled={isGeneratingAi}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                    >
                      {isGeneratingAi ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Cpu className="w-3.5 h-3.5" />
                          <span>Generate Draft</span>
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Target Database Connection
                </label>
                <SearchableSelect
                  value={selectedConnId}
                  onChange={(val) => handleConnectionChange(Number(val))}
                  placeholder="Select database connection..."
                  searchPlaceholder="Search database connections..."
                  options={connections.map((c) => ({
                    value: c.id,
                    label: `${c.name} (${(c as any).database_name || c.database || "MySQL"})`,
                    badge: (c as any).driver || "mysql",
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Target Table
                </label>
                <SearchableSelect
                  value={selectedTable ? selectedTable.name || (selectedTable as any).table_name : ""}
                  onChange={(val) => handleSelectTable(String(val))}
                  disabled={loadingSchema || !schema?.tables}
                  placeholder="Select target table..."
                  searchPlaceholder="Search available tables..."
                  options={
                    schema?.tables
                      ? schema.tables
                          .filter((t: any) => t.category !== "RESTRICTED")
                          .map((t: any) => {
                            const tName = t.name || t.table_name;
                            return {
                              value: tName,
                              label: tName,
                              badge: t.category || "ALLOWLISTED",
                            };
                          })
                      : []
                  }
                />
              </div>
            </div>
          </motion.div>

          {/* Step 2: Content Form Fields */}
          {selectedTable && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6"
            >
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <TableProperties className="w-3.5 h-3.5 text-indigo-600" />
                  2. Table Schema Form & Record Payload
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real relational data lookups automatically populated from connected tables
                </p>
              </div>

              {/* SECTION A: Primary Identifiers & Relational Fields */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-100">
                  Primary Details & Foreign Keys
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {primaryCols.map((col) => {
                    const colName = col.name || "";
                    const isRelational = col.is_foreign_key || colName.endsWith("_id");
                    const refTable = isRelational ? resolveReferencedTable(col, selectedTable, schema) : null;
                    const options = isRelational && lookupOptions[colName];

                    return (
                      <div key={colName} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(`manual.col.${colName}`, el) : orbitTargets.unregister(`manual.col.${colName}`))} className={colName === "title" || colName === "name" ? "sm:col-span-2" : ""}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                            <span>{colName}</span>
                            {!col.nullable && <span className="text-rose-500">*</span>}
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {col.data_type} {isRelational && refTable ? `→ ${refTable}` : ""}
                          </span>
                        </div>

                        <SchemaFieldControl
                          column={col}
                          value={formData[colName]}
                          onChange={(val) => handleFieldChange(colName, val)}
                          targetTable={selectedTable?.name}
                          topic={formData.title || formData.name || aiTopic}
                          isRelational={isRelational}
                          relationalOptions={options || []}
                          loadingRelational={loadingLookups[colName]}
                          referencedTable={refTable}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION B: Content & Text Body */}
              {contentCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-100">
                    Content & Descriptive Copy
                  </h4>

                  <div className="space-y-4">
                    {contentCols.map((col) => {
                      const colName = col.name;
                      const isLongText = col.data_type.includes("longtext") || colName.includes("content") || colName === "description";

                      return (
                        <div key={colName} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(`manual.col.${colName}`, el) : orbitTargets.unregister(`manual.col.${colName}`))}>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                              <span>{colName}</span>
                              {!col.nullable && <span className="text-rose-500">*</span>}
                            </label>
                            <div className="flex items-center gap-1.5">
                              <InlineAiFieldAssist
                                fieldName={colName}
                                currentValue={formData[colName]}
                                topic={formData.title || formData.name || aiTopic}
                                targetTable={selectedTable?.name}
                                onApply={(newVal) => handleFieldChange(colName, newVal)}
                                compact
                              />
                              <span className="text-[10px] text-slate-400 font-mono">{col.data_type}</span>
                            </div>
                          </div>
                          <textarea
                            rows={isLongText ? 8 : 3}
                            required={!col.nullable}
                            value={formData[colName] !== undefined ? formData[colName] : ""}
                            onChange={(e) => handleFieldChange(colName, e.target.value)}
                            placeholder={`Enter ${colName}...`}
                            className="w-full bg-slate-50/50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-900 font-sans leading-relaxed focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION C: Image & Media Uploader */}
              {mediaCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-100 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                    Featured Image & Media Uploader
                  </h4>

                  {mediaCols.map((col) => {
                    const colName = col.name;
                    const currentValue = formData[colName];

                    return (
                      <div key={colName} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(`manual.col.${colName}`, el) : orbitTargets.unregister(`manual.col.${colName}`))} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-700">{colName}</label>
                          <span className="text-[10px] text-slate-400 font-mono">Image URL / Base64 Payload</span>
                        </div>

                        {/* Interactive Drag & Drop File Upload Zone */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50 rounded-xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-1.5"
                          >
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageFileChange(e, colName)}
                              className="hidden"
                            />
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                              <Upload className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-semibold text-slate-800">
                              Upload Image File
                            </span>
                            <span className="text-[10px] text-slate-400">PNG, JPG, WebP up to 5MB</span>
                          </div>

                          {/* Live Thumbnail Preview */}
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center gap-3">
                            {currentValue ? (
                              <>
                                <img
                                  src={currentValue}
                                  alt="Preview"
                                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-white"
                                  onError={(e) => {
                                    (e.target as any).src = stockImagePresets[0].url;
                                  }}
                                />
                                <div className="flex-1 min-w-0 text-xs">
                                  <span className="text-emerald-700 font-bold block">Image Attached</span>
                                  <span className="text-[10px] text-slate-400 font-mono truncate block">
                                    {String(currentValue).startsWith("data:") ? "Local File (Base64)" : currentValue}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleFieldChange(colName, "")}
                                    className="text-[10px] text-rose-600 hover:underline mt-1 font-semibold"
                                  >
                                    Remove image
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-center w-full py-4 text-xs text-slate-400">
                                No image selected
                              </div>
                            )}
                          </div>
                        </div>

                        {/* URL input fallback & Preset chips */}
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={currentValue || ""}
                            onChange={(e) => handleFieldChange(colName, e.target.value)}
                            placeholder="Or paste external image URL..."
                            className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                          />

                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] text-slate-400 font-semibold">Stock Presets:</span>
                            {stockImagePresets.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => handleFieldChange(colName, preset.url)}
                                className="text-[10px] px-2.5 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-full border border-slate-200 transition"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SECTION D: SEO, Metadata & Other Columns */}
              {seoAndOtherCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-100">
                    SEO & Additional Metadata
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {seoAndOtherCols.map((col) => {
                      const colName = col.name;
                      return (
                        <div key={colName} ref={(el: HTMLDivElement | null) => (el ? orbitTargets.register(`manual.col.${colName}`, el) : orbitTargets.unregister(`manual.col.${colName}`))}>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                              <span>{colName}</span>
                              {!col.nullable && <span className="text-rose-500">*</span>}
                            </label>
                            <span className="text-[10px] text-slate-400 font-mono">{col.data_type}</span>
                          </div>
                          <SchemaFieldControl
                            column={col}
                            value={formData[colName]}
                            onChange={(val) => handleFieldChange(colName, val)}
                            targetTable={selectedTable?.name}
                            topic={formData.title || formData.name || aiTopic}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION E: Dynamic Custom / Extended Columns */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-indigo-600" />
                      Custom Additional Columns & Attributes
                    </h4>
                    <p className="text-[11px] text-slate-400">Add any extra column name and value for custom schema extensions</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddCustomField}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 transition shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Column</span>
                  </button>
                </div>

                {customFields.length > 0 ? (
                  <div className="space-y-2">
                    {customFields.map((cf) => (
                      <div key={cf.id} className="flex items-center gap-2 bg-slate-50/60 p-2 border border-slate-200 rounded-xl">
                        <input
                          type="text"
                          placeholder="Column name (e.g. tags, meta_keywords)"
                          value={cf.key}
                          onChange={(e) => handleCustomFieldChange(cf.id, e.target.value, cf.value)}
                          className="w-1/3 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 font-mono focus:ring-1 focus:ring-indigo-500"
                        />
                        <input
                          type="text"
                          placeholder="Value..."
                          value={cf.value}
                          onChange={(e) => handleCustomFieldChange(cf.id, cf.key, e.target.value)}
                          className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomField(cf.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                          title="Remove custom field"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">No custom fields added yet. Click &quot;Add Column&quot; if you want to write to unmapped columns.</p>
                )}
              </div>
            </motion.div>
          )}

          {/* Step 3: Scheduling Mode & Execution */}
          {selectedTable && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4"
            >
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                3. Dispatch & Publication Schedule
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-4 border rounded-xl flex items-center gap-3 cursor-pointer transition ${
                    publishMode === "NOW"
                      ? "bg-indigo-50/70 border-indigo-200 text-indigo-950 font-bold"
                      : "bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="publishMode"
                    checked={publishMode === "NOW"}
                    onChange={() => setPublishMode("NOW")}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs block">Publish Immediately</span>
                    <span className="text-[11px] text-slate-500 font-normal">Direct parameterized write now</span>
                  </div>
                </label>

                <label
                  className={`p-4 border rounded-xl flex items-center gap-3 cursor-pointer transition ${
                    publishMode === "SCHEDULED"
                      ? "bg-indigo-50/70 border-indigo-200 text-indigo-950 font-bold"
                      : "bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="publishMode"
                    checked={publishMode === "SCHEDULED"}
                    onChange={() => setPublishMode("SCHEDULED")}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs block">Schedule for Later</span>
                    <span className="text-[11px] text-slate-500 font-normal">Durable queue worker execution</span>
                  </div>
                </label>
              </div>

              {publishMode === "SCHEDULED" && (
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Target Publication Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  />
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Writing to Database...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>{publishMode === "NOW" ? "Publish Record Now" : "Schedule Publication Job"}</span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </form>
      )}
    </motion.div>
  );
};
