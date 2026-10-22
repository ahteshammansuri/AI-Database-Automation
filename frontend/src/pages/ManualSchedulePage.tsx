import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, CheckCircle2, AlertCircle, Database, TableProperties, Cpu, Image as ImageIcon, Layers, Clock, Upload, X, Wand2, Plus, Loader2, Eye, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { DatePicker } from "../components/ui/DatePicker";
import { TimePicker } from "../components/ui/TimePicker";
import { TimezoneSelect } from "../components/ui/TimezoneSelect";
import { ContentPreview } from "../components/content/ContentPreview";
import { WysiwygEditor } from "../components/content/WysiwygEditor";
import { browserTimeZone, todayIn, nowTimeIn, addMinutesHHMM, zonedIso, formatInstant, relativeFromNow } from "../lib/schedule";
import { ConnectionProfile, SchemaResponse, SchemaTable, SchemaColumn } from "../types";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { EmptyState, FieldError, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { SchemaFieldControl, isNumericType } from "../components/common/SchemaFieldControl";
import { clearError, focusFirstError, invalid, serverFieldErrors, type FieldErrors } from "../lib/validation";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { usePlatform } from "../context/PlatformContext";

/** Input id for a column (or custom field, schedule, target picker) so its message sits under it. */
const manualFieldId = (field: string) =>
  field.startsWith("cf:") ? `manual-cf-${field.slice(3)}` : field.startsWith("$") ? `manual-${field.slice(1)}` : `manual-col-${field}`;

/** A server plan issue reworded for the spot under its field (the column name is already the label). */
const issueText = (column: string, message: string) =>
  /is required in/.test(message) ? `${column} is required.` : message.replace(/`/g, "");

export const ManualSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const mediaMb = usePlatform().config.platform.media_max_upload_mb;

  // State
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);

  // Dynamic Form Payload state
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [publishMode, setPublishMode] = useState<"NOW" | "SCHEDULED">("NOW");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [scheduleTz, setScheduleTz] = useState<string>(browserTimeZone());
  // Default: one hour from now, rounded up to 5 minutes (tomorrow if that crosses midnight).
  const defaultSlot = (() => {
    const tz = browserTimeZone();
    const now = nowTimeIn(tz);
    const [h, m] = addMinutesHHMM(now, 60).split(":").map(Number);
    const total = (Math.ceil((h * 60 + m) / 5) * 5) % 1440;
    const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    const today = todayIn(tz);
    return { date: clock < now ? todayIn(tz, new Date(Date.now() + 86400000)) : today, clock };
  })();
  const [scheduleDate, setScheduleDate] = useState<string>(defaultSlot.date);
  const [scheduleClock, setScheduleClock] = useState<string>(defaultSlot.clock);
  const [relationPolicies, setRelationPolicies] = useState<Record<string, boolean>>({});
  const [uploadingCol, setUploadingCol] = useState<string | null>(null);
  const [review, setReview] = useState<{ plan: any; payload: Record<string, any> } | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

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
  // Messages under each column / custom field / schedule input. Keys: column name, "cf:<id>", "$connection", "$table", "$schedule".
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successResult, setSuccessResult] = useState<any | null>(null);

  // AI Content Assistant state
  const [aiTopic, setAiTopic] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [showAiHelper, setShowAiHelper] = useState(false);

  // File upload input ref for image

  // Stock image presets for image/banner fields
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
    setFieldErrors((x) => clearError(x, `cf:${id}`));
  };

  const handleCustomFieldChange = (id: string, key: string, value: string) => {
    setFieldErrors((x) => clearError(x, `cf:${id}`));
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
        initial[col.name] = "";
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
    setFieldErrors((x) => {
      let next = clearError(x, colName);
      if (colName === "title" || colName === "name") next = clearError(next, "slug");
      return next;
    });
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
  // Images are uploaded to the platform and the column receives the public URL (never a base64 blob).
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>, colName: string) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setUploadingCol(colName);
      setFieldErrors((x) => clearError(x, colName));
      const res = await api.uploadMedia(file);
      handleFieldChange(colName, res.url);
    } catch (err: any) {
      const msg = serverFieldErrors(err).file ?? err.message;
      setFieldErrors((x) => ({ ...x, [colName]: `Image upload failed: ${msg}` }));
    } finally {
      setUploadingCol(null);
    }
  };

  const buildPayload = () => {
    const finalPayload: Record<string, any> = { ...formData };
    customFields.forEach((cf) => {
      if (cf.key.trim()) finalPayload[cf.key.trim()] = cf.value;
    });
    return finalPayload;
  };

  const relationPolicyPayload = () =>
    Object.fromEntries(Object.entries(relationPolicies).filter(([, on]) => on).map(([col]) => [col, "CREATE_IF_MISSING" as const]));

  const scheduledAtIso = () => zonedIso(scheduleDate, scheduleClock, scheduleTz);

  // AI Content Generator: Auto-draft content for the form using Python AI Service
  const handleGenerateAiDraft = async () => {
    if (!aiTopic.trim()) {
      showFieldErrors({ $aiTopic: "Describe what the draft should be about." });
      return;
    }
    setFieldErrors((x) => clearError(x, "$aiTopic"));

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
      scheduled_time: {
        get: () => `${scheduleDate} ${scheduleClock}`,
        set: (v) => {
          const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(v ?? ""));
          if (!m) return "Use YYYY-MM-DD HH:MM in the selected timezone.";
          setScheduleDate(m[1]);
          setScheduleClock(m[2]);
          setScheduledTime(String(v));
          return null;
        },
      },
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
              publish_now: publishMode === "NOW", scheduled_at: publishMode === "SCHEDULED" ? scheduledAtIso() : undefined,
              timezone: scheduleTz, relation_policies: relationPolicyPayload(),
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

  // Step 1 of publishing: a read-only dry run that shows exactly what will be written.
  /** Checks that need no database: required columns, lengths, numbers, allowed values, custom fields, time. */
  const checkForm = (): FieldErrors => {
    const out: FieldErrors = {};
    if (!selectedConnId) out["$connection"] = "Choose a database connection.";
    if (!selectedTable) {
      out["$table"] = "Choose the table to write into.";
      return out;
    }
    for (const col of editableColumns) {
      const v = formData[col.name];
      const blank = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
      if (blank) {
        // Same rule as the server: NOT NULL with no default must be filled.
        if (!col.nullable && (col.default_value === undefined || col.default_value === null)) out[col.name] = `${col.name} is required.`;
        continue;
      }
      if (isNumericType(col) && typeof v !== "number" && !Number.isFinite(Number(v))) out[col.name] = `${col.name} must be a number.`;
      else if (col.max_length && typeof v === "string" && v.length > col.max_length) out[col.name] = `${col.name} must be ${col.max_length} characters or fewer (now ${v.length}).`;
      else if (col.enum_values?.length && !col.enum_values.includes(String(v))) out[col.name] = `${col.name} must be one of: ${col.enum_values.join(", ")}.`;
    }
    const known = new Set((selectedTable.columns || []).map((c) => c.name));
    const seen = new Set<string>();
    for (const cf of customFields) {
      const key = cf.key.trim();
      if (!key) {
        if (cf.value.trim()) out[`cf:${cf.id}`] = "Enter the column name for this value.";
        continue;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) out[`cf:${cf.id}`] = "Column names use letters, numbers and _ (up to 64 characters), starting with a letter or _.";
      else if (editableColumns.some((c) => c.name === key)) out[`cf:${cf.id}`] = `“${key}” already has a field above. Fill it there instead.`;
      else if (seen.has(key)) out[`cf:${cf.id}`] = `“${key}” is added twice.`;
      else if (!known.has(key)) out[`cf:${cf.id}`] = `${selectedTable.name} has no column named “${key}”.`;
      seen.add(key);
    }
    if (publishMode === "SCHEDULED" && new Date(scheduledAtIso()).getTime() < Date.now() + 60000) {
      out["$schedule"] = "That time has already passed. Pick a time at least one minute from now, or choose “Publish Immediately”.";
    }
    return out;
  };

  /** Column problems from the server's dry run or a rejected publish, placed under their fields. */
  const columnErrorsFrom = (issues: any[]): FieldErrors => {
    const out: FieldErrors = {};
    const inForm = new Set(editableColumns.map((c) => c.name));
    for (const it of issues ?? []) {
      if (it?.level !== "error" || !it.column) continue;
      const cf = customFields.find((f) => f.key.trim() === it.column);
      const key = inForm.has(it.column) ? it.column : cf ? `cf:${cf.id}` : null;
      if (key && !out[key]) out[key] = issueText(it.column, String(it.message ?? ""));
    }
    return out;
  };

  const showFieldErrors = (found: FieldErrors) => {
    setFieldErrors(found);
    setTimeout(() => focusFirstError(found, manualFieldId), 40);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const found = checkForm();
    if (Object.keys(found).length || !selectedConnId || !selectedTable) {
      showFieldErrors(found);
      return;
    }
    setFieldErrors({});
    try {
      setIsPlanning(true);
      const payload = buildPayload();
      const res = await api.manualPublish({
        connection_id: selectedConnId,
        target_table: selectedTable.name,
        payload,
        dry_run: true,
        relation_policies: relationPolicyPayload(),
      });
      // Problems with a column the user can fix are shown under that column instead of in the review.
      const colErrs = columnErrorsFrom(res.plan?.issues);
      if (Object.keys(colErrs).length) {
        showFieldErrors(colErrs);
        return;
      }
      setReview({ plan: res.plan, payload });
    } catch (err: any) {
      const colErrs = { ...columnErrorsFrom(err.data?.plan?.issues), ...payloadErrors(err) };
      if (Object.keys(colErrs).length) showFieldErrors(colErrs);
      else setError(err.message || "Could not check this record.");
    } finally {
      setIsPlanning(false);
    }
  };

  /** A 422 keyed "payload.<column>" (or a scheduling field) mapped to the form. */
  const payloadErrors = (err: any): FieldErrors => {
    const out: FieldErrors = {};
    const raw = err?.errors ?? {};
    for (const [k, v] of Object.entries(raw)) {
      const msg = String(Array.isArray(v) ? v[0] : v);
      if (k.startsWith("payload.")) {
        const col = k.slice(8);
        const cf = customFields.find((f) => f.key.trim() === col);
        const key = editableColumns.some((c) => c.name === col) ? col : cf ? `cf:${cf.id}` : null;
        if (key) out[key] = issueText(col, msg);
      } else if (k === "scheduled_at" || k === "timezone") {
        out["$schedule"] = msg;
      } else if (k === "connection_id") {
        out["$connection"] = msg;
      } else if (k === "target_table") {
        out["$table"] = msg;
      }
    }
    return out;
  };

  // Step 2: the user confirmed the reviewed plan.
  const confirmPublish = async () => {
    if (!selectedConnId || !selectedTable || !review) return;
    try {
      setIsSubmitting(true);
      setError(null);
      const res = await api.manualPublish({
        connection_id: selectedConnId,
        target_table: selectedTable.name,
        payload: review.payload,
        publish_now: publishMode === "NOW",
        scheduled_at: publishMode === "SCHEDULED" ? scheduledAtIso() : undefined,
        timezone: scheduleTz,
        relation_policies: relationPolicyPayload(),
      });
      setReview(null);
      setSuccessResult(res);
    } catch (err: any) {
      const colErrs = { ...columnErrorsFrom(err.data?.plan?.issues), ...payloadErrors(err) };
      if (Object.keys(colErrs).length) {
        // Close the review so the messages under the fields are visible.
        setReview(null);
        showFieldErrors(colErrs);
      } else {
        setError(err.message || "Publishing failed.");
        if (err.data?.plan) setReview((r) => (r ? { ...r, plan: err.data.plan } : r));
      }
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
      className="max-w-5xl mx-auto space-y-6"
    >
      <PageHeader
        eyebrow="Automate"
        title="Manual publishing"
        description="Write or paste content yourself and publish it into any eligible table, now or at a time you choose. Every row is checked against your live schema before it is written."
        actions={
          <Link to="/executions" className="da-btn da-btn-secondary">
            <Layers className="h-4 w-4 text-slate-500" /> Execution history
          </Link>
        }
      />

      {/* Error alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-start justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-800"
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
        <div className="da-card">
          <Loading label={isInitializing ? "Opening your workspace…" : "Reading the table schema…"} className="py-20" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No databases connected"
          description="Connect at least one database to publish content manually."
          action={<Link to="/connections" className="da-btn da-btn-primary">Connect a database</Link>}
        />
      ) : successResult ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="da-card border-emerald-200 p-7 sm:p-8 space-y-6"
        >
          {/* Celebratory header */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pb-6 border-b border-slate-100">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_14px_34px_-14px_rgba(16,185,129,0.9)]">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                  {successResult.status === "SCHEDULED" ? "QUEUED IN SCHEDULER" : "COMPLETED & COMMITTED"}
                </span>
                <span className="text-xs text-slate-400 font-medium">• Target MySQL Safe Execution</span>
              </div>
              <h3 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-950">
                {successResult.status === "SCHEDULED" ? "Manual Publishing Job Scheduled!" : "Manual Automation Completed Successfully!"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {successResult.message || "Record successfully validated and written directly to your connected database."}
              </p>
            </div>
          </div>

          {/* Details breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="da-panel p-4 text-xs">
              <span className="text-slate-400 text-[11px] block font-medium">Target Table</span>
              <span className="font-mono font-bold text-slate-900 text-sm">{selectedTable?.name || successResult.result?.table}</span>
            </div>
            <div className="da-panel p-4 text-xs">
              <span className="text-slate-400 text-[11px] block font-medium">Generated Primary Key</span>
              <span className="font-mono font-bold text-emerald-700 text-sm">#{successResult.result?.record_id ?? "N/A"}</span>
            </div>
            <div className="da-panel p-4 text-xs">
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
              className="da-btn da-btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Publish Another Record</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/executions")}
              className="da-btn da-btn-secondary"
            >
              <Layers className="w-4 h-4 text-slate-500" />
              <span>View Execution Logs</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/schema?connectionId=${selectedConnId}&table=${selectedTable?.name}`)}
              className="da-btn da-btn-secondary"
            >
              <TableProperties className="w-4 h-4 text-slate-500" />
              <span>Inspect in Schema Explorer</span>
            </button>
          </div>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Step 1: Target Database & Target Table Selection */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="da-card p-6 sm:p-7 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                <Database className="w-3.5 h-3.5 text-indigo-600" />
                Where should it go?
              </h3>

              {/* AI Assistant Quick Toggle */}
              <button
                type="button"
                onClick={() => setShowAiHelper(!showAiHelper)}
                className="da-btn da-btn-sm border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
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
                  className="space-y-3 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 p-4"
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
                      id="manual-aiTopic"
                      type="text"
                      value={aiTopic}
                      onChange={(e) => { setAiTopic(e.target.value); setFieldErrors((x) => clearError(x, "$aiTopic")); }}
                      placeholder="e.g. Scaling Relational MySQL with Read Replicas & Connection Pooling"
                      aria-invalid={!!fieldErrors["$aiTopic"]}
                      aria-describedby={fieldErrors["$aiTopic"] ? "manual-aiTopic-error" : undefined}
                      className={`da-input flex-1${invalid(fieldErrors["$aiTopic"])}`}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleGenerateAiDraft())}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateAiDraft}
                      disabled={isGeneratingAi}
                      className="da-btn da-btn-accent shrink-0"
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
                  <FieldError id="manual-aiTopic" message={fieldErrors["$aiTopic"]} className="-mt-2" />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="da-label">
                  Target Database Connection
                </label>
                <SearchableSelect
                  id="manual-connection"
                  invalid={!!fieldErrors["$connection"]}
                  value={selectedConnId}
                  onChange={(val) => { setFieldErrors((x) => clearError(x, "$connection")); handleConnectionChange(Number(val)); }}
                  placeholder="Select database connection..."
                  searchPlaceholder="Search database connections..."
                  options={connections.map((c) => ({
                    value: c.id,
                    label: `${c.name} (${(c as any).database_name || c.database || "MySQL"})`,
                    badge: (c as any).driver || "mysql",
                  }))}
                />
                <FieldError id="manual-connection" message={fieldErrors["$connection"]} />
              </div>

              <div>
                <label className="da-label">
                  Target Table
                </label>
                <SearchableSelect
                  id="manual-table"
                  invalid={!!fieldErrors["$table"]}
                  value={selectedTable ? selectedTable.name || (selectedTable as any).table_name : ""}
                  onChange={(val) => { setFieldErrors({}); handleSelectTable(String(val)); }}
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
                <FieldError id="manual-table" message={fieldErrors["$table"]} />
              </div>
            </div>
          </motion.div>

          {/* Step 2: Content Form Fields */}
          {selectedTable && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="da-card p-6 sm:p-7 space-y-7"
            >
              <div>
                <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                  <TableProperties className="w-3.5 h-3.5 text-indigo-600" />
                  Write the content
                </h3>
                <p className="mt-1.5 text-[13.5px] text-slate-500">
                  Options for linked columns come from your real tables.
                </p>
              </div>

              {/* SECTION A: Primary Identifiers & Relational Fields */}
              <div className="space-y-4">
                <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">
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
                          id={manualFieldId(colName)}
                          invalid={!!fieldErrors[colName]}
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
                        <FieldError id={manualFieldId(colName)} message={fieldErrors[colName]} />
                        {isRelational && typeof formData[colName] === "string" && formData[colName].trim() !== "" && !/^\d+$/.test(formData[colName].trim()) && (
                          <label className="mt-1.5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900">
                            <input
                              type="checkbox"
                              checked={relationPolicies[colName] ?? true}
                              onChange={(e) => setRelationPolicies((p) => ({ ...p, [colName]: e.target.checked }))}
                              className="mt-0.5 rounded border-emerald-300 text-emerald-600"
                            />
                            <span>If no {refTable ?? "record"} named “{formData[colName]}” exists, create it first and link this row to it. You will see this in the review before anything is written.</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION B: Content & Text Body */}
              {contentCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">
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
                          {isLongText ? (
                            <WysiwygEditor
                              id={manualFieldId(colName)}
                              value={formData[colName] !== undefined ? String(formData[colName]) : ""}
                              onChange={(newVal) => handleFieldChange(colName, newVal)}
                              placeholder={`Write formatted article or content for ${colName}...`}
                              minHeight="240px"
                              error={fieldErrors[colName]}
                            />
                          ) : (
                            <textarea
                              id={manualFieldId(colName)}
                              rows={3}
                              aria-required={!col.nullable}
                              aria-invalid={!!fieldErrors[colName]}
                              aria-describedby={fieldErrors[colName] ? `${manualFieldId(colName)}-error` : undefined}
                              value={formData[colName] !== undefined ? formData[colName] : ""}
                              onChange={(e) => handleFieldChange(colName, e.target.value)}
                              placeholder={`Enter ${colName}...`}
                              className={`da-input leading-relaxed${invalid(fieldErrors[colName])}`}
                            />
                          )}
                          <FieldError id={manualFieldId(colName)} message={fieldErrors[colName]} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION C: Image & Media Uploader */}
              {mediaCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">
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
                          <span className="text-[10px] text-slate-400 font-mono">Image URL</span>
                        </div>

                        {/* Upload zone (one file input per column) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label
                            htmlFor={`upload-${colName}`}
                            className="border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50 rounded-xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-1.5"
                          >
                            <input
                              id={`upload-${colName}`}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={(e) => handleImageFileChange(e, colName)}
                              className="sr-only"
                            />
                            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                              {uploadingCol === colName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            </div>
                            <span className="text-xs font-semibold text-slate-800">
                              {uploadingCol === colName ? "Uploading…" : "Upload an image"}
                            </span>
                            <span className="text-[10px] text-slate-400">PNG, JPG, WebP or GIF up to {mediaMb} MB · stored as a URL</span>
                          </label>

                          {/* Live Thumbnail Preview */}
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center gap-3">
                            {currentValue ? (
                              <>
                                <img
                                  src={currentValue}
                                  alt="Preview"
                                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 bg-white"
                                />
                                <div className="flex-1 min-w-0 text-xs">
                                  <span className="text-emerald-700 font-bold block">Image Attached</span>
                                  <span className="text-[10px] text-slate-400 font-mono truncate block">
                                    {currentValue}
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
                            id={manualFieldId(colName)}
                            type="text"
                            value={currentValue || ""}
                            onChange={(e) => handleFieldChange(colName, e.target.value)}
                            placeholder="Or paste external image URL..."
                            aria-invalid={!!fieldErrors[colName]}
                            aria-describedby={fieldErrors[colName] ? `${manualFieldId(colName)}-error` : undefined}
                            className={`da-input font-mono${invalid(fieldErrors[colName])}`}
                          />
                          <FieldError id={manualFieldId(colName)} message={fieldErrors[colName]} />

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SECTION D: SEO, Metadata & Other Columns */}
              {seoAndOtherCols.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">
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
                            id={manualFieldId(colName)}
                            invalid={!!fieldErrors[colName]}
                            column={col}
                            value={formData[colName]}
                            onChange={(val) => handleFieldChange(colName, val)}
                            targetTable={selectedTable?.name}
                            topic={formData.title || formData.name || aiTopic}
                          />
                          <FieldError id={manualFieldId(colName)} message={fieldErrors[colName]} />
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
                    <h4 className="da-eyebrow">
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
                      <div key={cf.id}>
                      <div className={`flex items-center gap-2 p-2 border rounded-xl ${fieldErrors[`cf:${cf.id}`] ? "border-rose-300 bg-rose-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                        <input
                          id={manualFieldId(`cf:${cf.id}`)}
                          type="text"
                          placeholder="Column name (e.g. tags, meta_keywords)"
                          value={cf.key}
                          onChange={(e) => handleCustomFieldChange(cf.id, e.target.value, cf.value)}
                          aria-invalid={!!fieldErrors[`cf:${cf.id}`]}
                          aria-describedby={fieldErrors[`cf:${cf.id}`] ? `${manualFieldId(`cf:${cf.id}`)}-error` : undefined}
                          className={`da-input w-1/3 py-2 font-mono${invalid(fieldErrors[`cf:${cf.id}`])}`}
                        />
                        <input
                          type="text"
                          placeholder="Value..."
                          value={cf.value}
                          onChange={(e) => handleCustomFieldChange(cf.id, cf.key, e.target.value)}
                          className="da-input flex-1 py-2"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomField(cf.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                          title="Remove custom field"
                          aria-label="Remove custom field"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <FieldError id={manualFieldId(`cf:${cf.id}`)} message={fieldErrors[`cf:${cf.id}`]} />
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
              className="da-card p-6 sm:p-7 space-y-5"
            >
              <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                When should it publish?
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-4 border rounded-2xl flex items-center gap-3 cursor-pointer transition-all ${
                    publishMode === "NOW"
                      ? "border-indigo-500 bg-indigo-50/60 text-indigo-950 font-bold ring-4 ring-indigo-500/10"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50/60"
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
                    <span className="block text-[14px]">Publish Immediately</span>
                    <span className="text-[12.5px] font-normal text-slate-500">Direct parameterized write now</span>
                  </div>
                </label>

                <label
                  className={`p-4 border rounded-2xl flex items-center gap-3 cursor-pointer transition-all ${
                    publishMode === "SCHEDULED"
                      ? "border-indigo-500 bg-indigo-50/60 text-indigo-950 font-bold ring-4 ring-indigo-500/10"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50/60"
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
                    <span className="block text-[14px]">Schedule for Later</span>
                    <span className="text-[12.5px] font-normal text-slate-500">Durable queue worker execution</span>
                  </div>
                </label>
              </div>

              {publishMode === "SCHEDULED" && (
                <div className="space-y-2 pt-2">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="da-label">Date</label>
                      <DatePicker value={scheduleDate} onChange={(d) => { if (d) { setScheduleDate(d); setFieldErrors((x) => clearError(x, "$schedule")); } }} today={todayIn(scheduleTz)} min={todayIn(scheduleTz)} invalid={!!fieldErrors["$schedule"]} ariaLabel="Publication date" />
                    </div>
                    <div>
                      <label className="da-label">Time</label>
                      <TimePicker value={scheduleClock} onChange={(t) => { setScheduleClock(t); setFieldErrors((x) => clearError(x, "$schedule")); }} invalid={!!fieldErrors["$schedule"]} ariaLabel="Publication time" />
                    </div>
                    <div>
                      <label className="da-label">Timezone</label>
                      <TimezoneSelect value={scheduleTz} onChange={(tz) => { setScheduleTz(tz); setFieldErrors((x) => clearError(x, "$schedule")); }} />
                    </div>
                  </div>
                  <div id="manual-schedule" tabIndex={-1}>
                    {fieldErrors["$schedule"] || new Date(scheduledAtIso()).getTime() < Date.now() + 60000 ? (
                      <FieldError id="manual-schedule" message={fieldErrors["$schedule"] ?? "That time has already passed. Pick a later time."} />
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        {`Publishes ${formatInstant(scheduledAtIso(), scheduleTz, { withZone: true })} (${relativeFromNow(scheduledAtIso())}). The background worker writes it even if this page is closed.`}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={isPlanning || isSubmitting}
                  className="da-btn da-btn-primary w-full sm:w-auto px-6"
                >
                  {isPlanning ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Checking against your database…</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review before {publishMode === "NOW" ? "publishing" : "scheduling"}</span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </form>
      )}
      {/* Review before anything is written */}
      <ModalShell
        open={!!review}
        onClose={() => setReview(null)}
        size="xl"
        icon={ShieldCheck}
        title={`Review before ${publishMode === "NOW" ? "publishing" : "scheduling"}`}
        description={publishMode === "NOW"
          ? `This is exactly what will be written to ${selectedTable?.name} when you confirm.`
          : `This will be written to ${selectedTable?.name} on ${formatInstant(scheduledAtIso(), scheduleTz, { withZone: true })}.`}
        footer={
          <>
            <button type="button" onClick={() => setReview(null)} className="da-btn da-btn-ghost">Go back and edit</button>
            <button type="button" onClick={confirmPublish} disabled={isSubmitting || !review?.plan?.can_publish} className="da-btn da-btn-primary">
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {!review?.plan?.can_publish ? "Fix the problems first" : publishMode === "NOW" ? "Confirm and publish now" : "Confirm schedule"}
            </button>
          </>
        }
      >
        {review && (
          <ContentPreview
            payload={review.payload}
            meta={{ write_plan: review.plan, issues: review.plan?.issues ?? [], manual: true }}
            targetTable={selectedTable?.name}
            timezone={scheduleTz}
            publicationTime={publishMode === "SCHEDULED" ? scheduledAtIso() : null}
            defaultTab="database"
          />
        )}
      </ModalShell>
    </motion.div>
  );
};
