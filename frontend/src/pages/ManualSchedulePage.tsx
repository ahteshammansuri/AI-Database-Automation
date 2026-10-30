import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, CheckCircle2, AlertCircle, Database, TableProperties, Image as ImageIcon, Layers, Clock, Upload, Wand2, Plus, Loader2, Eye, ShieldCheck, ChevronDown, RotateCcw, Table2, Info } from "lucide-react";
import { api } from "../services/api";
import { DatePicker } from "../components/ui/DatePicker";
import { TimePicker } from "../components/ui/TimePicker";
import { TimezoneSelect } from "../components/ui/TimezoneSelect";
import { ContentPreview } from "../components/content/ContentPreview";
import { WysiwygEditor } from "../components/content/WysiwygEditor";
import { defaultTimeZone, todayIn, nowTimeIn, addMinutesHHMM, zonedIso, formatInstant, relativeFromNow } from "../lib/schedule";
import { ConnectionProfile, SchemaResponse, SchemaTable, SchemaColumn } from "../types";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { EmptyState, FieldError, ModalShell, PageHeader } from "../components/ui/kit";
import { ManualScheduleSkeleton } from "../components/ui/PageSkeletons";
import { SchemaFieldControl, isNumericType, canFieldHaveAiAssist } from "../components/common/SchemaFieldControl";
import { clearError, focusFirstError, invalid, serverFieldErrors, type FieldErrors } from "../lib/validation";
import { InlineAiFieldAssist } from "../components/common/InlineAiFieldAssist";
import { LinkPicker } from "../components/links/LinkPicker";
import { ValuePicker } from "../components/links/ValuePicker";
import { isNewLink, newLink, type LinkOptions } from "../components/links/linkValue";
import { isDatabaseNumbered } from "../components/schema/schemaFacts";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { usePlatform } from "../context/PlatformContext";

/** Input id for a column (or the schedule / target pickers) so its message sits under it. */
const manualFieldId = (field: string) => (field.startsWith("$") ? `manual-${field.slice(1)}` : `manual-col-${field}`);

