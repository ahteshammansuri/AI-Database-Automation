import React, { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { TableProperties, Database, ShieldAlert, Workflow, Cpu, Search, CheckCircle2, FileEdit, Layers, RefreshCw, Bookmark, Check, AlertTriangle, Table2, Columns3, Rows3 } from "lucide-react";
import { api } from "../services/api";
import { ConnectionProfile, SchemaResponse, SchemaTable } from "../types";
import { Card, EmptyState, FieldError, Loading, PageHeader } from "../components/ui/kit";
import { ariaFor, invalid, rules, serverFieldErrors, validateField } from "../lib/validation";
import { humanStatus } from "../components/common/statusText";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { fieldTarget } from "../services/orbitSurfaces";
import { pageStateService } from "../services/pageStateService";
import { BrandName, usePlatform } from "../context/PlatformContext";
import { TableLinks } from "../components/schema/TableLinks";
import { ColumnsTable } from "../components/schema/ColumnsTable";
import { accessLabel, formatRows } from "../components/schema/schemaFacts";
import { TableAccessControl } from "../components/schema/TableAccessControl";

export const SchemaExplorerPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const connParam = searchParams.get("connectionId");
  const tableParam = searchParams.get("table");
  const { config } = usePlatform();

  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const connectionsRef = useRef<ConnectionProfile[]>([]);
  connectionsRef.current = connections;
  const connectionSelectRef = useOrbitTarget<HTMLDivElement>("explorer.connection_select");
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const schemaRef = useRef<SchemaResponse | null>(null);
  schemaRef.current = schema;
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & 4-Tier Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"RECOMMENDED" | "REVIEW_REQUIRED" | "RESTRICTED" | "ALL">("RECOMMENDED");

  // User Workspace Annotation edit state
  const [userNote, setUserNote] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSavedFeedback, setNoteSavedFeedback] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Initial load
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
          const targetId = connParam ? parseInt(connParam) : safeList[0].id;
          setSelectedConnId(targetId);

          try {
            const data = await api.getSchema(targetId);
            if (!isMounted) return;
            setSchema(data);
            if (data && Array.isArray(data.tables) && data.tables.length > 0) {
              const asked = tableParam ? data.tables.find((t: any) => t.name === tableParam) : null;
              const firstRecommended = data.tables.find(
                (t: any) => t.category === "RECOMMENDED" || t.eligibility_tier === "RECOMMENDED"
              );
              const tableToPick = asked || firstRecommended || data.tables[0];
              if (asked && asked !== firstRecommended && asked.category !== "RECOMMENDED") setActiveTab("ALL");
              setSelectedTable(tableToPick);
              setUserNote(tableToPick.ai_suggestion?.user_notes || "");
            }
          } catch (schemaErr: any) {
            if (isMounted) setError(schemaErr.message);
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    };
    init();

    pageStateService.setRoute("/explorer", "Schema Explorer");

    return () => {
      isMounted = false;
    };
    // tableParam only picks the first table shown; changing it later must not reload the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connParam]);

  // ---- Orbit surface: pick connection/table from the real loaded options, note, rescan ---------
  const noteRef = useOrbitTarget<HTMLInputElement>(fieldTarget("explorer.browser", "note"));
  useOrbitSurface("explorer.browser", () => ({
    target: "explorer.connection_select",
    describe: () => ({
      connection_id: selectedConnId,
      tables: (schema?.tables || []).slice(0, 60).map((t: any) => ({ name: t.name, tier: t.category ?? t.tier, columns: t.columns?.length })),
      selected_table: selectedTable ? {
        name: selectedTable.name,
        rows_access: selectedTable.data_class ?? null,
        links_to: (selectedTable.relationships || []).map((r) => r.referenced_table),
        columns: (selectedTable.columns || []).slice(0, 40).map((c: any) => `${c.name}:${c.data_type ?? c.type}${c.is_nullable === false ? "*" : ""}`),
      } : null,
    }),
    fields: {
      connection: {
        get: () => selectedConnId,
        set: async (v) => {
          const id = Number(v);
          if (!connectionsRef.current.find((c) => c.id === id)) return `Connection ${v} is not in this workspace.`;
          await handleConnectionChange(id);
          return null;
        },
        options: () => connectionsRef.current.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name || c.database || ""})` })),
        target: () => "explorer.connection_select",
      },
      table: {
        get: () => selectedTable?.name ?? null,
        set: (v) => {
          const match = (schemaRef.current?.tables || []).find((t: any) => t.name.toLowerCase() === String(v).toLowerCase());
          if (!match) return `Table '${v}' is not in this schema.`;
          setSelectedTable(match);
          return null;
        },
        options: () => (schemaRef.current?.tables || []).map((t: any) => ({ value: t.name, label: t.name })),
        target: () => (selectedTable ? `explorer.table.${selectedTable.name}` : "explorer.connection_select"),
      },
      note: { get: () => userNote, set: (v) => { setUserNote(String(v ?? "").slice(0, 2000)); return null; } },
    },
    actions: {
      refresh: {
        enabled: () => !!selectedConnId,
        run: async () => {
          try {
            await handleRefreshSchema();
            return { success: true, message: "Schema rescanned." };
          } catch (err: any) {
            return { success: false, message: err.message || "Rescan failed." };
          }
        },
      },
      save_note: {
        enabled: () => !!selectedTable,
        run: async () => {
          await handleSaveUserNote();
          return { success: true, message: `Note saved for ${selectedTable?.name}.` };
        },
      },
    },
  }));

  // Sync userNote when selectedTable changes
  useEffect(() => {
    if (selectedTable) {
      setUserNote(selectedTable.ai_suggestion?.user_notes || "");
      setNoteError(null);
      setNoteSavedFeedback(false);
      pageStateService.setActiveEntity("table", selectedTable.name, selectedTable.name);
    }
  }, [selectedTable]);

  // Handle connection change
  const handleConnectionChange = async (newId: number) => {
    setSelectedConnId(newId);
    try {
      setLoadingSchema(true);
      setError(null);
      const data = await api.getSchema(newId);
      setSchema(data);
      if (data && Array.isArray(data.tables) && data.tables.length > 0) {
        const firstRecommended = data.tables.find(
          (t: any) => t.category === "RECOMMENDED" || t.eligibility_tier === "RECOMMENDED"
        );
        const toPick = firstRecommended || data.tables[0];
        setSelectedTable(toPick);
        setUserNote(toPick.ai_suggestion?.user_notes || "");
      } else {
        setSelectedTable(null);
      }
    } catch (err: any) {
      setError(err.message);
      setSchema(null);
      setSelectedTable(null);
    } finally {
      setLoadingSchema(false);
    }
  };

  // Refresh Schema & persist new versioned snapshot
  const handleRefreshSchema = async () => {
    if (!selectedConnId) return;
    try {
      setIsRefreshing(true);
      setError(null);
      await api.refreshSchema(selectedConnId);
      const data = await api.getSchema(selectedConnId);
      setSchema(data);
      if (data && Array.isArray(data.tables) && data.tables.length > 0) {
        // preserve currently selected table if still present
        const currentName = selectedTable?.name;
        const matched = data.tables.find((t: any) => (t.name || t.table_name) === currentName);
        const toPick = matched || data.tables[0];
        setSelectedTable(toPick);
        setUserNote(toPick.ai_suggestion?.user_notes || "");
      }
    } catch (err: any) {
      setError(`Schema refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save workspace note / annotation
  const handleSaveUserNote = async () => {
    if (!selectedConnId || !selectedTable) return;
    const tableName = selectedTable.name || (selectedTable as any).table_name;
    const problem = validateField("note", { note: userNote }, { note: [rules.maxLength(2000, "Team notes")] });
    setNoteError(problem);
    if (problem) {
      document.getElementById("schema-note")?.focus();
      return;
    }
    try {
      setIsSavingNote(true);
      await api.annotateTable(selectedConnId, tableName, {
        user_override_notes: userNote,
        is_user_verified: true,
      });
      setNoteSavedFeedback(true);
      // Update local state in schema
      if (schema?.tables) {
        setSchema({
          ...schema,
          tables: schema.tables.map((t) => {
            if ((t.name || (t as any).table_name) === tableName) {
              return {
                ...t,
                ai_suggestion: {
                  ...t.ai_suggestion,
                  user_notes: userNote,
                  is_user_verified: true,
                },
              };
            }
            return t;
          }),
        });
      }
      setTimeout(() => setNoteSavedFeedback(false), 3000);
    } catch (err: any) {
      const fields = serverFieldErrors(err);
      setNoteError(fields.user_override_notes ?? fields.user_notes ?? `Could not save the note: ${err.message}`);
    } finally {
      setIsSavingNote(false);
    }
  };

  // 4-Tier Filtering & Search
  const filteredTables = useMemo(() => {
    if (!schema?.tables) return [];

    return schema.tables.filter((t: any) => {
      const name = (t.name || t.table_name || "").toLowerCase();
      const tier = t.eligibility_tier || t.category;
      const isSensitive = t.is_sensitive || tier === "RESTRICTED";

      if (searchQuery.trim() && !name.includes(searchQuery.toLowerCase().trim())) {
        return false;
      }

      if (activeTab === "RECOMMENDED") {
        return tier === "RECOMMENDED" || (t.category === "ALLOWLISTED" && !isSensitive);
      }
      if (activeTab === "REVIEW_REQUIRED") {
        return tier === "REVIEW_REQUIRED";
      }
      if (activeTab === "RESTRICTED") {
        return isSensitive || tier === "RESTRICTED";
      }
      return true;
    });
  }, [schema, searchQuery, activeTab]);

  const counts = useMemo(() => {
    if (!schema?.tables) return { recommended: 0, review: 0, restricted: 0, all: 0 };
    let recommended = 0;
    let review = 0;
    let restricted = 0;

    schema.tables.forEach((t: any) => {
      const tier = t.eligibility_tier || t.category;
      if (t.is_sensitive || tier === "RESTRICTED") {
        restricted++;
      } else if (tier === "RECOMMENDED" || (t.category === "ALLOWLISTED" && !t.is_sensitive)) {
        recommended++;
      } else {
        review++;
      }
    });

    return {
      recommended,
      review,
      restricted,
      all: schema.tables.length,
    };
  }, [schema]);

  // Open a table from a link; show every table when the current tab hides it.
  const openTable = (name: string) => {
    const match = (schema?.tables || []).find((t) => t.name === name);
    if (!match) return;
    if (!filteredTables.some((t: any) => t.name === name)) {
      setActiveTab("ALL");
      setSearchQuery("");
    }
    setSelectedTable(match);
    document.getElementById("schema-explorer-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectedConnection = connections.find((c) => c.id === selectedConnId) as any;
  const access = selectedTable ? accessLabel(selectedTable.data_class, selectedConnection?.access_mode) : null;

  const tierTabs = [
    { id: "RECOMMENDED", label: "Recommended", icon: CheckCircle2, count: counts.recommended, tone: "text-emerald-600", chip: "bg-emerald-100 text-emerald-700" },
    { id: "REVIEW_REQUIRED", label: "Review needed", icon: AlertTriangle, count: counts.review, tone: "text-amber-500", chip: "bg-amber-100 text-amber-700" },
    { id: "RESTRICTED", label: "Restricted", icon: ShieldAlert, count: counts.restricted, tone: "text-rose-500", chip: "bg-rose-100 text-rose-700" },
    { id: "ALL", label: "All tables", icon: Layers, count: counts.all, tone: "text-slate-500", chip: "bg-slate-200 text-slate-700" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Schema explorer"
        description={<>Every table <BrandName /> found in your database, how it is classified, and what it can be used for.</>}
        actions={
          connections.length > 0 ? (
            <>
              {schema?.snapshot_version && <span className="da-chip da-chip-slate font-mono">Snapshot v{schema.snapshot_version}</span>}
              <div className="w-64" ref={connectionSelectRef}>
                <SearchableSelect
                  value={selectedConnId}
                  onChange={(val) => handleConnectionChange(Number(val))}
                  placeholder="Select database connection..."
                  searchPlaceholder="Search database connections..."
                  options={connections.map((c) => ({
                    value: c.id,
                    label: `${c.name} (${(c as any).database_name || c.database || ""})`,
                    badge: (c as any).driver || "mysql",
                  }))}
                />
              </div>
              <button
                type="button"
                onClick={handleRefreshSchema}
                disabled={isRefreshing || loadingSchema}
                title="Rescan the database and record a new schema snapshot"
                className="da-btn da-btn-secondary"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-indigo-600" : ""}`} />
                {isRefreshing ? "Rescanning…" : "Rescan"}
              </button>
            </>
          ) : undefined
        }
      />

      {schema?.schema_diff?.has_changes && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-950">The schema changed since the last snapshot</div>
            {schema.schema_diff.added_tables.length > 0 && <p>New tables: {schema.schema_diff.added_tables.join(", ")}</p>}
            {schema.schema_diff.removed_tables.length > 0 && <p>Removed tables: {schema.schema_diff.removed_tables.join(", ")}</p>}
            {schema.schema_diff.modified_tables.length > 0 && <p>Modified tables: {schema.schema_diff.modified_tables.map((m) => m.table).join(", ")}</p>}
          </div>
        </motion.div>
      )}

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{error}</div>}

      {isInitializing || loadingSchema ? (
        <Card>
          <Loading label={isInitializing ? "Opening your workspace…" : "Reading tables, columns, keys and relationships…"} />
        </Card>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No database connected"
          description="Connect a database first to explore its tables, columns and relationships."
          action={<Link to="/connections" className="da-btn da-btn-primary">Go to Connections</Link>}
        />
      ) : !schema || !schema.tables ? (
        <EmptyState icon={TableProperties} title="No schema yet" description="Rescan this connection to read its tables." />
      ) : (
        <div id="schema-explorer-anchor" className="space-y-5">
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="da-tabs" role="tablist" aria-label="Table classification">
              {tierTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={`da-tab ${activeTab === t.id ? "da-tab-active" : ""}`}
                >
                  <t.icon className={`h-3.5 w-3.5 ${t.tone}`} />
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[11px] font-bold ${t.chip}`}>{t.count}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search tables…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="da-input pl-10" />
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* Table list */}
            <div className="da-card max-h-[720px] overflow-y-auto p-2.5">
              <div className="flex items-center justify-between px-3 pb-2 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <span>Tables · {filteredTables.length}</span>
                {activeTab === "RECOMMENDED" && <span className="normal-case tracking-normal text-emerald-600">content targets</span>}
              </div>
              {filteredTables.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-slate-400">No tables match.</div>
              ) : (
                <div className="space-y-0.5">
                  {filteredTables.map((t: any) => {
                    const tableName = t.name || t.table_name;
                    const tier = t.eligibility_tier || t.category;
                    const isSensitive = t.is_sensitive || tier === "RESTRICTED";
                    const isSelected = (selectedTable?.name || (selectedTable as any)?.table_name) === tableName;
                    const badge = isSensitive
                      ? { text: "Locked", cls: "da-chip-rose" }
                      : tier === "REVIEW_REQUIRED"
                        ? { text: "Review", cls: "da-chip-amber" }
                        : { text: "Ready", cls: "da-chip-emerald" };
                    return (
                      <button
                        key={tableName}
                        type="button"
                        ref={(el: HTMLButtonElement | null) =>
                          el ? orbitTargets.register(`explorer.table.${tableName}`, el) : orbitTargets.unregister(`explorer.table.${tableName}`)
                        }
                        onClick={() => setSelectedTable(t)}
                        className={`group relative flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] transition-all ${
                          isSelected ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {isSelected && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-500 to-violet-500" />}
                        <span className="flex min-w-0 items-start gap-2">
                          <TableProperties className={`mt-0.5 h-4 w-4 shrink-0 ${isSelected ? "text-indigo-500" : "text-slate-400"}`} />
                          <span className="min-w-0">
                            <span className="block truncate font-mono">{tableName}</span>
                            <span className="block truncate text-[11px] font-normal text-slate-400">
                              {[formatRows(t.approx_rows), `${(t.columns || []).length} columns`].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </span>
                        <span className={`da-chip ${badge.cls} shrink-0 px-2 text-[10.5px]`}>{badge.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail */}
            {selectedTable ? (
              <motion.div
                key={selectedTable.name || (selectedTable as any).table_name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="da-card min-w-0 space-y-6 p-6"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate font-mono text-[22px] font-bold tracking-[-0.02em] text-slate-950">
                        {selectedTable.name || (selectedTable as any).table_name}
                      </h3>
                      <span className={`da-chip ${
                        selectedTable.is_sensitive || selectedTable.category === "RESTRICTED"
                          ? "da-chip-rose"
                          : selectedTable.category === "RECOMMENDED" ? "da-chip-emerald" : "da-chip-amber"
                      }`}>
                        {humanStatus(selectedTable.category || "ALLOWLISTED")}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!selectedTable.is_sensitive && selectedTable.category !== "RESTRICTED" && (selectedTable.data_class ?? "writable") === "writable" && (
                      <>
                        <Link
                          to={`/automations/new?connectionId=${selectedConnId}&table=${encodeURIComponent(selectedTable.name)}`}
                          className="da-btn da-btn-primary"
                        >
                          <Workflow className="h-4 w-4" /> Create automation
                        </Link>
                        <Link to={`/manual-schedule?connectionId=${selectedConnId}&table=${encodeURIComponent(selectedTable.name)}`} className="da-btn da-btn-secondary">
                          <FileEdit className="h-4 w-4 text-slate-500" /> Write manually
                        </Link>
                      </>
                    )}
                    {config.features?.data_explorer && selectedTable.data_class !== "blocked" && (
                      <Link to={`/data?connection=${selectedConnId}&table=${encodeURIComponent(selectedTable.name)}`} className="da-btn da-btn-secondary">
                        <Table2 className="h-4 w-4 text-slate-500" /> Browse rows
                      </Link>
                    )}
                  </div>
                </div>
                <div className="-mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
                    {formatRows(selectedTable.approx_rows) && (
                      <span className="inline-flex items-center gap-1.5" title="An estimate from the database's own statistics">
                        <Rows3 className="h-3.5 w-3.5" /> {formatRows(selectedTable.approx_rows)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5"><Columns3 className="h-3.5 w-3.5" /> {(selectedTable.columns || []).length} columns</span>
                    {access && (
                      <span className={`da-chip ${access.tone} px-2 text-[11px]`} title={access.help}>{access.text}</span>
                    )}
                  </div>
                  {selectedTable.restriction_reason ? (
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-rose-600">
                      <ShieldAlert className="h-4 w-4 shrink-0" /> {selectedTable.restriction_reason}
                    </p>
                  ) : selectedTable.data_class === "read_only" ? (
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-700">
                      <ShieldAlert className="h-4 w-4 shrink-0" /> View only on this connection: automations cannot write here.
                    </p>
                  ) : selectedTable.category === "RECOMMENDED" ? (
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> A good fit for automated content and scheduled writes
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-amber-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> Can be automated, but it is not a typical content table: check its columns first
                    </p>
                  )}
                </div>

                {selectedConnId && selectedTable.data_class && selectedTable.data_class !== "blocked" && selectedTable.data_class_default && (
                  <TableAccessControl
                    key={`${selectedConnId}-${selectedTable.name}`}
                    connectionId={selectedConnId}
                    table={selectedTable.name}
                    dataClass={selectedTable.data_class}
                    defaultClass={selectedTable.data_class_default}
                    connectionMode={selectedConnection?.access_mode}
                    onChanged={(dataClass) => {
                      const name = selectedTable.name;
                      setSchema((cur) => cur ? { ...cur, tables: cur.tables.map((t) => (t.name === name ? { ...t, data_class: dataClass } : t)) } : cur);
                      setSelectedTable((cur) => (cur && cur.name === name ? { ...cur, data_class: dataClass } : cur));
                    }}
                  />
                )}

                {/* AI classification */}
                <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-indigo-600 shadow-xs"><Cpu className="h-4 w-4" /></span>
                      <span className="text-[14px] font-bold text-slate-900">What this table is for</span>
                      {selectedTable.ai_suggestion?.concept && <span className="da-chip da-chip-indigo">{selectedTable.ai_suggestion.concept}</span>}
                    </div>
                    {selectedTable.recommendation_score !== undefined && (
                      <div className="flex items-center gap-2 text-[12px] text-slate-500">
                        Confidence
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                          <span className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${Math.max(0, Math.min(100, Number(selectedTable.recommendation_score)))}%` }} />
                        </span>
                        <span className="font-semibold tabular-nums text-slate-700">{selectedTable.recommendation_score}%</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-slate-700">
                    {selectedTable.ai_suggestion?.purpose || "Primary data entity for storing structured attributes."}
                  </p>
                  {selectedTable.evidence && selectedTable.evidence.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedTable.evidence.map((ev, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-600">
                          <Check className="h-3 w-3 text-emerald-500" /> {ev}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 border-t border-indigo-100/80 pt-4">
                    <label className="da-label flex items-center justify-between" htmlFor="schema-note">
                      <span>Team notes</span>
                      {noteSavedFeedback && <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}
                    </label>
                    <div className="flex gap-2">
                      <input id="schema-note" type="text" placeholder="e.g. Marketing blog articles, reviewed by the editorial team"
                        ref={noteRef} value={userNote} onChange={(e) => { setUserNote(e.target.value); setNoteError(null); }}
                        className={`da-input flex-1${invalid(noteError)}`} {...ariaFor("schema-note", noteError)} />
                      <button type="button" onClick={handleSaveUserNote} disabled={isSavingNote} className="da-btn da-btn-primary shrink-0">
                        <Bookmark className="h-3.5 w-3.5" /> {isSavingNote ? "Saving…" : "Save note"}
                      </button>
                    </div>
                    <FieldError id="schema-note" message={noteError} />
                  </div>
                </div>

                <TableLinks table={selectedTable} all={schema.tables} onOpen={openTable} />

                <ColumnsTable table={selectedTable} onOpenTable={openTable} />
              </motion.div>
            ) : (
              <EmptyState icon={TableProperties} title="Pick a table" description="Choose a table on the left to see its columns, keys and relationships." />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
