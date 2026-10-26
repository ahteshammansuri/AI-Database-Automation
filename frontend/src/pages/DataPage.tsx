import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertCircle, ArrowDown, ArrowUp, CalendarClock, ChevronLeft, ChevronRight, Database, Eye, EyeOff, History, Loader2, Lock, Pencil,
  Plus, RefreshCw, RotateCcw, Search, ShieldAlert, Sparkles, Table2, Trash2, X,
} from "lucide-react";
import { api } from "../services/api";
import { useToast } from "../context/ToastContext";
import { usePlatform } from "../context/PlatformContext";
import { EmptyState, FormAlert, ModalShell, PageHeader } from "../components/ui/kit";
import { DataCell } from "../components/data/DataCell";
import { RowForm, fieldId } from "../components/data/RowForm";
import { ChangeConfirmModal } from "../components/data/ChangeConfirmModal";
import { SampleRowsModal } from "../components/data/SampleRowsModal";
import { AutopilotPanel } from "../components/data/AutopilotPanel";
import type { ChangePreview, DataTableInfo, RowsResponse } from "../components/data/types";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { isEditable } from "../components/data/types";

type Tab = "rows" | "autopilot" | "history";

/**
 * Data Explorer and Data Manager: browse the rows of any table of the customer's own databases and change them
 * safely. Reads are read-only and limited; every change is checked, previewed, confirmed and can be undone.
 */
