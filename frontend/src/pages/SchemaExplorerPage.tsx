import React, { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  TableProperties,
  Database,
  ShieldCheck,
  ShieldAlert,
  Key,
  Link as LinkIcon,
  Workflow,
  Cpu,
  ArrowRight,
  Search,
  CheckCircle2,
  FileEdit,
  ExternalLink,
  Layers,
  Info,
  RefreshCw,
  Bookmark,
  Check,
  AlertTriangle
} from "lucide-react";
import { api } from "../services/api";
import { ConnectionProfile, SchemaResponse, SchemaTable } from "../types";
import { StatusPill } from "../components/common/StatusPill";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { orbitTargets } from "../services/orbitTargets";
import { fieldTarget } from "../services/orbitSurfaces";
import { pageStateService } from "../services/pageStateService";

export const SchemaExplorerPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const connParam = searchParams.get("connectionId");

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
              const firstRecommended = data.tables.find(
                (t: any) => t.category === "RECOMMENDED" || t.eligibility_tier === "RECOMMENDED"
              );
              const tableToPick = firstRecommended || data.tables[0];
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
      setError(`Failed to save annotation: ${err.message}`);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Schema Introspection Engine
            </span>
            <span className="text-xs text-slate-500">• 4-Tier Policy & Semantic Discovery</span>
            {schema?.snapshot_version && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                Snapshot v{schema.snapshot_version}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Database Schema Explorer</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Discover real tables, classify automation safety tiers, review AI semantics, and verify foreign key graphs.
          </p>
        </div>

        {connections.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium shrink-0">Target DB:</span>
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
              onClick={handleRefreshSchema}
              disabled={isRefreshing || loadingSchema}
              title="Rescan database metadata and record new schema snapshot"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-indigo-600" : ""}`} />
              <span>{isRefreshing ? "Rescanning..." : "Refresh"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Schema Drift Alert Banner if changes detected */}
      {schema?.schema_diff?.has_changes && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1.5 shadow-2xs"
        >
          <div className="flex items-center gap-2 font-bold text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Schema Drift Detected Between Snapshots</span>
          </div>
          <div className="pl-6 space-y-1 text-amber-800">
            {schema.schema_diff.added_tables.length > 0 && (
              <p>• New tables discovered: {schema.schema_diff.added_tables.join(", ")}</p>
            )}
            {schema.schema_diff.removed_tables.length > 0 && (
              <p>• Tables removed: {schema.schema_diff.removed_tables.join(", ")}</p>
            )}
            {schema.schema_diff.modified_tables.length > 0 && (
              <p>
                • Modified tables:{" "}
                {schema.schema_diff.modified_tables.map((m) => m.table).join(", ")}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
          {error}
        </div>
      )}

      {isInitializing || loadingSchema ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-3">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">
            {isInitializing ? "Connecting to Target Workspace..." : "Introspecting Target MySQL Database..."}
          </h3>
          <p className="text-slate-500 text-xs max-w-sm mx-auto">
            Reading tables, data types, constraints, and relational foreign keys from information_schema
          </p>
        </div>
      ) : connections.length === 0 ? (
        <div className="py-16 text-center text-slate-500 text-xs bg-white rounded-2xl border border-dashed border-slate-300 p-8 shadow-xs">
          <Database className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 mb-1">No database connected</h3>
          <p className="max-w-md mx-auto mb-4 text-slate-500">
            Connect a MySQL database first to explore its schema tables, columns, and relationships.
          </p>
          <Link
            to="/connections"
            className="btn-primary-gradient px-4 py-2 text-white rounded-lg text-xs font-semibold inline-block shadow-sm"
          >
            Go to Connections
          </Link>
        </div>
      ) : !schema || !schema.tables ? (
        <div className="py-16 text-center text-slate-500 text-xs bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
          No schema metadata available for this connection.
        </div>
      ) : (
        <div id="schema-explorer-anchor" className="space-y-4">
          {/* 4-Tier Filter Bar & Animated Tabs */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* 4 Tabs */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setActiveTab("RECOMMENDED")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === "RECOMMENDED"
                    ? "bg-white text-emerald-800 font-bold shadow-2xs border border-emerald-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Recommended</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {counts.recommended}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("REVIEW_REQUIRED")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === "REVIEW_REQUIRED"
                    ? "bg-white text-amber-800 font-bold shadow-2xs border border-amber-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>Review Needed</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
                  {counts.review}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("RESTRICTED")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === "RESTRICTED"
                    ? "bg-white text-rose-800 font-bold shadow-2xs border border-rose-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                <span>Restricted</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-50 text-rose-700 border border-rose-200">
                  {counts.restricted}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("ALL")}
                className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 ${
                  activeTab === "ALL"
                    ? "bg-white text-slate-900 font-bold shadow-2xs border border-slate-300"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>All Tables</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
                  {counts.all}
                </span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Master-Detail Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* Table List (Left Col) */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-3 space-y-1.5 shadow-xs h-fit max-h-[700px] overflow-y-auto">
              <div className="px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Tables ({filteredTables.length})</span>
                {activeTab === "RECOMMENDED" && (
                  <span className="text-[10px] text-emerald-600 font-semibold">Content Target</span>
                )}
              </div>

              {filteredTables.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No tables match filter
                </div>
              ) : (
                filteredTables.map((t: any) => {
                  const tableName = t.name || t.table_name;
                  const tier = t.eligibility_tier || t.category;
                  const isSensitive = t.is_sensitive || tier === "RESTRICTED";
                  const isSelected = (selectedTable?.name || (selectedTable as any)?.table_name) === tableName;

                  let badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
                  let badgeText = "Recommended";
                  if (isSensitive || tier === "RESTRICTED") {
                    badgeColor = "bg-rose-50 text-rose-700 border-rose-200";
                    badgeText = "Locked";
                  } else if (tier === "REVIEW_REQUIRED") {
                    badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
                    badgeText = "Review";
                  }

                  return (
                    <motion.button
                      key={tableName}
                      ref={(el: HTMLButtonElement | null) =>
                        el ? orbitTargets.register(`explorer.table.${tableName}`, el) : orbitTargets.unregister(`explorer.table.${tableName}`)
                      }
                      whileHover={{ x: 2 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => setSelectedTable(t)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-700 font-semibold ring-1 ring-indigo-200 shadow-2xs"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <TableProperties className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span className="truncate font-mono">{tableName}</span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 border ${badgeColor}`}
                      >
                        {badgeText}
                      </span>
                    </motion.button>
                  );
                })
              )}
            </div>

            {/* Table Details (Right Col) */}
            {selectedTable ? (
              <motion.div
                key={selectedTable.name || (selectedTable as any).table_name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="lg:col-span-3 space-y-6"
              >
                {/* Table Header Card */}
                <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-bold text-slate-900 font-mono">
                          {selectedTable.name || (selectedTable as any).table_name}
                        </h3>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider ${
                            selectedTable.is_sensitive || selectedTable.category === "RESTRICTED"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : selectedTable.category === "RECOMMENDED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {selectedTable.category || "ALLOWLISTED"}
                        </span>
                      </div>

                      {selectedTable.restriction_reason ? (
                        <p className="text-xs text-rose-600 mt-1.5 flex items-center gap-1.5 font-medium">
                          <ShieldAlert className="w-4 h-4 shrink-0" />
                          <span>{selectedTable.restriction_reason}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-emerald-700 mt-1.5 flex items-center gap-1.5 font-medium">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                          <span>Eligible for Automated Content Generation & Scheduled Writes</span>
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    {(!selectedTable.is_sensitive && selectedTable.category !== "RESTRICTED") && (
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/automations/new?connectionId=${selectedConnId}&table=${selectedTable.name || (selectedTable as any).table_name}`}
                          className="btn-primary-gradient inline-flex items-center gap-1.5 px-3.5 py-2 text-white rounded-lg text-xs font-semibold transition shadow-xs"
                        >
                          <Workflow className="w-3.5 h-3.5" />
                          <span>Create Automation</span>
                        </Link>
                        <Link
                          to={`/manual-schedule`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition shadow-2xs"
                        >
                          <FileEdit className="w-3.5 h-3.5 text-slate-500" />
                          <span>Manual Schedule</span>
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* AI Semantic Purpose & Evidence Card */}
                  <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-bold text-slate-900">
                          AI Semantic Classification & Purpose
                        </span>
                        {selectedTable.ai_suggestion?.concept && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-medium">
                            {selectedTable.ai_suggestion.concept}
                          </span>
                        )}
                      </div>
                      {selectedTable.recommendation_score !== undefined && (
                        <span className="text-xs font-semibold font-mono text-slate-600">
                          Confidence: {selectedTable.recommendation_score}%
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed">
                      {selectedTable.ai_suggestion?.purpose ||
                        "Primary data entity for storing structured attributes."}
                    </p>

                    {/* Evidence tags */}
                    {selectedTable.evidence && selectedTable.evidence.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {selectedTable.evidence.map((ev, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-md font-medium"
                          >
                            ✓ {ev}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* User Workspace Notes Form */}
                    <div className="pt-2 border-t border-slate-200/80 space-y-2">
                      <label className="text-[11px] font-semibold text-slate-700 flex items-center justify-between">
                        <span>Workspace Team Notes & Domain Overrides:</span>
                        {noteSavedFeedback && (
                          <span className="text-emerald-600 flex items-center gap-1 font-bold">
                            <Check className="w-3 h-3" /> Saved to Workspace Knowledge
                          </span>
                        )}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="e.g. Primary marketing blog articles table, reviewed by Editorial Team"
                          ref={noteRef}
                          value={userNote}
                          onChange={(e) => setUserNote(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                        <button
                          type="button"
                          onClick={handleSaveUserNote}
                          disabled={isSavingNote}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition shrink-0 flex items-center gap-1"
                        >
                          <Bookmark className="w-3 h-3" />
                          <span>{isSavingNote ? "Saving..." : "Save Note"}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Columns Table */}
                  <div className="overflow-x-auto border border-slate-200/90 rounded-lg">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-50/80 text-slate-600 font-sans border-b border-slate-200 text-xs">
                        <tr>
                          <th className="py-2.5 px-3">Column</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Nullable</th>
                          <th className="py-2.5 px-3">Key</th>
                          <th className="py-2.5 px-3">Default / Enums</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {selectedTable.columns.map((col) => (
                          <tr key={col.name} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-1.5">
                              {col.name}
                              {col.is_primary_key && (
                                <span title="Primary Key">
                                  <Key className="w-3 h-3 text-amber-500" />
                                </span>
                              )}
                              {col.is_foreign_key && (
                                <span title="Foreign Key">
                                  <LinkIcon className="w-3 h-3 text-indigo-500" />
                                </span>
                              )}
                            </td>

                            <td className="py-2.5 px-3 text-indigo-600 font-medium">{col.data_type}</td>
                            <td className="py-2.5 px-3">
                              {col.nullable ? (
                                <span className="text-slate-400">NULL</span>
                              ) : (
                                <span className="text-amber-700 font-medium">NOT NULL</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {col.is_primary_key && <span className="text-amber-700 font-bold">PK</span>}
                              {col.is_foreign_key && <span className="text-indigo-600 font-bold">FK</span>}
                              {col.is_unique && !col.is_primary_key && <span className="text-violet-600 font-bold">UNIQUE</span>}
                              {!col.is_primary_key && !col.is_foreign_key && !col.is_unique && "-"}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {col.enum_values && col.enum_values.length > 0 ? (
                                <span className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                  [{col.enum_values.join(", ")}]
                                </span>
                              ) : col.default_value !== undefined && col.default_value !== null ? (
                                String(col.default_value)
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Discovered Foreign Key Relationships */}
                  {selectedTable.relationships && selectedTable.relationships.length > 0 && (
                    <div className="pt-2">
                      <h4 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                        <LinkIcon className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Discovered Foreign Key Graph ({selectedTable.relationships.length})</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {selectedTable.relationships.map((rel, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono space-y-0.5"
                          >
                            <span className="text-slate-500 text-[11px] font-sans block">Reference:</span>
                            <div className="flex items-center gap-1 text-slate-800">
                              <span className="font-bold text-indigo-700">
                                {rel.foreign_key || rel.constrained_column}
                              </span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span className="font-bold text-slate-900">{rel.referenced_table}</span>
                              <span className="text-slate-500">({rel.referenced_column})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="lg:col-span-3 py-16 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200 p-8 shadow-xs">
                Select a table on the left to inspect its schema and constraints
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