/** A server plan issue reworded for the spot under its field (the column name is already the label). */
const issueText = (column: string, message: string) =>
  /is required in/.test(message) ? `${labelFor(column)} is required.` : message.replace(/`/g, "");

/** "category_id" -> "Category", "meta_title" -> "Meta title". */
const labelFor = (name: string) => {
  const words = name.replace(/_id$/i, "").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
};

const AUTO_COLUMNS = new Set(["created_at", "updated_at", "deleted_at"]);
const MEDIA = /(^|_)(image|img|banner|thumbnail|thumb|photo|logo|avatar|cover)(_url|_path|_src)?$/i;
const TEXTUAL = /char|text|enum|set|json/i;
const hasDefault = (c: SchemaColumn) => c.default_value !== undefined && c.default_value !== null;
const isRequired = (c: SchemaColumn) => !c.nullable && !hasDefault(c);
const blank = (v: any) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** A table manual publishing can write to: not restricted or sensitive, and writable on this connection. */
const isEligible = (t: SchemaTable) => t.category !== "RESTRICTED" && !t.is_sensitive && (t.data_class ?? "writable") === "writable";

const pickTable = (data: SchemaResponse | null, wanted: string | null): SchemaTable | null => {
  const eligible = (data?.tables ?? []).filter(isEligible);
  return (wanted ? eligible.find((t) => t.name === wanted) : undefined)
    ?? eligible.find((t) => t.category === "RECOMMENDED")
    ?? eligible[0]
    ?? null;
};

/** The table a column links to, as the server sees it: declared, detected from the name, or set by the owner. */
const refTableFor = (col: SchemaColumn, table: SchemaTable): string | null =>
  (table.relationships || []).find((r) => (r.foreign_key || r.constrained_column) === col.name)?.referenced_table ?? null;

/** Starting values: only what the database itself defines (defaults, the first allowed value of a required choice). */
const initialValues = (table: SchemaTable): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const col of table.columns) {
    if (isDatabaseNumbered(col) || col.sensitivity === "secret" || AUTO_COLUMNS.has(col.name.toLowerCase())) continue;
    if (col.enum_values?.length) {
      out[col.name] = hasDefault(col) && col.enum_values.includes(String(col.default_value)) ? String(col.default_value) : col.nullable ? "" : col.enum_values[0];
    } else if (hasDefault(col) && !/^current_timestamp|^now\(\)/i.test(String(col.default_value))) {
      out[col.name] = isNumericType(col) && Number.isFinite(Number(col.default_value)) ? Number(col.default_value) : String(col.default_value);
    } else {
      out[col.name] = "";
    }
  }
  return out;
};

const FieldLabel: React.FC<{ htmlFor: string; col: SchemaColumn; hint?: string; extra?: React.ReactNode }> = ({ htmlFor, col, hint, extra }) => (
  <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
    <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
      {labelFor(col.name)}
      {isRequired(col) ? <span className="text-rose-500" aria-label="required">*</span> : <span className="text-[11px] font-normal text-slate-400">optional</span>}
    </label>
    <span className="flex items-center gap-1.5">
      {extra}
      <span className="font-mono text-[10.5px] text-slate-400">{col.name}{hint ? ` · ${hint}` : col.max_length ? ` · up to ${col.max_length}` : ""}</span>
    </span>
  </div>
);

interface DraftPayload {
  connection_id: number;
  table: string;
  formData: Record<string, any>;
  /** Older drafts: a new linked row was a plain name with this flag (now a NewLink value in formData). */
  relationNew?: Record<string, boolean>;
  publishMode: "NOW" | "SCHEDULED";
  scheduleDate: string;
  scheduleClock: string;
  scheduleTz: string;
}

export const ManualSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config } = usePlatform();
  const mediaMb = config.platform.media_max_upload_mb;

  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);

  const [formData, setFormData] = useState<Record<string, any>>({});
  // What each linked column offers (its rows, what can be created), as its picker loaded it; Orbit uses the same.
  const [linkInfo, setLinkInfo] = useState<Record<string, LinkOptions>>({});
  const [publishMode, setPublishMode] = useState<"NOW" | "SCHEDULED">("NOW");
  const [scheduleTz, setScheduleTz] = useState<string>(defaultTimeZone());
  // Default: one hour from now, rounded up to 5 minutes (tomorrow if that crosses midnight).
  const defaultSlot = (() => {
    const tz = defaultTimeZone();
    const now = nowTimeIn(tz);
    const [h, m] = addMinutesHHMM(now, 60).split(":").map(Number);
    const total = (Math.ceil((h * 60 + m) / 5) * 5) % 1440;
    const clock = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    return { date: clock < now ? todayIn(tz, new Date(Date.now() + 86400000)) : todayIn(tz), clock };
  })();
  const [scheduleDate, setScheduleDate] = useState<string>(defaultSlot.date);
  const [scheduleClock, setScheduleClock] = useState<string>(defaultSlot.clock);
  const [uploadingCol, setUploadingCol] = useState<string | null>(null);
  const [review, setReview] = useState<{ plan: any; payload: Record<string, any> } | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [showAuto, setShowAuto] = useState(false);

  const [isInitializing, setIsInitializing] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Messages under each column / schedule input. Keys: column name, "$connection", "$table", "$schedule", "$aiTopic".
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [successResult, setSuccessResult] = useState<any | null>(null);

  // Server-side draft: what the customer typed survives leaving the page or another device.
  const [dirty, setDirty] = useState(false);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [restoredAt, setRestoredAt] = useState<string | null>(null);

  const [aiTopic, setAiTopic] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiSeconds, setAiSeconds] = useState(0);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [showAiHelper, setShowAiHelper] = useState(false);
  const initArgs = useRef({ conn: searchParams.get("connectionId"), table: searchParams.get("table") });

  const loadTable = (table: SchemaTable | null) => {
    setSelectedTable(table);
    setFormData(table ? initialValues(table) : {});
    setLinkInfo({});
    setFieldErrors({});
    setShowAuto(false);
  };

  // First load: a link (Schema Explorer, Orbit) names the connection and table; otherwise an unsent draft comes back.
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const list = await api.listConnections();
        const safeList: ConnectionProfile[] = Array.isArray(list) ? list : [];
        if (!isMounted) return;
        setConnections(safeList);
        if (!safeList.length) return;

        const askedConn = Number(initArgs.current.conn) || null;
        let draft: (DraftPayload & { saved_at?: string }) | null = null;
        if (!askedConn) {
          try {
            const res = await api.getDraft("manual_publish");
            draft = res?.draft ? { ...res.draft.payload, saved_at: res.draft.updated_at } : null;
          } catch {
            draft = null;
          }
        }
        const connId = [askedConn, draft?.connection_id].find((id) => id && safeList.some((c) => c.id === id)) ?? safeList[0].id;
        setSelectedConnId(connId);
        const data = await api.getSchema(connId);
        if (!isMounted) return;
        setSchema(data);
        const wanted = initArgs.current.table ?? (draft?.connection_id === connId ? draft.table : null);
        const table = pickTable(data, wanted);
        loadTable(table);
        if (wanted && table?.name !== wanted) {
          setNotice(`“${wanted}” cannot receive manual publishing on this connection (it is restricted or view only)${table ? `, so ${table.name} is selected instead` : ""}.`);
        }
        if (draft && table && draft.table === table.name && draft.connection_id === connId) {
          const cols = new Set(table.columns.map((c) => c.name));
          const keep = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => cols.has(k)));
          const restored = keep(draft!.formData);
          for (const [col, isNew] of Object.entries(keep(draft.relationNew))) {
            if (isNew && typeof restored[col] === "string") restored[col] = newLink(restored[col], null);
          }
          setFormData((prev) => ({ ...prev, ...restored }));
          if (draft.publishMode === "NOW" || draft.publishMode === "SCHEDULED") setPublishMode(draft.publishMode);
          if (draft.scheduleDate) setScheduleDate(draft.scheduleDate);
          if (draft.scheduleClock) setScheduleClock(draft.scheduleClock);
          if (draft.scheduleTz) setScheduleTz(draft.scheduleTz);
          setRestoredAt(draft.saved_at ?? new Date().toISOString());
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "Your database connections could not be loaded.");
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  // Save the draft a moment after each change (only once the customer has changed something).
  useEffect(() => {
    if (!dirty || !selectedConnId || !selectedTable || successResult) return;
    setDraftState("saving");
    const payload: DraftPayload = { connection_id: selectedConnId, table: selectedTable.name, formData, publishMode, scheduleDate, scheduleClock, scheduleTz };
    const t = setTimeout(async () => {
      try {
        await api.saveDraft("manual_publish", payload, 1);
        setDraftState("saved");
      } catch {
        setDraftState("error");
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [dirty, selectedConnId, selectedTable, formData, publishMode, scheduleDate, scheduleClock, scheduleTz, successResult]);

  // Elapsed seconds while the AI writes (a local model can take a minute or two).
  useEffect(() => {
    if (!isGeneratingAi) return;
    const started = Date.now();
    const t = setInterval(() => setAiSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => { clearInterval(t); setAiSeconds(0); };
  }, [isGeneratingAi]);

  const discardDraft = () => {
    api.deleteDraft("manual_publish").catch(() => {});
    setDirty(false);
    setDraftState("idle");
    setRestoredAt(null);
  };

  const startOver = () => {
    discardDraft();
    loadTable(selectedTable);
    setPublishMode("NOW");
  };

  const handleConnectionChange = async (newConnId: number) => {
    setSelectedConnId(newConnId);
    setNotice(null);
    try {
      setLoadingSchema(true);
      setError(null);
      setSuccessResult(null);
      const data = await api.getSchema(newConnId);
      setSchema(data);
      loadTable(pickTable(data, null));
    } catch (err: any) {
      setError(err.message || "The tables of this connection could not be read.");
      setSchema(null);
      loadTable(null);
    } finally {
      setLoadingSchema(false);
    }
  };

  const handleSelectTable = (tableName: string) => {
    const table = (schema?.tables || []).find((t) => t.name === tableName && isEligible(t));
    if (table) {
      loadTable(table);
      setNotice(null);
    }
  };

  const handleFieldChange = (colName: string, value: any) => {
    setDirty(true);
    setFieldErrors((x) => {
      let next = clearError(x, colName);
      if (colName === "title" || colName === "name") next = clearError(next, "slug");
      return next;
    });
    setFormData((prev) => {
      const updated = { ...prev, [colName]: value };
      // Keep the slug in step with the title until the customer edits the slug themselves.
      if ((colName === "title" || colName === "name") && "slug" in updated) {
        const was = slugify(String(prev[colName] ?? ""));
        if (!prev.slug || prev.slug === was) updated.slug = slugify(String(value));
      }
      return updated;
    });
  };

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
      setFieldErrors((x) => ({ ...x, [colName]: `The image could not be uploaded: ${msg}` }));
    } finally {
      setUploadingCol(null);
    }
  };

  // ---- Columns, grouped so each appears once ----------------------------------------------------------------------
  const allColumns = selectedTable?.columns || [];
  const formColumns = allColumns.filter((c) => !isDatabaseNumbered(c) && c.sensitivity !== "secret" && !AUTO_COLUMNS.has(c.name.toLowerCase()));
  const autoColumns = allColumns.filter((c) => AUTO_COLUMNS.has(c.name.toLowerCase()) && !c.is_primary_key);
  const refTables: Record<string, string | null> = Object.fromEntries(
    formColumns.map((c) => [c.name, selectedTable ? refTableFor(c, selectedTable) : null]),
  );
  const groups: Record<"main" | "media" | "content" | "other", SchemaColumn[]> = { main: [], media: [], content: [], other: [] };
  for (const c of formColumns) {
    const n = c.name.toLowerCase();
    if (refTables[c.name] || ["title", "name", "slug", "status"].includes(n)) groups.main.push(c);
    else if (MEDIA.test(n)) groups.media.push(c);
    else if ((/text/i.test(c.data_type) || /content|excerpt|description|body|summary/.test(n)) && !n.includes("meta")) groups.content.push(c);
    else groups.other.push(c);
  }
  const thingFor = (col: SchemaColumn) => linkInfo[col.name]?.thing ?? labelFor(col.name).toLowerCase();

  /** The values sent: blanks of optional columns become empty (or the database default), never invented. */
  const buildPayload = () => {
    const out: Record<string, any> = {};
    for (const col of [...formColumns, ...autoColumns]) {
      const v = formData[col.name];
      if (v === undefined) continue;
      if (blank(v)) {
        if (hasDefault(col)) continue;
        if (col.nullable) {
          out[col.name] = TEXTUAL.test(col.data_type) && !refTables[col.name] ? "" : null;
          continue;
        }
      }
      // A new linked row is sent by its name; the server creates it first (relation_policies) with its details.
      out[col.name] = isNewLink(v) ? v.label.trim() : v;
    }
    return out;
  };

  /** The executor's decisions for linked columns, by name, as the content preview shows them ("Category: Fashion"). */
  const planRelations = (plan: any) => (plan?.relations ?? [])
    .filter((r: any) => r?.column && r.action !== "LEFT_EMPTY")
    .map((r: any) => ({
      column: r.column,
      entity: linkInfo[r.column]?.thing ?? labelFor(r.column).toLowerCase(),
      label: r.action === "NOT_LINKED" ? "none" : r.label ?? (r.lookup !== null && r.lookup !== undefined ? `#${r.lookup}` : ""),
      decision: ["WILL_CREATE", "CREATED_NEW"].includes(r.action) ? "create" : "existing",
    }));

  const newLinkColumns = () => formColumns.filter((c) => refTables[c.name] && isNewLink(formData[c.name]));
  const relationPolicyPayload = () => Object.fromEntries(newLinkColumns().map((c) => [c.name, "CREATE_IF_MISSING" as const]));
  /** Details entered for each new linked row (its name travels in the payload). */
  const relationValuesPayload = () => Object.fromEntries(newLinkColumns().flatMap((c) => {
    const labelCol = linkInfo[c.name]?.create.label_column;
    const details = Object.fromEntries(Object.entries(formData[c.name].$new).filter(([k, v]) => k !== labelCol && v !== "" && v !== null && v !== undefined));
    return Object.keys(details).length ? [[c.name, details]] : [];
  }));

  const scheduledAtIso = () => zonedIso(scheduleDate, scheduleClock, scheduleTz);

  const showFieldErrors = (found: FieldErrors) => {
    setFieldErrors(found);
    setTimeout(() => focusFirstError(found, manualFieldId), 40);
  };

  // AI draft: the customer's "Writing content" model fills the empty text fields; nothing typed is overwritten.
  const handleGenerateAiDraft = async () => {
    if (!(aiTopic || "").trim()) {
      showFieldErrors({ $aiTopic: "Describe what the draft should be about." });
      return;
    }
    setFieldErrors((x) => clearError(x, "$aiTopic"));
    const fields = formColumns.filter((c) => !refTables[c.name] && !MEDIA.test(c.name) && canFieldHaveAiAssist(c)).map((c) => c.name);
    if (!fields.length) {
      setAiNote("This table has no text fields the AI can write.");
      return;
    }
    try {
      setIsGeneratingAi(true);
      setError(null);
      setAiNote(null);
      const res = await api.previewAIGeneration({ topic: aiTopic, target_table: selectedTable?.name, fields });
      const aiData = res?.data ?? {};
      let filled = 0;
      let kept = 0;
      setFormData((prev) => {
        const merged = { ...prev };
        for (const k of fields) {
          const v = aiData[k];
          if (v === undefined || v === null || typeof v === "object" || String(v).trim() === "") continue;
          if (!blank(merged[k])) { kept++; continue; }
          merged[k] = v;
          filled++;
        }
        if ("slug" in merged && blank(merged.slug) && (merged.title || merged.name)) merged.slug = slugify(String(merged.title || merged.name));
        return merged;
      });
      setDirty(true);
      setTimeout(() => setAiNote(filled ? `Filled ${filled} empty field${filled === 1 ? "" : "s"}${kept ? `; your own text in ${kept} field${kept === 1 ? " was" : "s were"} kept` : ""}. Check everything before publishing.` : "The model returned nothing for the empty fields. Try a more specific topic."), 0);
    } catch (err: any) {
      setError(err.message || "The AI could not write a draft.");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  /** Checks that need no database: required columns, lengths, numbers, allowed values, time. */
  const checkForm = (): FieldErrors => {
    const out: FieldErrors = {};
    if (!selectedConnId) out["$connection"] = "Choose a database connection.";
    if (!selectedTable) {
      out["$table"] = "Choose the table to write into.";
      return out;
    }
    for (const col of [...formColumns, ...autoColumns]) {
      const v = formData[col.name];
      const label = labelFor(col.name);
      if (refTables[col.name]) {
        if (isNewLink(v) && !v.label.trim()) out[col.name] = `Name the new ${thingFor(col)}.`;
        else if (blank(v) && isRequired(col)) out[col.name] = `Choose a ${thingFor(col)}.`;
        continue;
      }
      if (blank(v)) {
        if (isRequired(col) && formColumns.includes(col)) out[col.name] = `${label} is required.`;
        continue;
      }
      if (isNumericType(col) && typeof v !== "number" && !Number.isFinite(Number(v))) out[col.name] = `${label} must be a number.`;
      else if (col.max_length && typeof v === "string" && v.length > col.max_length) out[col.name] = `${label} must be ${col.max_length} characters or fewer (now ${v.length}).`;
      else if (col.enum_values?.length && !col.enum_values.includes(String(v))) out[col.name] = `${label} must be one of: ${col.enum_values.join(", ")}.`;
    }
    if (publishMode === "SCHEDULED" && new Date(scheduledAtIso()).getTime() < Date.now() + 60000) {
      out["$schedule"] = "That time has already passed. Pick a time at least one minute from now, or choose “Publish now”.";
    }
    return out;
  };

  /** Column problems from the server's dry run or a rejected publish, placed under their fields. */
  const columnErrorsFrom = (issues: any[]): FieldErrors => {
    const out: FieldErrors = {};
    const inForm = new Set([...formColumns, ...autoColumns].map((c) => c.name));
    for (const it of issues ?? []) {
      if (it?.level !== "error" || !it.column || !inForm.has(it.column) || out[it.column]) continue;
      out[it.column] = issueText(it.column, String(it.message ?? ""));
    }
    return out;
  };

  /** A 422 keyed "payload.<column>" (or a scheduling field) mapped to the form. */
  const payloadErrors = (err: any): FieldErrors => {
    const out: FieldErrors = {};
    for (const [k, v] of Object.entries(err?.errors ?? {})) {
      const msg = String(Array.isArray(v) ? v[0] : v);
      if (k.startsWith("payload.")) {
        const col = k.slice(8);
        if (allColumns.some((c) => c.name === col)) out[col] = issueText(col, msg);
      } else if (k === "scheduled_at" || k === "timezone") out["$schedule"] = msg;
      else if (k === "connection_id") out["$connection"] = msg;
      else if (k === "target_table") out["$table"] = msg;
    }
    return out;
  };

  // Step 1 of publishing: a read-only dry run that shows exactly what will be written.
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
      const res = await api.manualPublish({ connection_id: selectedConnId, target_table: selectedTable.name, payload, dry_run: true, relation_policies: relationPolicyPayload(), relation_values: relationValuesPayload() });
      // Problems with a column the customer can fix are shown under that column instead of in the review.
      const colErrs = columnErrorsFrom(res.plan?.issues);
      if (Object.keys(colErrs).length) {
        showFieldErrors(colErrs);
        return;
      }
      setReview({ plan: res.plan, payload });
    } catch (err: any) {
      const colErrs = { ...columnErrorsFrom(err.data?.plan?.issues), ...payloadErrors(err) };
      if (Object.keys(colErrs).length) showFieldErrors(colErrs);
      else setError(err.message || "This row could not be checked against your database.");
    } finally {
      setIsPlanning(false);
    }
  };

  // Step 2: the customer confirmed the reviewed plan.
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
        relation_values: relationValuesPayload(),
      });
      setReview(null);
      setSuccessResult({ ...res, written: review.payload, relations: planRelations(review.plan) });
      discardDraft();
    } catch (err: any) {
      const colErrs = { ...columnErrorsFrom(err.data?.plan?.issues), ...payloadErrors(err) };
      if (Object.keys(colErrs).length) {
        setReview(null);
        showFieldErrors(colErrs);
      } else {
        setError(err.message || "Publishing failed. Nothing was written.");
        if (err.data?.plan) setReview((r) => (r ? { ...r, plan: err.data.plan } : r));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Orbit surface: same state and API as the form; table columns are dynamic fields col.<name> -----------------
  const colKey = (key?: string) => String(key ?? "").replace(/^col\./, "");
  useOrbitSurface("manual.form", () => ({
    describe: () => ({
      connection_id: selectedConnId,
      table: selectedTable?.name ?? null,
      columns: formColumns.map((c) => ({
        field: `col.${c.name}`, label: labelFor(c.name), type: c.data_type, required: isRequired(c),
        links_to: refTables[c.name] ?? undefined, new_linked_row: refTables[c.name] ? isNewLink(formData[c.name]) : undefined,
        value: formData[c.name] === undefined ? null : isNewLink(formData[c.name]) ? `new: ${formData[c.name].label}` : String(formData[c.name]).slice(0, 120),
      })),
      tables: (schema?.tables || []).filter(isEligible).map((t) => t.name).slice(0, 60),
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
          const t = (schema?.tables || []).find((x) => x.name === name);
          if (!t) return `Table '${name}' is not in this schema.`;
          if (!isEligible(t)) return `Table '${name}' is restricted or view only, so it cannot receive manual publishing.`;
          handleSelectTable(name);
          return null;
        },
        options: () => (schema?.tables || []).filter(isEligible).map((t) => ({ value: t.name, label: t.name })),
      },
      "col.*": {
        get: (key) => formData[colKey(key)],
        set: (v, key) => {
          const c = colKey(key);
          const col = formColumns.find((x) => x.name === c);
          if (!col) return `Column '${c}' is not a field of this form.`;
          const ref = refTables[c];
          if (ref) {
            const isId = typeof v === "number" || /^\d+$/.test(String(v ?? "").trim());
            const create = linkInfo[c]?.create;
            if (!isId && create && !create.allowed) return `A new ${thingFor(col)} cannot be added here: ${create.reason ?? `${ref} is protected`}. Pick an existing one.`;
            handleFieldChange(c, isId ? Number(v) : newLink(String(v ?? "").trim(), create?.label_column ?? null));
            return null;
          }
          handleFieldChange(c, v);
          return null;
        },
        options: (key) => (linkInfo[colKey(key)]?.options || []).map((o) => ({ value: o.id, label: String(o.label ?? `#${o.id}`) })),
        target: (key) => `manual.col.${colKey(key)}`,
      },
      publish_mode: {
        get: () => publishMode,
        set: (v) => { const m = String(v).toUpperCase(); if (m !== "NOW" && m !== "SCHEDULED") return "Use NOW or SCHEDULED."; setPublishMode(m as any); setDirty(true); return null; },
        options: () => [{ value: "NOW", label: "Publish now" }, { value: "SCHEDULED", label: "Schedule" }],
      },
      scheduled_time: {
        get: () => `${scheduleDate} ${scheduleClock}`,
        set: (v) => {
          const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(v ?? ""));
          if (!m) return "Use YYYY-MM-DD HH:MM in the selected timezone.";
          setScheduleDate(m[1]);
          setScheduleClock(m[2]);
          setDirty(true);
          return null;
        },
      },
      ai_topic: { get: () => aiTopic, set: (v) => { setAiTopic(String(v ?? "")); setShowAiHelper(true); return null; } },
    },
    actions: {
      ai_draft: {
        enabled: () => !!(aiTopic || "").trim() && !!selectedTable && !isGeneratingAi,
        run: async () => {
          await handleGenerateAiDraft();
          return { success: true, message: "The AI filled the empty fields. Review them before publishing." };
        },
      },
      // Consequential: the server only lets Orbit press this after the user confirmed in Orbit's panel.
      publish: {
        enabled: () => !!selectedConnId && !!selectedTable && !isSubmitting,
        run: async () => {
          if (!selectedConnId || !selectedTable) return { success: false, message: "Choose the connection and table first." };
          const found = checkForm();
          if (Object.keys(found).length) {
            showFieldErrors(found);
            return { success: false, message: `Fix these fields first: ${Object.values(found).join(" ")}` };
          }
          const payload = buildPayload();
          try {
            setIsSubmitting(true);
            setError(null);
            const res: any = await api.manualPublish({
              connection_id: selectedConnId, target_table: selectedTable.name, payload,
              publish_now: publishMode === "NOW", scheduled_at: publishMode === "SCHEDULED" ? scheduledAtIso() : undefined,
              timezone: scheduleTz, relation_policies: relationPolicyPayload(), relation_values: relationValuesPayload(),
            });
            setSuccessResult({ ...res, written: payload });
            discardDraft();
            return { success: true, message: res?.message || "Published.", resource: res?.execution?.id ? { type: "AutomationExecution", id: res.execution.id } : undefined };
          } catch (err: any) {
            const colErrs = { ...columnErrorsFrom(err.data?.plan?.issues), ...payloadErrors(err) };
            if (Object.keys(colErrs).length) showFieldErrors(colErrs);
            else setError(err.message || "Publishing failed. Nothing was written.");
            return { success: false, message: err.message || "Publishing failed. Nothing was written." };
          } finally {
            setIsSubmitting(false);
          }
        },
      },
      review: {
        enabled: () => !!selectedConnId && !!selectedTable && !isPlanning,
        run: async () => {
          await handleSubmit({ preventDefault() {} } as React.FormEvent);
          return { success: true, message: "Checked against the database; the review shows exactly what will be written." };
        },
      },
    },
  }));

  const colRef = (name: string) => (el: HTMLDivElement | null) => (el ? orbitTargets.register(`manual.col.${name}`, el) : orbitTargets.unregister(`manual.col.${name}`));
  const eligibleTables = (schema?.tables || []).filter(isEligible);

  const renderStandard = (col: SchemaColumn, extra?: React.ReactNode) => (
    <div key={col.name} ref={colRef(col.name)} className={["title", "name"].includes(col.name.toLowerCase()) ? "sm:col-span-2" : ""}>
      <FieldLabel htmlFor={manualFieldId(col.name)} col={col} extra={extra ?? (canFieldHaveAiAssist(col) && (
        <InlineAiFieldAssist fieldName={col.name} currentValue={formData[col.name]} topic={formData.title || formData.name || aiTopic}
          targetTable={selectedTable?.name} onApply={(v) => handleFieldChange(col.name, v)} compact />
      ))} />
      {col.categorical && selectedConnId && selectedTable ? (
        <ValuePicker id={manualFieldId(col.name)} scope={{ connectionId: selectedConnId, context: "publish" }} table={selectedTable.name} column={col.name}
          value={formData[col.name]} onChange={(val) => handleFieldChange(col.name, val)} family={isNumericType(col) ? "integer" : "string"}
          nullable={col.nullable} labels={col.value_labels} invalid={!!fieldErrors[col.name]} describedBy={fieldErrors[col.name] ? `${manualFieldId(col.name)}-error` : undefined} />
      ) : (
        <SchemaFieldControl id={manualFieldId(col.name)} invalid={!!fieldErrors[col.name]} column={col} value={formData[col.name]}
          onChange={(val) => handleFieldChange(col.name, val)} targetTable={selectedTable?.name} topic={formData.title || formData.name || aiTopic} hideFieldAssist />
      )}
      <FieldError id={manualFieldId(col.name)} message={fieldErrors[col.name]} />
    </div>
  );

  const renderRelation = (col: SchemaColumn) => {
    const ref = refTables[col.name]!;
    const info = linkInfo[col.name];
    return (
      <div key={col.name} ref={colRef(col.name)} className="sm:col-span-2">
        <FieldLabel htmlFor={manualFieldId(col.name)} col={col} hint={`links to ${ref}`} />
        {selectedConnId && selectedTable && (
          <LinkPicker id={manualFieldId(col.name)} scope={{ connectionId: selectedConnId, context: "publish" }} table={selectedTable.name} column={col.name}
            value={formData[col.name]} onChange={(v) => handleFieldChange(col.name, v)} invalid={!!fieldErrors[col.name]}
            describedBy={fieldErrors[col.name] ? `${manualFieldId(col.name)}-error` : undefined}
            onLoaded={(o) => setLinkInfo((p) => ({ ...p, [col.name]: o }))} />
        )}
        <FieldError id={manualFieldId(col.name)} message={fieldErrors[col.name]} />
        {!fieldErrors[col.name] && info && (
          <p className="mt-1 text-[11.5px] text-slate-500">
            {isNewLink(formData[col.name])
              ? `“${formData[col.name].label}” is added to ${ref} first, then this row uses its new id. Both are written together, or neither.`
              : info.create.allowed
                ? `Pick a ${info.thing}, or type a new name to add one to ${ref}.`
                : `Pick a ${info.thing} from ${ref}.`}
          </p>
        )}
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Automate"
        title="Manual publishing"
        description="Write a row yourself (or let AI draft it) and publish it now or at a time you choose. Nothing is written until you have seen exactly what will change."
        actions={
          <>
            {draftState !== "idle" && !successResult && (
              <span className="text-[12px] text-slate-500" aria-live="polite">
                {draftState === "saving" ? "Saving draft…" : draftState === "saved" ? "Draft saved" : "Draft not saved (offline?)"}
              </span>
            )}
            <Link to="/executions" className="da-btn da-btn-secondary"><Layers className="h-4 w-4 text-slate-500" /> Execution history</Link>
          </>
        }
      />

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-start justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-800" role="alert">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <p className="font-bold">Not published</p>
                <p className="mt-0.5 leading-relaxed text-rose-700">{error}</p>
              </div>
            </div>
            <button type="button" onClick={() => setError(null)} className="ml-2 font-bold text-slate-400 hover:text-slate-600" aria-label="Dismiss">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {notice && !successResult && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold text-amber-500 hover:text-amber-700" aria-label="Dismiss">✕</button>
        </div>
      )}

      {restoredAt && !successResult && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-[13px] text-indigo-900">
          <span>Your unfinished row from {formatInstant(restoredAt, defaultTimeZone())} is back, exactly as you left it.</span>
          <button type="button" onClick={startOver} className="da-btn da-btn-secondary da-btn-sm"><RotateCcw className="h-3.5 w-3.5" /> Start over</button>
        </div>
      )}

      {isInitializing || loadingSchema ? (
        <ManualScheduleSkeleton label={isInitializing ? "Opening your workspace…" : "Reading the table…"} />
      ) : connections.length === 0 ? (
        <EmptyState icon={Database} title="No databases connected" description="Connect a database first to publish rows into it."
          action={<Link to="/connections" className="da-btn da-btn-primary">Connect a database</Link>} />
      ) : successResult ? (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="da-card space-y-6 border-emerald-200 p-7 sm:p-8">
          <div className="flex flex-col items-center gap-4 border-b border-slate-100 pb-6 sm:flex-row">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_14px_34px_-14px_rgba(16,185,129,0.9)]">
              {successResult.status === "SCHEDULED" ? <Clock className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h3 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-950">
                {successResult.status === "SCHEDULED" ? "Scheduled" : "Published"}
              </h3>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {successResult.message || (successResult.status === "SCHEDULED" ? "The row will be written at the chosen time, even if this page is closed." : "The row was checked and written to your database.")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="da-panel p-4">
              <span className="block text-[11px] font-medium text-slate-400">Table</span>
              <span className="font-mono text-sm font-bold text-slate-900">{selectedTable?.name}</span>
            </div>
            <div className="da-panel p-4">
              <span className="block text-[11px] font-medium text-slate-400">{successResult.status === "SCHEDULED" ? "Publishes" : "New row"}</span>
              <span className="text-sm font-bold text-emerald-700">
                {successResult.status === "SCHEDULED"
                  ? formatInstant(successResult.execution?.publication_time ?? scheduledAtIso(), scheduleTz, { withZone: true })
                  : successResult.result?.record_id != null ? `#${successResult.result.record_id}` : "Written"}
              </span>
            </div>
            <div className="da-panel p-4">
              <span className="block text-[11px] font-medium text-slate-400">Fields</span>
              <span className="text-sm font-bold text-slate-900">{successResult.result?.columns_written?.length ?? Object.keys(successResult.written ?? {}).length}</span>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">What was {successResult.status === "SCHEDULED" ? "scheduled" : "written"}</h4>
            <div className="max-h-56 space-y-1.5 overflow-y-auto text-[12px]">
              {Object.entries(successResult.written ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 border-b border-slate-100 py-1 last:border-0">
                  <span className="font-semibold text-slate-700">{labelFor(k)}</span>
                  <span className="max-w-md truncate text-right text-slate-600">
                    {(() => {
                      const rel = (successResult.relations ?? []).find((r: any) => r.column === k);
                      if (rel) return `${rel.label}${rel.decision === "create" ? " (new)" : ""}`;
                      return v === null ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/<[^>]+>/g, " ");
                    })()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2 sm:justify-start">
            <button type="button" onClick={() => { setSuccessResult(null); loadTable(selectedTable); setDirty(false); }} className="da-btn da-btn-primary">
              <Plus className="h-4 w-4" /> Publish another row
            </button>
            <button type="button" onClick={() => navigate("/executions")} className="da-btn da-btn-secondary"><Layers className="h-4 w-4 text-slate-500" /> Execution history</button>
            {config.features?.data_explorer && selectedTable && (
              <Link to={`/data?connection=${selectedConnId}&table=${encodeURIComponent(selectedTable.name)}`} className="da-btn da-btn-secondary">
                <Table2 className="h-4 w-4 text-slate-500" /> See it in Data
              </Link>
            )}
          </div>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* 1. Where */}
          <div className="da-card space-y-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                <Database className="h-4 w-4 text-indigo-600" /> Where should it go?
              </h3>
              {selectedTable && (
                <button type="button" onClick={() => setShowAiHelper((s) => !s)} aria-expanded={showAiHelper}
                  className="da-btn da-btn-sm border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                  <Wand2 className="h-3.5 w-3.5" /> Draft with AI
                </button>
              )}
            </div>

            <AnimatePresence>
              {showAiHelper && selectedTable && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 p-4">
                  <div>
                    <p className="flex items-center gap-1.5 text-[13px] font-bold text-indigo-950"><Wand2 className="h-3.5 w-3.5 text-indigo-600" /> What should this row be about?</p>
                    <p className="text-[12px] text-slate-500">Your “Writing content” model fills the empty text fields. Fields you already wrote are kept, and nothing is published until you confirm.</p>
                  </div>
                  <div className="flex gap-2">
                    <input id="manual-aiTopic" type="text" value={aiTopic} maxLength={400}
                      onChange={(e) => { setAiTopic(e.target.value); setFieldErrors((x) => clearError(x, "$aiTopic")); }}
                      placeholder="e.g. A guide to choosing hiking boots for wet weather"
                      aria-invalid={!!fieldErrors["$aiTopic"]} aria-describedby={fieldErrors["$aiTopic"] ? "manual-aiTopic-error" : undefined}
                      className={`da-input flex-1${invalid(fieldErrors["$aiTopic"])}`}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleGenerateAiDraft(); } }} />
                    <button type="button" onClick={handleGenerateAiDraft} disabled={isGeneratingAi} className="da-btn da-btn-accent shrink-0">
                      {isGeneratingAi ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing… {aiSeconds}s</> : <><Wand2 className="h-3.5 w-3.5" /> Write draft</>}
                    </button>
                  </div>
                  <FieldError id="manual-aiTopic" message={fieldErrors["$aiTopic"]} className="-mt-2" />
                  {isGeneratingAi && <p className="text-[12px] text-slate-500">On a local model this usually takes 20 seconds to 2 minutes. You can keep editing meanwhile; your text is not replaced.</p>}
                  {aiNote && !isGeneratingAi && <p className="text-[12px] font-medium text-indigo-800">{aiNote}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="da-label" htmlFor="manual-connection">Database</label>
                <SearchableSelect id="manual-connection" invalid={!!fieldErrors["$connection"]} value={selectedConnId}
                  onChange={(val) => { setFieldErrors((x) => clearError(x, "$connection")); void handleConnectionChange(Number(val)); }}
                  placeholder="Choose a connection" searchPlaceholder="Search connections…"
                  options={connections.map((c) => ({ value: c.id, label: `${c.name} (${(c as any).database_name || c.database || ""})`, badge: (c as any).db_type || "mysql" }))} />
                <FieldError id="manual-connection" message={fieldErrors["$connection"]} />
              </div>
              <div>
                <label className="da-label" htmlFor="manual-table">Table</label>
                <SearchableSelect id="manual-table" invalid={!!fieldErrors["$table"]} value={selectedTable?.name ?? ""}
                  onChange={(val) => { setFieldErrors({}); handleSelectTable(String(val)); }}
                  disabled={loadingSchema || !eligibleTables.length} placeholder="Choose a table" searchPlaceholder="Search tables…"
                  options={eligibleTables.map((t) => ({ value: t.name, label: t.name, badge: t.category === "RECOMMENDED" ? "Recommended" : undefined }))} />
                <FieldError id="manual-table" message={fieldErrors["$table"]} />
                <p className="da-help">Only tables you can write to are listed. Restricted and view-only tables stay protected.</p>
              </div>
            </div>
          </div>

          {!selectedTable ? (
            <EmptyState icon={TableProperties} title="No table can receive rows here"
              description="Every table of this connection is restricted or view only. Choose another connection, or change a table's access in the Schema Explorer."
              action={<Link to={`/explorer?connectionId=${selectedConnId ?? ""}`} className="da-btn da-btn-secondary">Open the Schema Explorer</Link>} />
          ) : (
            <>
              {/* 2. What */}
              <div className="da-card space-y-7 p-6 sm:p-7">
                <div>
                  <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                    <TableProperties className="h-4 w-4 text-indigo-600" /> What should the new row contain?
                  </h3>
                  <p className="mt-1.5 text-[13.5px] text-slate-500">Fields marked * are required by your database. Linked fields offer your real rows.</p>
                </div>

                {groups.main.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {groups.main.map((col) => (refTables[col.name] ? renderRelation(col) : renderStandard(col)))}
                  </div>
                )}

                {groups.content.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">Text</h4>
                    {groups.content.map((col) => {
                      const long = /longtext|mediumtext/i.test(col.data_type) || /content|body/.test(col.name.toLowerCase()) || col.name.toLowerCase() === "description";
                      return (
                        <div key={col.name} ref={colRef(col.name)}>
                          <FieldLabel htmlFor={manualFieldId(col.name)} col={col} extra={
                            <InlineAiFieldAssist fieldName={col.name} currentValue={formData[col.name]} topic={formData.title || formData.name || aiTopic}
                              targetTable={selectedTable.name} onApply={(v) => handleFieldChange(col.name, v)} compact />
                          } />
                          {long ? (
                            <WysiwygEditor id={manualFieldId(col.name)} value={formData[col.name] != null ? String(formData[col.name]) : ""}
                              onChange={(v) => handleFieldChange(col.name, v)} placeholder={`Write the ${labelFor(col.name).toLowerCase()}…`} minHeight="240px" error={fieldErrors[col.name]} />
                          ) : (
                            <textarea id={manualFieldId(col.name)} rows={3} aria-required={isRequired(col)} aria-invalid={!!fieldErrors[col.name]}
                              aria-describedby={fieldErrors[col.name] ? `${manualFieldId(col.name)}-error` : undefined}
                              value={formData[col.name] ?? ""} onChange={(e) => handleFieldChange(col.name, e.target.value)}
                              maxLength={col.max_length || undefined} className={`da-input leading-relaxed${invalid(fieldErrors[col.name])}`} />
                          )}
                          <FieldError id={manualFieldId(col.name)} message={fieldErrors[col.name]} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {groups.media.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2"><ImageIcon className="h-3.5 w-3.5 text-indigo-600" /> Images</h4>
                    {groups.media.map((col) => {
                      const current = formData[col.name];
                      return (
                        <div key={col.name} ref={colRef(col.name)} className="space-y-2">
                          <FieldLabel htmlFor={manualFieldId(col.name)} col={col} hint="image address" />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            <label htmlFor={`upload-${col.name}`}
                              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 p-4 text-center transition hover:border-indigo-300 hover:bg-slate-50/50">
                              <input id={`upload-${col.name}`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => handleImageFileChange(e, col.name)} className="sr-only" />
                              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                                {uploadingCol === col.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              </span>
                              <span className="text-[12.5px] font-semibold text-slate-800">{uploadingCol === col.name ? "Uploading…" : "Upload an image"}</span>
                              <span className="text-[11px] text-slate-400">PNG, JPG, WebP or GIF up to {mediaMb} MB. The field stores its web address.</span>
                            </label>
                            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                              {current ? (
                                <>
                                  <img src={current} alt="" className="h-16 w-16 rounded-lg border border-slate-200 bg-white object-cover" />
                                  <div className="min-w-0 flex-1 text-[12px]">
                                    <span className="block font-bold text-emerald-700">Image attached</span>
                                    <span className="block truncate font-mono text-[10.5px] text-slate-400">{current}</span>
                                    <button type="button" onClick={() => handleFieldChange(col.name, "")} className="mt-1 text-[11px] font-semibold text-rose-600 hover:underline">Remove image</button>
                                  </div>
                                </>
                              ) : (
                                <p className="w-full py-4 text-center text-[12px] text-slate-400">No image yet</p>
                              )}
                            </div>
                          </div>
                          <input id={manualFieldId(col.name)} type="url" value={current || ""} onChange={(e) => handleFieldChange(col.name, e.target.value)}
                            placeholder="…or paste the address of an image (https://…)" aria-invalid={!!fieldErrors[col.name]}
                            aria-describedby={fieldErrors[col.name] ? `${manualFieldId(col.name)}-error` : undefined}
                            className={`da-input font-mono text-[12.5px]${invalid(fieldErrors[col.name])}`} />
                          <FieldError id={manualFieldId(col.name)} message={fieldErrors[col.name]} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {groups.other.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="da-eyebrow w-full border-b border-slate-100 pb-2">More details</h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{groups.other.map((col) => renderStandard(col))}</div>
                  </div>
                )}

                {autoColumns.length > 0 && (
                  <div className="rounded-2xl border border-slate-200">
                    <button type="button" onClick={() => setShowAuto((s) => !s)} aria-expanded={showAuto}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-800">Filled in automatically</span>
                        <span className="block text-[12px] text-slate-500">{autoColumns.map((c) => labelFor(c.name)).join(", ")}: leave them to the database, or set a value yourself.</span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showAuto ? "rotate-180" : ""}`} />
                    </button>
                    {showAuto && <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-4 sm:grid-cols-2">{autoColumns.map((col) => renderStandard(col, <span />))}</div>}
                  </div>
                )}
              </div>

              {/* 3. When */}
              <div className="da-card space-y-5 p-6 sm:p-7">
                <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em] text-slate-950">
                  <Clock className="h-4 w-4 text-indigo-600" /> When should it publish?
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="When to publish">
                  {([
                    { k: "NOW", t: "Publish now", d: "Written as soon as you confirm the review." },
                    { k: "SCHEDULED", t: "Schedule for later", d: "Written at the time you pick, even if this page is closed." },
                  ] as const).map((o) => (
                    <label key={o.k} className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-all ${publishMode === o.k
                      ? "border-indigo-500 bg-indigo-50/60 text-indigo-950 ring-4 ring-indigo-500/10" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50/60"}`}>
                      <input type="radio" name="publishMode" checked={publishMode === o.k} onChange={() => { setPublishMode(o.k); setDirty(true); }} className="text-indigo-600 focus:ring-indigo-500" />
                      <span>
                        <span className="block text-[14px] font-bold">{o.t}</span>
                        <span className="text-[12.5px] text-slate-500">{o.d}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {publishMode === "SCHEDULED" && (
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="da-label">Date</label>
                        <DatePicker value={scheduleDate} onChange={(d) => { if (d) { setScheduleDate(d); setDirty(true); setFieldErrors((x) => clearError(x, "$schedule")); } }} today={todayIn(scheduleTz)} min={todayIn(scheduleTz)} invalid={!!fieldErrors["$schedule"]} ariaLabel="Publication date" />
                      </div>
                      <div>
                        <label className="da-label">Time</label>
                        <TimePicker value={scheduleClock} onChange={(t) => { setScheduleClock(t); setDirty(true); setFieldErrors((x) => clearError(x, "$schedule")); }} invalid={!!fieldErrors["$schedule"]} ariaLabel="Publication time" />
                      </div>
                      <div>
                        <label className="da-label">Timezone</label>
                        <TimezoneSelect value={scheduleTz} onChange={(tz) => { setScheduleTz(tz); setDirty(true); setFieldErrors((x) => clearError(x, "$schedule")); }} />
                      </div>
                    </div>
                    <div id="manual-schedule" tabIndex={-1}>
                      {fieldErrors["$schedule"] || new Date(scheduledAtIso()).getTime() < Date.now() + 60000 ? (
                        <FieldError id="manual-schedule" message={fieldErrors["$schedule"] ?? "That time has already passed. Pick a later time."} />
                      ) : (
                        <p className="text-[12px] text-slate-500">
                          {`Publishes ${formatInstant(scheduledAtIso(), scheduleTz, { withZone: true })} (${relativeFromNow(scheduledAtIso())}). It is written even if this page is closed.`}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="text-[12px] text-slate-500">Next you see exactly what will be written, including any linked row that is added first.</p>
                  <button type="submit" disabled={isPlanning || isSubmitting} className="da-btn da-btn-primary w-full px-6 sm:w-auto">
                    {isPlanning ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking against your database…</> : <><Eye className="h-3.5 w-3.5" /> Review before {publishMode === "NOW" ? "publishing" : "scheduling"}</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      )}

      <ModalShell
        open={!!review}
        onClose={() => !isSubmitting && setReview(null)}
        size="xl"
        icon={ShieldCheck}
        title={`Review before ${publishMode === "NOW" ? "publishing" : "scheduling"}`}
        description={publishMode === "NOW"
          ? `This is exactly what will be written to ${selectedTable?.name} when you confirm.`
          : `This will be written to ${selectedTable?.name} on ${formatInstant(scheduledAtIso(), scheduleTz, { withZone: true })}.`}
        footer={
          <>
            <button type="button" onClick={() => setReview(null)} disabled={isSubmitting} className="da-btn da-btn-ghost">Go back and edit</button>
            <button type="button" onClick={confirmPublish} disabled={isSubmitting || !review?.plan?.can_publish} className="da-btn da-btn-primary">
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {!review?.plan?.can_publish ? "Fix the problems first" : publishMode === "NOW" ? "Confirm and publish now" : "Confirm schedule"}
            </button>
          </>
        }
      >
        {review && (
          <ContentPreview payload={review.payload} meta={{ write_plan: review.plan, issues: review.plan?.issues ?? [], manual: true, relations: planRelations(review.plan) }}
            targetTable={selectedTable?.name} timezone={scheduleTz} publicationTime={publishMode === "SCHEDULED" ? scheduledAtIso() : null} defaultTab="database" />
        )}
      </ModalShell>
    </motion.div>
  );
};

function slugify(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s-]/g, "").trim().replace(/[-\s_]+/g, "-").replace(/^-+|-+$/g, "");
}