export const DataPage: React.FC = () => {
  const { toast } = useToast();
  const { config } = usePlatform();
  const features = config.features;
  const maxSample = config.data_explorer?.max_sample_rows ?? 25;
  const [params, setParams] = useSearchParams();

  const [connections, setConnections] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(params.get("connection") ? Number(params.get("connection")) : null);
  const [tables, setTables] = useState<DataTableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const table = params.get("table") || "";
  const [tab, setTab] = useState<Tab>("rows");

  const [data, setData] = useState<RowsResponse | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sort, setSort] = useState<{ col: string | null; dir: "asc" | "desc" }>({ col: null, dir: "desc" });
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [reveal, setReveal] = useState(false);

  const [openRow, setOpenRow] = useState<Record<string, any> | null>(null);
  const [editing, setEditing] = useState<"add" | "edit" | null>(null);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formAlert, setFormAlert] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState<ChangePreview | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [lastChange, setLastChange] = useState<{ id: number; text: string; canUndo: boolean } | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const selectTable = (name: string) => {
    const next = new URLSearchParams(params);
    if (connectionId) next.set("connection", String(connectionId));
    next.set("table", name);
    setParams(next, { replace: true });
    setPage(1);
    setSearch("");
    setSearchInput("");
    setReveal(false);
    setSort({ col: null, dir: "desc" });
    setTab("rows");
    setLastChange(null);
  };

  // Connections
  useEffect(() => {
    api.listConnections().then((list) => {
      const conns = Array.isArray(list) ? list : [];
      setConnections(conns);
      setConnectionId((cur) => (cur && conns.some((c) => c.id === cur) ? cur : conns[0]?.id ?? null));
    }).catch((e) => setTablesError(e.message));
  }, []);

  // Tables of the chosen connection
  const loadTables = useCallback(async (refresh = false) => {
    if (!connectionId) return;
    setTablesLoading(true);
    setTablesError(null);
    try {
      const res = await api.dataTables(connectionId, refresh);
      setTables(res.tables ?? []);
      if (!params.get("table")) {
        const first = (res.tables ?? []).find((t: DataTableInfo) => !t.blocked);
        if (first) selectTable(first.name);
      }
    } catch (e: any) {
      setTablesError(e.message);
      setTables([]);
    } finally {
      setTablesLoading(false);
    }
  }, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTables(); }, [loadTables]);

  // Rows
  const loadRows = useCallback(async () => {
    if (!connectionId || !table) return;
    setRowsLoading(true);
    setRowsError(null);
    try {
      const res: RowsResponse = await api.dataRows(connectionId, table, { page, per_page: perPage, sort: sort.col, dir: sort.col ? sort.dir : undefined, search, reveal });
      setData(res);
    } catch (e: any) {
      setRowsError(e.message);
      setData(null);
    } finally {
      setRowsLoading(false);
    }
  }, [connectionId, table, page, perPage, sort, search, reveal]);
  useEffect(() => { if (tab === "rows") loadRows(); }, [loadRows, tab]);

  const loadHistory = useCallback(async () => {
    if (!connectionId || !table) return;
    try {
      setHistory((await api.dataHistory(connectionId, table)).changes ?? []);
    } catch {
      setHistory([]);
    }
  }, [connectionId, table]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const info = useMemo(() => tables.find((t) => t.name === table), [tables, table]);
  const perms = data?.permissions ?? info?.permissions;
  const pk = data?.primary_key?.[0] ?? null;
  const hasPersonal = !!data?.columns.some((c) => c.personal);
  const totalPages = data?.total ? Math.max(1, Math.ceil(data.total / data.per_page)) : null;

  const startAdd = () => {
    setFormValues({});
    setFormErrors({});
    setFormAlert(null);
    setEditing("add");
  };
  const startEdit = () => {
    if (!openRow) return;
    setFormValues({ ...openRow });
    setFormErrors({});
    setFormAlert(null);
    setEditing("edit");
  };

  // Orbit: choose the connection and table, search, and open the add form or AI sample rows. Every change still ends
  // in the page's own preview, confirmed by the user; Orbit has no action that writes rows here.
  useOrbitSurface("data.page", () => ({
    describe: () => ({
      connection_id: connectionId,
      table: table || null,
      tables: tables.slice(0, 60).map((t) => ({ name: t.name, rows: t.rows_estimate, locked: t.blocked, can_add: !!t.permissions?.insert })),
      columns: (data?.columns ?? []).slice(0, 40).map((c) => c.name),
      rows_shown: data?.rows?.length ?? 0,
      total_rows: data?.total ?? null,
      can_add: !!perms?.insert, can_edit: !!perms?.update, can_delete: !!perms?.delete,
      why_not: perms?.reason ?? undefined,
    }),
    fields: {
      connection: {
        get: () => connectionId,
        set: (v) => {
          const id = Number(v);
          if (!connections.some((c: any) => c.id === id)) return `Connection ${v} is not in this workspace.`;
          setConnectionId(id);
          setParams(new URLSearchParams({ connection: String(id) }), { replace: true });
          setData(null);
          return null;
        },
        options: () => connections.map((c: any) => ({ value: c.id, label: `${c.name} (${c.database_name ?? ""})` })),
      },
      table: {
        get: () => table || null,
        set: (v) => {
          const t = tables.find((x) => x.name === String(v));
          if (!t) return `Table '${v}' is not in this database.`;
          if (t.blocked) return `${t.name} holds credentials or sessions and is never shown.`;
          selectTable(t.name);
          return null;
        },
        options: () => tables.filter((t) => !t.blocked).map((t) => ({ value: t.name, label: t.name })),
      },
      search: { get: () => searchInput, set: (v) => { setSearchInput(String(v ?? "").slice(0, 200)); return null; } },
    },
    actions: {
      refresh: { run: async () => { await loadRows(); return { success: true, message: "Rows reloaded." }; } },
      add_row: {
        enabled: () => !!perms?.insert,
        run: () => { startAdd(); return { success: true, message: "The add-row form is open. The user checks the preview and confirms the change on the page." }; },
      },
      sample_rows: {
        enabled: () => !!perms?.insert && !!features.sample_data,
        run: () => { setSampleOpen(true); return { success: true, message: "The AI sample rows window is open. The user chooses how many and confirms the rows before anything is added." }; },
      },
    },
  }));

  const showRowErrors = (e: any) => {
    const rowErrors = e.data?.row_errors?.[0] ?? e.data?.row_errors?.["0"];
    if (rowErrors) {
      setFormErrors(rowErrors);
      setFormAlert(null);
      setTimeout(() => document.getElementById(fieldId(Object.keys(rowErrors)[0]))?.focus(), 50);
    } else {
      setFormAlert(e.message || "The change could not be checked.");
    }
  };

  const submitForm = async () => {
    if (!connectionId || !data) return;
    setPreviewing(true);
    setFormErrors({});
    setFormAlert(null);
    try {
      if (editing === "add") {
        const row: Record<string, any> = {};
        for (const c of data.columns) {
          if (!isEditable(c, true)) continue;
          const v = formValues[c.name];
          if (v === undefined || (v === "" && !["string", "text"].includes(c.family))) continue;
          row[c.name] = v;
        }
        setPending(await api.dataPreviewInsert(connectionId, table, [row]));
      } else if (openRow && pk) {
        const changed: Record<string, any> = {};
        for (const c of data.columns) {
          if (!isEditable(c, false) || (c.personal && !data.revealed)) continue;
          const before = openRow[c.name];
          const after = formValues[c.name];
          if (String(before ?? "") !== String(after ?? "")) changed[c.name] = after === "" && c.nullable && !["string", "text"].includes(c.family) ? null : after;
        }
        if (!Object.keys(changed).length) {
          setFormAlert("Nothing changed yet.");
          return;
        }
        setPending(await api.dataPreviewUpdate(connectionId, table, openRow[pk], changed));
      }
    } catch (e: any) {
      showRowErrors(e);
    } finally {
      setPreviewing(false);
    }
  };

  const askDelete = async () => {
    if (!connectionId || !openRow || !pk) return;
    try {
      setPending(await api.dataPreviewDelete(connectionId, table, openRow[pk]));
    } catch (e: any) {
      toast.error("This row cannot be deleted", e.message);
    }
  };

  const changeDone = (res: any, p: ChangePreview) => {
    setPending(null);
    setEditing(null);
    setOpenRow(null);
    setSampleOpen(false);
    const verb = p.action === "insert" ? "Added" : p.action === "update" ? "Updated" : "Deleted";
    setLastChange({ id: p.change_request_id, text: `${verb} ${res.affected_count ?? p.affected_count} row${(res.affected_count ?? p.affected_count) === 1 ? "" : "s"} in ${table}.`, canUndo: res.can_undo !== false });
    toast.success(res.message || "Done");
    loadRows();
  };

  const undo = async (changeId: number) => {
    try {
      const res = await api.dataUndo(changeId);
      toast.success("Undone", res.message);
      setLastChange(null);
      loadRows();
      if (tab === "history") loadHistory();
    } catch (e: any) {
      toast.error("Could not undo", e.message);
    }
  };

  const filteredTables = tables.filter((t) => t.name.toLowerCase().includes(tableFilter.toLowerCase()));
  const sortBy = (col: string) => {
    setSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  };

  if (!features.data_explorer) {
    return <EmptyState icon={Lock} title="The Data Explorer is turned off" description="Your administrator has turned this tool off." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Data"
        description="Browse the rows of your tables and change them safely. Every change is checked against the table, shown to you first, and can be undone."
        actions={
          connections.length > 0 && (
            <select value={connectionId ?? ""} onChange={(e) => { setConnectionId(Number(e.target.value)); setParams(new URLSearchParams({ connection: e.target.value }), { replace: true }); setData(null); }}
              className="da-input w-auto cursor-pointer py-2 text-[13px] font-semibold" aria-label="Connection">
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.database_name || c.database})</option>)}
            </select>
          )
        }
      />

      {connections.length === 0 && !tablesError ? (
        <EmptyState icon={Database} title="Connect a database first" description="The Data Explorer shows the tables of your connected databases."
          action={<Link to="/connections" className="da-btn da-btn-primary"><Database className="h-4 w-4" /> Go to Connections</Link>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Tables */}
          <aside className="da-card h-fit p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} placeholder="Find a table" aria-label="Find a table"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-2 text-[13px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <button type="button" onClick={() => loadTables(true)} className="da-icon-btn" title="Read the tables again" aria-label="Read the tables again"><RefreshCw className={`h-4 w-4 ${tablesLoading ? "animate-spin" : ""}`} /></button>
            </div>
            {tablesError && <p className="rounded-xl bg-rose-50 p-2.5 text-[12px] text-rose-700">{tablesError}</p>}
            <nav aria-label="Tables" className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {filteredTables.map((t) => (
                <button key={t.name} type="button" disabled={t.blocked} onClick={() => selectTable(t.name)} title={t.blocked ? t.permissions.reason ?? "" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] transition ${t.name === table ? "bg-slate-950 text-white" : t.blocked ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:bg-slate-100"}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {t.blocked ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Table2 className={`h-3.5 w-3.5 shrink-0 ${t.name === table ? "text-indigo-300" : "text-slate-400"}`} />}
                    <span className="truncate font-medium">{t.name}</span>
                  </span>
                  {!t.blocked && t.rows_estimate !== null && <span className={`shrink-0 text-[11px] tabular-nums ${t.name === table ? "text-slate-300" : "text-slate-400"}`}>{t.rows_estimate.toLocaleString()}</span>}
                </button>
              ))}
              {!tablesLoading && filteredTables.length === 0 && <p className="px-2 py-3 text-[12.5px] text-slate-500">No tables match.</p>}
            </nav>
          </aside>

          {/* Table */}
          <section className="min-w-0 space-y-4">
            {!table ? (
              <EmptyState icon={Table2} title="Choose a table" description="Pick a table on the left to see its rows." />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
                    {([["rows", "Rows", Table2], ["autopilot", "Autopilot", CalendarClock], ["history", "Changes", History]] as const).map(([k, l, I]) => (
                      (k !== "autopilot" || features.data_autopilot) && (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition ${tab === k ? "bg-white text-slate-950 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}>
                          <I className="h-3.5 w-3.5" /> {l}
                        </button>
                      )
                    ))}
                  </div>
                  {tab === "rows" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {perms?.insert && features.sample_data && <button type="button" onClick={() => setSampleOpen(true)} className="da-btn da-btn-accent da-btn-sm"><Sparkles className="h-3.5 w-3.5" /> AI sample rows</button>}
                      {perms?.insert && <button type="button" onClick={startAdd} className="da-btn da-btn-primary da-btn-sm"><Plus className="h-3.5 w-3.5" /> Add row</button>}
                    </div>
                  )}
                </div>

                {lastChange && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
                    <span>{lastChange.text}</span>
                    <span className="flex items-center gap-1">
                      {lastChange.canUndo && <button type="button" onClick={() => undo(lastChange.id)} className="da-btn da-btn-sm border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100"><RotateCcw className="h-3.5 w-3.5" /> Undo</button>}
                      <button type="button" onClick={() => setLastChange(null)} className="da-icon-btn" aria-label="Dismiss"><X className="h-4 w-4" /></button>
                    </span>
                  </motion.div>
                )}

                {tab === "rows" && (
                  <div className="da-card overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
                      <div className="relative min-w-[12rem] flex-1">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={`Search ${table}`} aria-label={`Search ${table}`}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-[13px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                      </div>
                      {hasPersonal && (
                        <button type="button" onClick={() => { setReveal((r) => !r); setPage(1); }} className="da-btn da-btn-secondary da-btn-sm" title="Personal data is masked. Revealing it is recorded in your audit log.">
                          {reveal ? <><EyeOff className="h-3.5 w-3.5" /> Mask personal data</> : <><Eye className="h-3.5 w-3.5" /> Reveal personal data</>}
                        </button>
                      )}
                      <button type="button" onClick={loadRows} className="da-icon-btn" aria-label="Refresh rows" title="Refresh"><RefreshCw className={`h-4 w-4 ${rowsLoading ? "animate-spin" : ""}`} /></button>
                    </div>
                    {perms && !perms.insert && !perms.update && perms.reason && (
                      <p className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px] text-slate-500"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> View only: {perms.reason}</p>
                    )}
                    {rowsError ? (
                      <p className="m-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {rowsError}</p>
                    ) : !data && rowsLoading ? (
                      <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}</div>
                    ) : data && data.rows.length === 0 ? (
                      <EmptyState icon={Table2} title={search ? "No rows match your search" : "This table is empty"} description={perms?.insert ? "Add a row, or let the AI create sample rows." : undefined} className="py-12" />
                    ) : data ? (
                      <div className={`overflow-x-auto ${rowsLoading ? "opacity-60" : ""}`}>
                        <table className="w-full text-left text-[13px]">
                          <thead className="sticky top-0 bg-slate-50 text-[11.5px] text-slate-500">
                            <tr>
                              {data.columns.map((c) => (
                                <th key={c.name} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                                  <button type="button" onClick={() => sortBy(c.name)} className="inline-flex items-center gap-1 hover:text-slate-900" aria-label={`Sort by ${c.name}`}>
                                    {c.is_pk && <span className="text-amber-500">#</span>}{c.name}{c.personal && !data.revealed && <EyeOff className="h-3 w-3 text-slate-400" />}
                                    {data.sort === c.name && (data.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                                  </button>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.rows.map((r, i) => (
                              <tr key={pk ? String(r[pk]) : i} onClick={() => setOpenRow(r)} className="cursor-pointer hover:bg-indigo-50/40">
                                {data.columns.map((c) => (
                                  <td key={c.name} className="px-3 py-2 align-top text-slate-700">
                                    <DataCell col={c} value={r[c.name]} label={c.link && r[c.name] !== null ? data.labels?.[c.name]?.[String(r[c.name])] : undefined} />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {data && data.rows.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500">
                        <span>
                          {data.total !== null ? `${((data.page - 1) * data.per_page + 1).toLocaleString()}–${Math.min(data.page * data.per_page, data.total).toLocaleString()} of ${data.total.toLocaleString()}` : `Page ${data.page}`}
                          {data.hidden_columns.length > 0 && ` · ${data.hidden_columns.length} protected column${data.hidden_columns.length === 1 ? "" : "s"} hidden`}
                        </span>
                        <span className="flex items-center gap-2">
                          <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12.5px]" aria-label="Rows per page">
                            {[10, 25, 50, 100].filter((n) => n <= (config.data_explorer?.max_page_size ?? 100)).map((n) => <option key={n} value={n}>{n} per page</option>)}
                          </select>
                          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="da-icon-btn" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                          <span className="tabular-nums">{page}{totalPages ? ` / ${totalPages}` : ""}</span>
                          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={totalPages !== null ? page >= totalPages : data.rows.length < data.per_page} className="da-icon-btn" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {tab === "autopilot" && connectionId && (
                  <div className="da-card p-5">
                    <AutopilotPanel connectionId={connectionId} table={table} maxRows={maxSample} canInsert={!!perms?.insert && features.data_manager} onUndo={undo} />
                  </div>
                )}

                {tab === "history" && (
                  <div className="da-card p-5">
                    {history.length === 0 ? (
                      <p className="text-center text-[13px] text-slate-500">No changes to this table yet.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {history.map((h) => (
                          <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                            <span>
                              <span className="font-semibold capitalize text-slate-900">{h.action === "insert" ? "Added" : h.action === "update" ? "Updated" : "Deleted"} {h.rows} row{h.rows === 1 ? "" : "s"}</span>
                              <span className="text-slate-500"> · {h.source === "sample" ? "AI sample rows" : h.source === "autopilot" ? "Autopilot" : h.source === "orbit" ? "By Orbit" : "By you"} · {h.executed_at ? new Date(h.executed_at).toLocaleString() : ""}</span>
                              {h.status === "undone" && <span className="ml-1.5 da-chip da-chip-slate px-1.5 py-0 text-[10.5px]">Undone</span>}
                            </span>
                            {h.can_undo && <button type="button" onClick={() => undo(h.id)} className="da-btn da-btn-ghost da-btn-sm"><RotateCcw className="h-3.5 w-3.5" /> Undo</button>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* One row: all values, then edit or delete */}
      <ModalShell open={!!openRow && !editing} onClose={() => setOpenRow(null)} size="lg" icon={Table2}
        title={`${table} ${pk && openRow ? `#${openRow[pk]}` : "row"}`}
        footer={
          <>
            {perms?.delete && <button type="button" onClick={askDelete} className="da-btn da-btn-ghost text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>}
            {perms?.update && pk && <button type="button" onClick={startEdit} className="da-btn da-btn-primary"><Pencil className="h-4 w-4" /> Edit</button>}
          </>
        }>
        {openRow && data && (
          <dl className="divide-y divide-slate-100">
            {data.columns.map((c) => (
              <div key={c.name} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 py-2 text-[13px]">
                <dt className="truncate font-mono text-[12px] text-slate-500">{c.name}</dt>
                <dd className="min-w-0 text-slate-800"><DataCell col={c} value={openRow[c.name]} full label={c.link && openRow[c.name] !== null ? data.labels?.[c.name]?.[String(openRow[c.name])] : undefined} /></dd>
              </div>
            ))}
          </dl>
        )}
      </ModalShell>

      {/* Add or edit */}
      <ModalShell open={!!editing} onClose={() => setEditing(null)} size="lg" icon={editing === "add" ? Plus : Pencil}
        title={editing === "add" ? `Add a row to ${table}` : `Edit ${table} #${openRow && pk ? openRow[pk] : ""}`}
        description={editing === "add" ? "Fill in the values; you see a preview before anything is written." : data && !data.revealed && hasPersonal ? "Personal data stays masked and cannot be edited until you reveal it." : "Only the values you change are saved."}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className="da-btn da-btn-ghost">Cancel</button>
            <button type="button" onClick={submitForm} disabled={previewing} className="da-btn da-btn-primary">{previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Check and preview</button>
          </>
        }>
        {data && connectionId && (
          <div className="space-y-3">
            <FormAlert message={formAlert} onClose={() => setFormAlert(null)} />
            <RowForm connectionId={connectionId} table={table} insert={editing === "add"} labels={data.labels}
              columns={editing === "edit" && !data.revealed ? data.columns.filter((c) => !c.personal) : data.columns}
              values={formValues} errors={formErrors}
              onChange={(col, v) => { setFormValues((p) => ({ ...p, [col]: v })); setFormErrors((p) => { const n = { ...p }; delete n[col]; return n; }); }} />
          </div>
        )}
      </ModalShell>

      {connectionId && table && (
        <SampleRowsModal open={sampleOpen} connectionId={connectionId} table={table} maxRows={maxSample} onClose={() => setSampleOpen(false)}
          onReady={(p) => { setSampleOpen(false); setPending(p); }} />
      )}
      <ChangeConfirmModal preview={pending} columns={data?.columns ?? []} onClose={() => setPending(null)} onDone={changeDone} />
    </div>
  );
};

export default DataPage;
