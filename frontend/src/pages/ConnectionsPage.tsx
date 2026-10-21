import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, AlertCircle, CheckCircle, CheckCircle2, ChevronDown, ChevronUp, Database, Edit2, Eye, EyeOff, Layers, Lock,
  Plus, RefreshCw, Server, ShieldCheck, TableProperties, Trash2, X,
} from "lucide-react";
import { api } from "../services/api";
import { ConnectionProfile } from "../types";
import { StatusPill } from "../components/common/StatusPill";
import { Card, EmptyState, FieldError, FormAlert, Loading, ModalShell, PageHeader } from "../components/ui/kit";
import { SpotlightCard } from "../components/landing/primitives";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useLiveEvents } from "../context/LiveEventsContext";
import { useToast } from "../context/ToastContext";
import { orbitTargets } from "../services/orbitTargets";
import { useOrbitTarget } from "../hooks/useOrbitTarget";
import { useOrbitSurface } from "../hooks/useOrbitSurface";
import { useRefreshAfterOrbit } from "../hooks/useRefreshAfterOrbit";
import { actionTarget, fieldTarget } from "../services/orbitSurfaces";
import { ariaFor, focusFirstError, invalid, rules, serverFieldErrors, validate, type FieldErrors, type Rule } from "../lib/validation";
import { pageStateService } from "../services/pageStateService";

interface SupportedEngine {
  id: string;
  name: string;
  status: "active" | "coming_soon";
  port: number;
  badge: string;
  description: string;
}

const SUPPORTED_ENGINES: SupportedEngine[] = [
  {
    id: "mysql",
    name: "MySQL",
    status: "active",
    port: 3306,
    badge: "Supported",
    description: "MySQL 8.0+ and MariaDB with full schema discovery and safe transactional writes.",
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    status: "active",
    port: 5432,
    badge: "Supported",
    description: "PostgreSQL 14+ through the same adapter; the server needs the PostgreSQL PHP driver.",
  },
  {
    id: "mssql",
    name: "SQL Server",
    status: "coming_soon",
    port: 1433,
    badge: "Not yet",
    description: "SQL Server has no adapter yet.",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    status: "coming_soon",
    port: 27017,
    badge: "Not yet",
    description: "MongoDB is not a relational SQL database and has no adapter yet.",
  },
];

/** Input id for each form field, so messages sit under (and focus moves to) the right input. */
const CONN_FIELD_ID: Record<string, string> = {
  name: "conn-name", connection_uri: "conn-uri", host: "conn-host", port: "conn-port", database_name: "conn-db",
  username: "conn-user", password: "conn-pass", connection_timeout: "conn-timeout", data_timezone: "conn-tz", ssl_mode: "conn-ssl",
};
const ADVANCED_FIELDS = ["connection_timeout", "ssl_mode"];

/** Mirrors the server rules in DbConnectionController::targetRules, so most problems are caught before a request. */
function connectionSchema(mode: "manual" | "uri", purpose: "save" | "test"): Record<string, Rule[]> {
  return {
    ...(purpose === "save" ? { name: [rules.required("Display name"), rules.maxLength(120, "Display name")] } : {}),
    ...(mode === "uri"
      ? {
          connection_uri: [
            rules.required("Connection URI", "Paste a connection URI, or switch to connection details."),
            rules.maxLength(2048, "Connection URI"),
            rules.pattern(/^mysql:\/\/\S+$/i, "Connection URI must start with mysql://, like mysql://user:password@127.0.0.1:3306/blog. For PostgreSQL, use Connection details."),
          ],
        }
      : {
          host: [rules.required("Host"), rules.host()],
          port: [rules.required("Port"), rules.integer("Port", 1, 65535)],
          database_name: [rules.required("Database name"), rules.identifier("Database name")],
          username: [rules.required("Username"), rules.maxLength(80, "Username")],
          password: [rules.maxLength(255, "Password")],
        }),
    connection_timeout: [rules.integer("Timeout", 1, 30)],
    ...(purpose === "save" ? { data_timezone: [rules.timezone("Database timezone"), rules.maxLength(64, "Database timezone")] } : {}),
  };
}

export const ConnectionsPage: React.FC = () => {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [isTestingAdHoc, setIsTestingAdHoc] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [refreshingSchemaId, setRefreshingSchemaId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Form State
  const [selectedEngine, setSelectedEngine] = useState<string>("mysql");
  const [connectionMode, setConnectionMode] = useState<"manual" | "uri">("manual");
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    name: "",
    host: "127.0.0.1",
    port: 3306 as number | string,
    database_name: "",
    username: "",
    password: "",
    connection_uri: "",
    ssl_mode: "preferred",
    connection_timeout: 10 as number | string,
    access_mode: "read_only" as "read_only" | "read_write" | "read_write_delete",
    data_timezone: "Asia/Kolkata",
  });

  const { addListener } = useLiveEvents();
  const { toast, confirm } = useToast();

  // Fields the user (or Orbit) actually entered, as opposed to untouched defaults.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Orbit pressed Test/Save: the backend runs the real operation; this page shows its result.
  const [agentPending, setAgentPending] = useState<"test" | "save" | null>(null);

  // Messages shown under each field, and one for problems that are not about a single field.
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateField = (name: keyof typeof form, value: any) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const showErrors = (found: FieldErrors) => {
    setErrors(found);
    if (Object.keys(found).some((f) => ADVANCED_FIELDS.includes(f))) setShowAdvanced(true);
    // Let a just-opened Advanced section render before moving focus into it.
    setTimeout(() => focusFirstError(found, (f) => CONN_FIELD_ID[f] ?? f), 60);
  };

  /** Server 422 messages, placed under the field the user can actually see in the current mode. */
  const serverErrorsFor = (err: any): FieldErrors => {
    const fields = serverFieldErrors(err);
    if (connectionMode !== "uri") return fields;
    const out: FieldErrors = {};
    for (const [k, v] of Object.entries(fields)) {
      const key = ["host", "port", "database_name", "username", "password"].includes(k) ? "connection_uri" : k;
      if (!out[key]) out[key] = v;
    }
    return out;
  };

  const blankToUndefined = (v: number | string) => (v === "" || v === null ? undefined : Number(v));

  // Semantic targets Orbit flies to (keys follow orbitSurfaces' fieldTarget/actionTarget naming).
  const addButtonRef = useOrbitTarget<HTMLButtonElement>("connections.add");
  const formRef = useOrbitTarget<HTMLDivElement>("connections.form");
  const nameRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "name"));
  const hostRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "host"));
  const portRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "port"));
  const dbRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "database_name"));
  const userRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "username"));
  const passwordRef = useOrbitTarget<HTMLInputElement>(fieldTarget("connections.form", "password"));
  const testButtonRef = useOrbitTarget<HTMLButtonElement>(actionTarget("connections.form", "test"));
  const saveButtonRef = useOrbitTarget<HTMLButtonElement>(actionTarget("connections.form", "save"));

  const loadConnections = async (silent = false) => {
    try {
      if (!silent && connections.length === 0) setLoading(true);
      const list = await api.listConnections();
      setConnections(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error(err);
      if (!silent) toast.error("Connections Load Error", err.message || "Failed to load connections.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  // Subscribe to live events for real-time updates without manual reload
  useEffect(() => {
    let timer: any = null;
    const unsubscribe = addListener((event) => {
      if (
        event.event_name === "connection.tested" ||
        event.event_name === "connection.schema_refreshed" ||
        event.event_name === "connection.created"
      ) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          loadConnections(true);
        }, 400);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [addListener]);

  const handleTestExisting = async (id: number) => {
    try {
      setTestingId(id);
      toast.info("Testing Connection", `Pinging target database #${id}...`);
      const res = await api.testConnection(id);
      if (res.success) {
        toast.success("Database Connected", `Server: ${res.server_version} (${res.latency_ms}ms)`);
      } else {
        toast.error("Connection Failed", res.message || "Failed to reach target database.");
      }
      loadConnections(true);
    } catch (err: any) {
      toast.error("Test Failed", err.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleRefreshSchema = async (id: number) => {
    try {
      setRefreshingSchemaId(id);
      toast.info("Scanning Schema", `Inspecting metadata catalogs for connection #${id}...`);
      const res = await api.refreshSchema(id);
      toast.success("Schema Refreshed", `Discovered ${res.tables_discovered || 0} tables.`);
      loadConnections(true);
    } catch (err: any) {
      toast.error("Schema Refresh Failed", err.message);
    } finally {
      setRefreshingSchemaId(null);
    }
  };

  const handleTestAdHoc = async () => {
    setFormError(null);
    const found = validate(form, connectionSchema(connectionMode, "test"));
    if (Object.keys(found).length) {
      setTestResult(null);
      showErrors(found);
      return;
    }
    setErrors({});
    try {
      setIsTestingAdHoc(true);
      setTestResult(null);

      const payload = connectionMode === "uri"
        ? { db_type: selectedEngine, connection_mode: "uri", connection_uri: form.connection_uri.trim(), ssl_mode: form.ssl_mode, connection_timeout: blankToUndefined(form.connection_timeout) }
        : {
            db_type: selectedEngine,
            connection_mode: "manual",
            host: form.host.trim(),
            port: blankToUndefined(form.port),
            database_name: form.database_name.trim(),
            username: form.username.trim(),
            password: form.password,
            ssl_mode: form.ssl_mode,
            connection_timeout: blankToUndefined(form.connection_timeout),
          };

      const res = await api.testAdHocConnection(payload);
      setTestResult(res);
      if (res.success) {
        toast.success("Live Test Successful", `Connected to ${res.server_version || "database"} (${res.latency_ms}ms)`);
      } else {
        toast.error("Test Failed", res.message);
      }
    } catch (err: any) {
      const fields = serverErrorsFor(err);
      if (Object.keys(fields).length) {
        showErrors(fields);
      } else {
        // The settings were valid but the database could not be reached: show the server's diagnostic stages.
        setTestResult(err?.data?.stages ? { ...err.data, success: false } : { success: false, message: err?.data?.message || err.message });
      }
    } finally {
      setIsTestingAdHoc(false);
    }
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const found = validate(form, connectionSchema(connectionMode, "save"));
    if (Object.keys(found).length) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        db_type: selectedEngine,
        access_mode: form.access_mode,
        data_timezone: form.data_timezone.trim() || undefined,
        connection_mode: connectionMode,
        ...(connectionMode === "uri"
          ? { connection_uri: form.connection_uri.trim() }
          : {
              host: form.host.trim(),
              port: blankToUndefined(form.port),
              database_name: form.database_name.trim(),
              username: form.username.trim(),
              password: form.password || undefined,
            }),
        ssl_mode: form.ssl_mode,
        connection_timeout: blankToUndefined(form.connection_timeout),
      };

      if (editingId) {
        await api.updateConnection(editingId, payload);
        toast.success("Connection Updated", "Connection profile updated successfully.");
      } else {
        await api.createConnection(payload);
        toast.success("Connection Created", "Connection profile saved successfully.");
      }

      setShowModal(false);
      setEditingId(null);
      resetForm();
      loadConnections(true);
    } catch (err: any) {
      const fields = serverErrorsFor(err);
      if (Object.keys(fields).length) showErrors(fields);
      else setFormError(err?.message || "Could not save the connection. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    pageStateService.setRoute("/connections", "Database Connections");
  }, []);

  // ---- Orbit surfaces: the same state and API calls a user's typing and clicks use ----------

  const validators: Record<string, (v: any) => [string | null, any]> = {
    name: (v) => { const t = String(v ?? "").trim(); return !t || t.length > 120 ? ["Name must be 1-120 characters.", null] : [null, t]; },
    host: (v) => { const t = String(v ?? "").trim(); return /^[A-Za-z0-9.\-_:]{1,253}$/.test(t) ? [null, t] : ["Host must be a hostname or IP address.", null]; },
    port: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 65535 ? [null, n] : ["Port must be 1-65535.", null]; },
    database_name: (v) => { const t = String(v ?? "").trim(); return /^[A-Za-z0-9_$\-]{1,64}$/.test(t) ? [null, t] : ["Database name has invalid characters.", null]; },
    username: (v) => { const t = String(v ?? "").trim(); return !t || t.length > 80 ? ["Username must be 1-80 characters.", null] : [null, t]; },
    ssl_mode: (v) => { const t = String(v ?? ""); return ["preferred", "required", "disabled"].includes(t) ? [null, t] : ["Choose preferred, required or disabled.", null]; },
  };

  const formPayload = () => ({
    db_type: selectedEngine, mode: "manual", name: form.name, host: form.host, port: form.port,
    database_name: form.database_name, username: form.username, password: form.password,
    ssl_mode: form.ssl_mode, connection_timeout: form.connection_timeout,
    access_mode: form.access_mode, data_timezone: form.data_timezone,
  });

  useRefreshAfterOrbit(["save_database_connection", "update_database_connection", "disconnect_database_connection", "test_database_connection", "scan_database_schema"], () => { loadConnections(true); });

  useOrbitSurface("connections.form", () => ({
    isOpen: () => showModal,
    open: () => openCreateModal(),
    openTarget: "connections.add",
    target: "connections.form",
    fields: {
      ...Object.fromEntries(["name", "host", "port", "database_name", "username", "ssl_mode"].map((name) => [name, {
        get: () => (form as any)[name],
        set: (v: any) => {
          const [err, clean] = validators[name](v);
          if (err) return err;
          setConnectionMode("manual");
          updateField(name as keyof typeof form, clean);
          return null;
        },
        ...(name === "ssl_mode" ? { options: () => [
          { value: "preferred", label: "Preferred" }, { value: "required", label: "Required" }, { value: "disabled", label: "Disabled" },
        ] } : {}),
      }])),
      // The password is typed by the user; Orbit never reads or sets it.
      password: { get: () => form.password, set: () => "The user must type the password themselves." },
    },
    actions: {
      test: {
        enabled: () => !!form.host && !!form.database_name && !!form.username,
        run: async () => {
          setAgentPending("test");
          setTestResult(null);
          try {
            const res = await api.testAdHocConnection(formPayload());
            setTestResult(res);
            return { success: !!res.success, message: res.success
              ? `Connection works (MySQL ${res.server_version || ""}, ${res.latency_ms ?? "?"} ms).`
              : (res.message || "Connection test failed.") };
          } catch (err: any) {
            setTestResult({ success: false, message: err.message });
            return { success: false, message: err.message || "Connection test failed." };
          } finally {
            setAgentPending(null);
          }
        },
      },
      save: {
        enabled: () => !!form.name && !!form.host && !!form.database_name && !!form.username && (!!form.password || !!editingId),
        run: async () => {
          setAgentPending("save");
          try {
            const payload = { ...formPayload(), password: form.password || undefined };
            const res: any = editingId ? await api.updateConnection(editingId, payload) : await api.createConnection(payload);
            const conn = res?.connection;
            setShowModal(false);
            setEditingId(null);
            resetForm();
            loadConnections(true);
            return { success: true, message: res?.message || "Connection profile saved.", resource: conn?.id ? { type: "DbConnection", id: conn.id } : undefined };
          } catch (err: any) {
            return { success: false, message: err.message || "Saving the connection failed." };
          } finally {
            setAgentPending(null);
          }
        },
      },
      cancel: { run: () => { setShowModal(false); return { success: true, message: "Form closed." }; } },
    },
  }));

  useOrbitSurface("connections.list", () => ({
    target: "connections.add",
    describe: () => connections.map((c: any) => ({
      id: c.id, name: c.name, host: c.host, port: c.port, database: c.database_name || c.database,
      username: c.username, status: c.status || "untested", last_tested_at: c.last_tested_at,
    })),
    actions: {
      test: {
        target: (row) => `connections.card.${row}`,
        run: async (row) => {
          try {
            setTestingId(Number(row));
            const res = await api.testConnection(Number(row));
            loadConnections(true);
            return { success: !!res.success, message: res.success ? `Reachable (MySQL ${res.server_version || ""}, ${res.latency_ms ?? "?"} ms).` : (res.message || "Not reachable."), resource: { type: "DbConnection", id: Number(row) } };
          } catch (err: any) {
            loadConnections(true);
            return { success: false, message: err.message || "Connection test failed." };
          } finally {
            setTestingId(null);
          }
        },
      },
      refresh_schema: {
        target: (row) => `connections.card.${row}`,
        run: async (row) => {
          try {
            setRefreshingSchemaId(Number(row));
            const res: any = await api.refreshSchema(Number(row));
            loadConnections(true);
            return { success: true, message: `Schema rescanned: ${res?.tables_discovered ?? "?"} tables.`, resource: { type: "DbConnection", id: Number(row) } };
          } catch (err: any) {
            return { success: false, message: err.message || "Schema rescan failed." };
          } finally {
            setRefreshingSchemaId(null);
          }
        },
      },
      edit: {
        target: (row) => `connections.card.${row}`,
        run: (row) => {
          const c = connections.find((x: any) => String(x.id) === String(row));
          if (!c) return { success: false, message: "No such connection on screen." };
          openEditModal(c);
          return { success: true, message: `Edit form opened for ${c.name}.` };
        },
      },
      remove: {
        target: (row) => `connections.card.${row}`,
        run: async (row) => {
          if (!connections.find((x: any) => String(x.id) === String(row))) return { success: false, message: `No connection ${row} on screen.` };
          if (!(await askRemove(Number(row)))) return { success: false, message: "Removal was not confirmed in the popup; nothing changed." };
          try {
            const res: any = await api.deleteConnection(Number(row));
            loadConnections(true);
            return { success: true, message: res?.message || "Connection profile removed." };
          } catch (err: any) {
            return { success: false, message: err.message || "Could not remove the connection." };
          }
        },
      },
    },
  }));

  // Structured, non-secret page state for Orbit's runtime context.
  useEffect(() => {
    pageStateService.setActiveModal(showModal ? "connection_modal" : null);
    if (showModal) {
      pageStateService.registerForm("connection_modal", editingId ? "Edit Database Connection" : "New Database Connection");
      (["name", "host", "port", "database_name", "username"] as const).forEach((field) => {
        pageStateService.updateFormField("connection_modal", field, form[field], { isDefault: !touched[field] });
      });
      pageStateService.updateFormField("connection_modal", "password", form.password, { isSecret: true });
    } else {
      pageStateService.unregisterForm("connection_modal");
    }
  }, [showModal, form, touched, editingId]);

  const resetForm = () => {
    setForm({
      name: "",
      host: "127.0.0.1",
      port: 3306,
      database_name: "",
      username: "",
      password: "",
      connection_uri: "",
      ssl_mode: "preferred",
      connection_timeout: 10,
      access_mode: "read_only",
      data_timezone: "Asia/Kolkata",
    });
    setTestResult(null);
    setConnectionMode("manual");
    setSelectedEngine("mysql");
    setShowAdvanced(false);
    setTouched({});
    setAgentPending(null);
    setErrors({});
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setEditingId(null);
    setShowModal(true);
  };

  const openEditModal = (c: any) => {
    setEditingId(c.id);
    setSelectedEngine(c.db_type || "mysql");
    setConnectionMode("manual");
    setForm({
      name: c.name || "",
      host: c.host || "127.0.0.1",
      port: c.port || (c.db_type === "postgresql" ? 5432 : 3306),
      database_name: c.database_name || c.database || "",
      username: c.username || "",
      password: "", // Never expose existing secret in plain text
      connection_uri: "",
      ssl_mode: c.ssl_mode === "prefer" ? "preferred" : (c.ssl_mode === "require" ? "required" : (c.ssl_mode === "disable" ? "disabled" : (c.ssl_mode || "preferred"))),
      connection_timeout: c.connection_timeout || 10,
      access_mode: c.access_mode || "read_only",
      data_timezone: c.data_timezone || "Asia/Kolkata",
    });
    setTestResult(null);
    setErrors({});
    setFormError(null);
    setShowAdvanced(false);
    setTouched({ name: true, host: true, port: true, database_name: true, username: true });
    setShowModal(true);
  };

  // Shared by the Remove button and Orbit's remove action, so both see the same popup.
  function askRemove(id: number) {
    const name = connections.find((x: any) => x.id === id)?.name;
    return confirm({
      title: "Remove Connection Profile?",
      text: `Are you sure you want to remove ${name ? `"${name}"` : "this connection profile"}? This does NOT alter target database tables.`,
      confirmButtonText: "Yes, Remove",
      cancelButtonText: "Keep Connection",
    });
  }

  const handleDelete = async (id: number) => {
    if (!(await askRemove(id))) return;
    try {
      await api.deleteConnection(id);
      toast.success("Connection Profile Removed", "Target database tables remain untouched.");
      loadConnections();
    } catch (err: any) {
      toast.error("Delete Error", err.message);
    }
  };

  const accessChip = (mode?: string) =>
    mode === "read_write_delete"
      ? { label: "Read, write & delete", cls: "da-chip-violet" }
      : mode === "read_write"
        ? { label: "Read & write", cls: "da-chip-amber" }
        : { label: "Read-only", cls: "da-chip-emerald" };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Database connections"
        description="Connect the databases DataAuto works with. Every connection is tested before it is saved, credentials are encrypted at rest, and new connections start read-only."
        actions={
          <button ref={addButtonRef} id="connection-form-anchor" type="button" onClick={openCreateModal} className="da-btn da-btn-primary">
            <Plus className="h-4 w-4" /> Connect database
          </button>
        }
      />

      {/* Action notification */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-[13px] ${
              actionMsg.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : actionMsg.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-indigo-200 bg-indigo-50 text-indigo-800"
            }`}
          >
            <span className="flex items-center gap-2">
              {actionMsg.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              {actionMsg.text}
            </span>
            <button type="button" onClick={() => setActionMsg(null)} className="da-icon-btn h-7 w-7" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && connections.length === 0 ? (
        <Card><Loading label="Loading connections…" /></Card>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No databases connected yet"
          description="Connect your MySQL database to discover its tables, ask questions about your data and set up automated publishing."
          action={
            <button type="button" onClick={openCreateModal} className="da-btn da-btn-primary">
              <Plus className="h-4 w-4" /> Connect a database
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((c, idx) => {
            const dbName = (c as any).database_name || c.database || "";
            const currentStatus = (c as any).status || c.last_status || "untested";
            const isItemTesting = testingId === c.id;
            const isRefreshingSchema = refreshingSchemaId === c.id;
            const lastTested = (c as any).last_tested_at;
            const serverVersion = (c as any).server_version;
            const latencyMs = (c as any).latency_ms;
            const access = accessChip(c.access_mode);

            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: Math.min(idx, 8) * 0.05, ease: [0.16, 1, 0.3, 1] }}
                ref={(el: HTMLDivElement | null) =>
                  el ? orbitTargets.register(`connections.card.${c.id}`, el) : orbitTargets.unregister(`connections.card.${c.id}`)
                }
              >
                <SpotlightCard className="h-full shadow-soft">
                  <div className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 text-white shadow-[0_10px_24px_-10px_rgba(99,102,241,0.8)] transition-transform duration-500 group-hover:rotate-[6deg]">
                          <Database className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <h4 className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950">{c.name}</h4>
                          <div className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">{c.db_type || "mysql"}</div>
                        </div>
                      </div>
                      <StatusPill status={currentStatus} size="sm" />
                    </div>

                    <div className="mt-4 flex items-center gap-1.5">
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <span className={`da-chip ${access.cls}`}>{access.label}</span>
                        {c.data_timezone && <span className="da-chip da-chip-slate font-mono">{c.data_timezone}</span>}
                        {latencyMs && (
                          <span className="da-chip da-chip-emerald font-mono">
                            <Activity className="h-3 w-3" /> {latencyMs} ms
                          </span>
                        )}
                      </div>
                      <div className="ml-auto flex shrink-0 items-center">
                        <button type="button" onClick={() => openEditModal(c)} className="da-icon-btn h-8 w-8" title="Edit connection" aria-label={`Edit ${c.name}`}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(c.id)} className="da-icon-btn h-8 w-8 hover:bg-rose-50 hover:text-rose-600" title="Remove connection" aria-label={`Remove ${c.name}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <dl className="da-panel mt-4 space-y-2 px-4 py-3 text-[12.5px]">
                      <div className="flex justify-between gap-3"><dt className="text-slate-500">Host</dt><dd className="truncate font-mono font-medium text-slate-800">{c.host}:{c.port}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-slate-500">Database</dt><dd className="truncate font-mono font-semibold text-indigo-600">{dbName}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-slate-500">User</dt><dd className="truncate font-mono text-slate-800">{c.username}</dd></div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Password</dt>
                        <dd className="flex items-center gap-1 text-slate-500"><Lock className="h-3 w-3" /> Encrypted</dd>
                      </div>
                      {serverVersion && <div className="flex justify-between gap-3"><dt className="text-slate-500">Server</dt><dd className="truncate font-mono text-slate-600">{serverVersion}</dd></div>}
                      {lastTested && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-500">Last checked</dt>
                          <dd className="text-slate-600">{new Date(lastTested).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
                      <button type="button" onClick={() => handleTestExisting(c.id)} disabled={isItemTesting} className="da-btn da-btn-secondary da-btn-sm" title="Test the live connection">
                        <RefreshCw className={`h-3.5 w-3.5 ${isItemTesting ? "animate-spin text-indigo-600" : ""}`} />
                        {isItemTesting ? "Testing…" : "Test"}
                      </button>
                      <button type="button" onClick={() => handleRefreshSchema(c.id)} disabled={isRefreshingSchema} className="da-btn da-btn-secondary da-btn-sm" title="Rescan the schema">
                        <Layers className={`h-3.5 w-3.5 ${isRefreshingSchema ? "animate-spin text-indigo-600" : ""}`} />
                        {isRefreshingSchema ? "Scanning…" : "Scan"}
                      </button>
                      <Link to={`/explorer?connectionId=${c.id}`} className="da-btn da-btn-sm border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                        <TableProperties className="h-3.5 w-3.5" /> Schema
                      </Link>
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Connect / edit form */}
      <ModalShell
        open={showModal}
        onClose={() => setShowModal(false)}
        closeOnBackdrop={false}
        panelRef={formRef}
        size="lg"
        icon={Database}
        title={editingId ? "Edit database connection" : "Connect a database"}
        description="Credentials are encrypted at rest and never logged. The connection is tested before it is saved."
        footer={
          <>
            <button
              ref={testButtonRef}
              type="button"
              onClick={handleTestAdHoc}
              disabled={isTestingAdHoc || agentPending !== null}
              className="da-btn da-btn-secondary mr-auto"
            >
              <RefreshCw className={`h-4 w-4 ${isTestingAdHoc || agentPending === "test" ? "animate-spin text-indigo-600" : ""}`} />
              {isTestingAdHoc ? "Testing…" : agentPending === "test" ? "Orbit is testing…" : "Test connection"}
            </button>
            <button type="button" onClick={() => setShowModal(false)} className="da-btn da-btn-ghost">Cancel</button>
            <button ref={saveButtonRef} type="submit" form="connection-form" disabled={agentPending !== null || saving} className="da-btn da-btn-primary">
              {agentPending === "save" ? "Orbit is saving…" : saving ? "Saving…" : editingId ? "Update connection" : "Save connection"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Engine */}
          <div>
            <span className="da-label">Database engine</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SUPPORTED_ENGINES.map((engine) => {
                const isSelected = selectedEngine === engine.id;
                const isAvailable = engine.status === "active";
                return (
                  <button
                    type="button"
                    key={engine.id}
                    disabled={!isAvailable}
                    onClick={() => {
                      if (isAvailable) {
                        setSelectedEngine(engine.id);
                        setForm((prev) => ({ ...prev, port: engine.port }));
                      }
                    }}
                    title={engine.description}
                    className={`rounded-2xl border p-3 text-left transition-all ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50/70 ring-4 ring-indigo-500/10"
                        : isAvailable
                          ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[13px] font-bold text-slate-900">
                      <Server className={`h-3.5 w-3.5 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} /> {engine.name}
                    </div>
                    <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${isAvailable ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                      {engine.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manual vs URI */}
          <div className="da-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={connectionMode === "manual"} onClick={() => { setConnectionMode("manual"); setErrors({}); }}
              className={`da-tab ${connectionMode === "manual" ? "da-tab-active" : ""}`}>
              Connection details
            </button>
            <button type="button" role="tab" aria-selected={connectionMode === "uri"} onClick={() => { setConnectionMode("uri"); setErrors({}); }}
              className={`da-tab ${connectionMode === "uri" ? "da-tab-active" : ""}`}>
              Connection URI
            </button>
          </div>

          <form id="connection-form" onSubmit={handleSaveConnection} noValidate className="space-y-4">
            <FormAlert message={formError} onClose={() => setFormError(null)} />
            <div>
              <label className="da-label" htmlFor="conn-name">Display name</label>
              <input id="conn-name" ref={nameRef} type="text" placeholder="e.g. Production blog" maxLength={120}
                value={form.name} onChange={(e) => updateField("name", e.target.value)} className={`da-input${invalid(errors.name)}`} {...ariaFor("conn-name", errors.name)} />
              <FieldError id="conn-name" message={errors.name} />
            </div>

            {connectionMode === "uri" ? (
              <div>
                <label className="da-label" htmlFor="conn-uri">Connection URI</label>
                <input id="conn-uri" type="text" placeholder="mysql://user:password@127.0.0.1:3306/database?sslmode=prefer" autoComplete="off" spellCheck={false}
                  value={form.connection_uri} onChange={(e) => updateField("connection_uri", e.target.value)}
                  className={`da-input font-mono text-[12.5px]${invalid(errors.connection_uri)}`} {...ariaFor("conn-uri", errors.connection_uri)} />
                <FieldError id="conn-uri" message={errors.connection_uri} />
                <p className="da-help">Standard MySQL connection strings. Credentials are parsed and encrypted before they are stored.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="da-label" htmlFor="conn-host">Host</label>
                    <input id="conn-host" ref={hostRef} type="text" placeholder="127.0.0.1 or db.example.com" spellCheck={false}
                      value={form.host} onChange={(e) => updateField("host", e.target.value)} className={`da-input font-mono${invalid(errors.host)}`} {...ariaFor("conn-host", errors.host)} />
                    <FieldError id="conn-host" message={errors.host} />
                  </div>
                  <div>
                    <label className="da-label" htmlFor="conn-port">Port</label>
                    <input id="conn-port" ref={portRef} type="number" inputMode="numeric" placeholder="3306"
                      value={form.port} onChange={(e) => updateField("port", e.target.value === "" ? "" : Number(e.target.value))}
                      className={`da-input font-mono${invalid(errors.port)}`} {...ariaFor("conn-port", errors.port)} />
                    <FieldError id="conn-port" message={errors.port} />
                  </div>
                </div>
                <div>
                  <label className="da-label" htmlFor="conn-db">Database name</label>
                  <input id="conn-db" ref={dbRef} type="text" placeholder="e.g. blog_cms" spellCheck={false}
                    value={form.database_name} onChange={(e) => updateField("database_name", e.target.value)}
                    className={`da-input font-mono${invalid(errors.database_name)}`} {...ariaFor("conn-db", errors.database_name)} />
                  <FieldError id="conn-db" message={errors.database_name} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="da-label" htmlFor="conn-user">Username</label>
                    <input id="conn-user" ref={userRef} type="text" placeholder="e.g. editor" autoComplete="off" spellCheck={false}
                      value={form.username} onChange={(e) => updateField("username", e.target.value)}
                      className={`da-input font-mono${invalid(errors.username)}`} {...ariaFor("conn-user", errors.username)} />
                    <FieldError id="conn-user" message={errors.username} />
                  </div>
                  <div>
                    <label className="da-label flex items-center justify-between" htmlFor="conn-pass">
                      <span>Password</span>
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"><Lock className="h-3 w-3" /> Encrypted</span>
                    </label>
                    <div className="relative">
                      <input id="conn-pass" ref={passwordRef} type={showPassword ? "text" : "password"}
                        placeholder={editingId ? "Leave blank to keep the current one" : "Database password"}
                        value={form.password} onChange={(e) => updateField("password", e.target.value)} autoComplete="new-password"
                        className={`da-input pr-10${invalid(errors.password)}`} {...ariaFor("conn-pass", errors.password)} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 da-icon-btn h-7 w-7"
                        aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <FieldError id="conn-pass" message={errors.password} />
                  </div>
                </div>
              </>
            )}

            {/* Advanced */}
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full items-center justify-between bg-slate-50/80 px-4 py-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100">
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-600" /> Advanced: TLS/SSL and timeout</span>
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="space-y-3 border-t border-slate-200 bg-white p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <span className="da-label" id="conn-ssl">TLS/SSL mode</span>
                          <SearchableSelect
                            value={form.ssl_mode === "prefer" ? "preferred" : (form.ssl_mode === "require" ? "required" : (form.ssl_mode === "disable" ? "disabled" : (form.ssl_mode || "preferred")))}
                            onChange={(val) => updateField("ssl_mode", String(val))}
                            placeholder="Select TLS/SSL mode..."
                            options={[
                              { value: "preferred", label: "Prefer (Default)", badge: "Default" },
                              { value: "required", label: "Require (Enforce TLS)", badge: "Enforce TLS" },
                              { value: "disabled", label: "Disable", badge: "None" },
                            ]}
                          />
                          <FieldError id="conn-ssl" message={errors.ssl_mode} />
                        </div>
                        <div>
                          <label className="da-label" htmlFor="conn-timeout">Timeout (seconds)</label>
                          <input id="conn-timeout" type="number" inputMode="numeric" placeholder="10" value={form.connection_timeout}
                            onChange={(e) => updateField("connection_timeout", e.target.value === "" ? "" : Number(e.target.value))}
                            className={`da-input${invalid(errors.connection_timeout)}`} {...ariaFor("conn-timeout", errors.connection_timeout)} />
                          <FieldError id="conn-timeout" message={errors.connection_timeout} />
                          {!errors.connection_timeout && <p className="da-help">1 to 30 seconds.</p>}
                        </div>
                      </div>
                      <p className="text-[12px] text-slate-500">Connection tests refuse cloud metadata addresses (169.254.169.254) and other unsafe destinations.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Access mode */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-indigo-600" /> Access mode</span>
                <span className="text-[11.5px] text-slate-500">You decide; the server enforces it</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  { mode: "read_only", title: "Read-only", badge: "Safest", desc: "Questions, counts and schema only. Edits and deletes are blocked.", sel: "border-emerald-300 bg-emerald-50 ring-emerald-500/15" },
                  { mode: "read_write", title: "Read & write", badge: "Preview first", desc: "Adds row updates with a before/after preview and your confirmation. Deletes blocked.", sel: "border-amber-300 bg-amber-50 ring-amber-500/15" },
                  { mode: "read_write_delete", title: "Read, write & delete", badge: "Guarded", desc: "Adds deletes with impact analysis, typed confirmation and a saved copy for undo.", sel: "border-violet-300 bg-violet-50 ring-violet-500/15" },
                ].map((m) => {
                  const isSel = form.access_mode === m.mode;
                  return (
                    <button
                      type="button"
                      key={m.mode}
                      onClick={() => updateField("access_mode", m.mode)}
                      aria-pressed={isSel}
                      className={`rounded-xl border p-3 text-left transition-all ${isSel ? `ring-4 ${m.sel}` : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold text-slate-900">{m.title}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-1.5 py-px text-[10px] font-semibold text-slate-600">{m.badge}</span>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-snug text-slate-600">{m.desc}</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>
                  Tip: use a database user limited to the mode you choose (for example <code className="font-mono font-bold">fx_ro</code> for read-only). DataAuto enforces the mode
                  either way and never assumes the database user is restricted. This mode governs the data assistant; automations and Manual Publishing add only the new rows you configure.
                </span>
              </div>
              <div className="mt-3">
                <label className="da-label" htmlFor="conn-tz">Database timezone</label>
                <input id="conn-tz" type="text" placeholder="Asia/Kolkata" value={form.data_timezone} spellCheck={false}
                  onChange={(e) => updateField("data_timezone", e.target.value)}
                  className={`da-input font-mono${invalid(errors.data_timezone)}`} {...ariaFor("conn-tz", errors.data_timezone)} />
                <FieldError id="conn-tz" message={errors.data_timezone} />
                <p className="da-help">Used for "today" and "yesterday" questions and for wall-clock timestamps.</p>
              </div>
            </div>

            {/* Live diagnostics */}
            {isTestingAdHoc && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 text-[12.5px]">
                <div className="flex items-center gap-2 font-semibold text-indigo-900">
                  <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" /> Testing the connection…
                </div>
                <ol className="mt-2 space-y-1 pl-6 text-indigo-700">
                  <li>Checking the settings and network safety rules</li>
                  <li>Opening a secure connection</li>
                  <li>Verifying privileges and the server version</li>
                  <li>Reading table metadata</li>
                </ol>
              </motion.div>
            )}

            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 text-[12.5px] ${testResult.success ? "border-emerald-200 bg-emerald-50/80 text-emerald-900" : "border-rose-200 bg-rose-50/80 text-rose-900"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-bold">
                    {testResult.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-rose-600" />}
                    {testResult.success ? "Connection verified" : "Connection test failed"}
                    {testResult.via === "orbit" && <span className="font-normal text-[11px] text-indigo-600">(server result of Orbit's test)</span>}
                  </span>
                  {testResult.latency_ms && <span className="font-mono text-[11.5px] font-semibold text-slate-500">{testResult.latency_ms} ms</span>}
                </div>
                {testResult.stages && testResult.stages.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 border-t border-black/5 pt-3">
                    {testResult.stages.map((st: any, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        {st.status === "passed" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />}
                        <span><strong className="text-slate-800">{st.stage}:</strong> <span className="font-mono text-[11.5px] text-slate-600">{st.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1.5 font-mono text-[12px]">{testResult.message}</div>
                )}
              </motion.div>
            )}
          </form>
        </div>
      </ModalShell>
    </div>
  );
};
