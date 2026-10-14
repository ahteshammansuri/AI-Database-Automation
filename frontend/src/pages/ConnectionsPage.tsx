import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  Plus,
  TableProperties,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Server,
  Layers,
  Clock,
  Activity,
  Edit2,
} from "lucide-react";
import { api } from "../services/api";
import { ConnectionProfile } from "../types";
import { StatusPill } from "../components/common/StatusPill";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { useLiveEvents } from "../context/LiveEventsContext";
import { useToast } from "../context/ToastContext";
import { useAssistant } from "../context/AssistantContext";
import { actionBridge } from "../services/actionBridge";

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
    badge: "Production Ready",
    description: "MySQL 8.0+ with full schema discovery & safe transactional execution.",
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    status: "coming_soon",
    port: 5432,
    badge: "Coming Soon",
    description: "Advanced relational driver with MVCC safety guarantees.",
  },
  {
    id: "mssql",
    name: "SQL Server",
    status: "coming_soon",
    port: 1433,
    badge: "Coming Soon",
    description: "Enterprise MSSQL connector with TDS protocol security.",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    status: "coming_soon",
    port: 27017,
    badge: "Coming Soon",
    description: "Document collection introspection and BSON schema inference.",
  },
];

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
    port: 3306,
    database_name: "",
    username: "",
    password: "",
    connection_uri: "",
    ssl_mode: "preferred",
    connection_timeout: 10,
  });

  const { addListener } = useLiveEvents();
  const { toast, showAlert } = useToast();
  const { activeAnchor } = useAssistant();

  useEffect(() => {
    if (activeAnchor === "connection-form-anchor" && !showModal) {
      setShowModal(true);
    }
  }, [activeAnchor, showModal]);

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
    const unsubscribe = addListener((event) => {
      if (
        event.event_name === "connection.tested" ||
        event.event_name === "connection.schema_refreshed" ||
        event.event_name === "connection.created"
      ) {
        // Re-sync canonical connections list
        loadConnections(true);
      }
    });
    return unsubscribe;
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
    if (connectionMode === "uri" && !form.connection_uri) {
      setTestResult({ success: false, message: "Please enter a connection URI string to test." });
      toast.warning("Missing URI", "Please enter a connection URI string.");
      return;
    }
    if (connectionMode === "manual" && (!form.host || !form.database_name || !form.username)) {
      setTestResult({ success: false, message: "Please enter Host, Database Name, and Username to test." });
      toast.warning("Incomplete Fields", "Please enter Host, Database Name, and Username.");
      return;
    }
    try {
      setIsTestingAdHoc(true);
      setTestResult(null);

      const payload = {
        db_type: selectedEngine,
        mode: connectionMode,
        name: form.name || "Test Connection",
        connection_uri: form.connection_uri,
        host: form.host,
        port: form.port,
        database_name: form.database_name,
        username: form.username,
        password: form.password,
        ssl_mode: form.ssl_mode,
        connection_timeout: form.connection_timeout,
      };

      const res = await api.testAdHocConnection(payload);
      setTestResult(res);
      if (res.success) {
        toast.success("Live Test Successful", `Connected to ${res.server_version || "database"} (${res.latency_ms}ms)`);
      } else {
        toast.error("Test Failed", res.message);
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      toast.error("Test Error", err.message);
    } finally {
      setIsTestingAdHoc(false);
    }
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        db_type: selectedEngine,
        connection_uri: connectionMode === "uri" ? form.connection_uri : undefined,
        host: form.host,
        port: form.port,
        database_name: form.database_name,
        username: form.username,
        password: form.password || undefined,
        ssl_mode: form.ssl_mode,
        connection_timeout: form.connection_timeout,
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
      toast.error("Save Error", err.message);
    }
  };

  // Wire typed ActionBridge for autonomous website operations
  useEffect(() => {
    const unsubs = [
      actionBridge.on("connections.open_create_form", (payload) => {
        setShowModal(true);
        if (payload?.slots) {
          setForm((prev) => ({
            ...prev,
            name: payload.slots.name || prev.name || "Production Target",
            host: payload.slots.host || prev.host,
            port: payload.slots.port ? Number(payload.slots.port) : prev.port,
            database_name: payload.slots.database || payload.slots.database_name || prev.database_name,
            username: payload.slots.username || prev.username,
          }));
        }
      }),

      actionBridge.on("connections.fill_fields", (payload) => {
        setShowModal(true);
        if (payload?.fields) {
          const f = payload.fields;
          setForm((prev) => ({
            ...prev,
            name: f.name || prev.name,
            host: f.host || prev.host,
            port: f.port ? Number(f.port) : prev.port,
            database_name: f.database || f.database_name || prev.database_name,
            username: f.username || prev.username,
          }));
        }
      }),

      actionBridge.on("connections.trigger_test", async (payload) => {
        setShowModal(true);
        if (payload) {
          setForm((prev) => ({
            ...prev,
            host: payload.host || prev.host,
            port: payload.port ? Number(payload.port) : prev.port,
            database_name: payload.database || payload.database_name || prev.database_name,
            username: payload.username || prev.username,
          }));
        }
        await handleTestAdHoc();
      }),

      actionBridge.on("connections.submit_save", async (payload) => {
        setShowModal(true);
        if (payload?.name) {
          setForm((prev) => ({ ...prev, name: payload.name }));
        }
        await handleSaveConnection({ preventDefault: () => {} } as any);
      }),

      actionBridge.on("connections.scan_schema", () => {
        loadConnections(true);
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [handleTestAdHoc, handleSaveConnection]);

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
    });
    setTestResult(null);
    setConnectionMode("manual");
    setSelectedEngine("mysql");
    setShowAdvanced(false);
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
      port: c.port || 3306,
      database_name: c.database_name || c.database || "",
      username: c.username || "",
      password: "", // Never expose existing secret in plain text
      connection_uri: "",
      ssl_mode: c.ssl_mode === "prefer" ? "preferred" : (c.ssl_mode === "require" ? "required" : (c.ssl_mode === "disable" ? "disabled" : (c.ssl_mode || "preferred"))),
      connection_timeout: c.connection_timeout || 10,
    });
    setTestResult(null);
    setShowModal(true);
  };

  const handleDelete = (id: number) => {
    showAlert({
      title: "Remove Connection Profile?",
      text: "Are you sure you want to remove this connection profile? This does NOT alter target database tables.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Remove",
      cancelButtonText: "Keep Connection",
      onConfirm: async () => {
        try {
          await api.deleteConnection(id);
          toast.success("Connection Profile Removed", "Target database tables remain untouched.");
          loadConnections();
        } catch (err: any) {
          toast.error("Delete Error", err.message);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Ephemeral PDO Pool
            </span>
            <span className="text-xs text-slate-500">• Encrypted Credentials at Rest</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Database Connections</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Connect customer target databases. Supported engines discover schemas and execute strictly validated, allowlisted writes.
          </p>
        </div>
        <motion.button
          id="connection-form-anchor"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={openCreateModal}
          className="btn-primary-gradient flex items-center gap-2 px-4 py-2 text-white rounded-lg text-xs font-semibold transition shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Connect Database</span>
        </motion.button>
      </div>

      {/* Action Notification Banner */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between shadow-2xs ${
              actionMsg.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : actionMsg.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-indigo-50 border-indigo-200 text-indigo-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {actionMsg.type === "success" ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{actionMsg.text}</span>
            </div>
            <button
              onClick={() => setActionMsg(null)}
              className="text-slate-400 hover:text-slate-700 font-bold ml-4"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content Area */}
      {loading && connections.length === 0 ? (
        <div className="py-20 text-center bg-white border border-slate-200/90 rounded-2xl shadow-xs">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading database connections...</p>
        </div>
      ) : connections.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 bg-white border border-dashed border-slate-300 rounded-2xl shadow-xs p-8"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">No database connections configured</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mb-5 leading-relaxed">
            Connect your target MySQL database to introspect eligible tables, inspect schemas, and configure automated publishing pipelines.
          </p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openCreateModal}
            className="btn-primary-gradient px-4 py-2.5 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Connect a Database</span>
          </motion.button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {connections.map((c) => {
            const dbName = (c as any).database_name || c.database || "";
            const currentStatus = (c as any).status || c.last_status || "connected";
            const isItemTesting = testingId === c.id;
            const isRefreshingSchema = refreshingSchemaId === c.id;
            const lastTested = (c as any).last_tested_at;
            const serverVersion = (c as any).server_version;
            const latencyMs = (c as any).latency_ms;

            return (
              <motion.div
                key={c.id}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="bg-white border border-slate-200 hover:border-indigo-300 rounded-xl p-5 flex flex-col justify-between transition-all shadow-xs hover:shadow-md hover:shadow-indigo-500/5 group"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 group-hover:scale-105 transition-transform">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                          {c.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-500 uppercase font-mono tracking-wider font-semibold">
                            {c.db_type || "mysql"}
                          </span>
                          {latencyMs && (
                            <span className="text-[10px] text-emerald-600 font-mono font-medium flex items-center gap-1">
                              <Activity className="w-2.5 h-2.5" />
                              {latencyMs}ms
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <StatusPill status={currentStatus} size="sm" />
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-700 py-3 border-y border-slate-100 my-3 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Host:</span>
                      <span className="font-medium text-slate-800">{c.host}:{c.port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Database:</span>
                      <span className="text-indigo-600 font-semibold">{dbName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">User:</span>
                      <span className="text-slate-800">{c.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Password:</span>
                      <span className="text-slate-400 flex items-center gap-1 font-sans">
                        <Lock className="w-3 h-3 text-slate-400" />
                        •••••••• (AES-256)
                      </span>
                    </div>
                    {serverVersion && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400 font-sans">Server:</span>
                        <span className="text-slate-600 font-mono">{serverVersion}</span>
                      </div>
                    )}
                    {lastTested && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400 font-sans">Last Checked:</span>
                        <span className="text-slate-500 font-sans">{new Date(lastTested).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestExisting(c.id)}
                      disabled={isItemTesting}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs flex items-center gap-1.5 border border-slate-200 transition font-medium shadow-2xs"
                      title="Test Live Connection"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isItemTesting ? "animate-spin text-indigo-600" : ""}`} />
                      <span>{isItemTesting ? "Testing..." : "Test"}</span>
                    </button>
                    <button
                      onClick={() => handleRefreshSchema(c.id)}
                      disabled={isRefreshingSchema}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs flex items-center gap-1.5 border border-slate-200 transition font-medium shadow-2xs"
                      title="Introspect and Refresh Schema"
                    >
                      <Layers className={`w-3.5 h-3.5 ${isRefreshingSchema ? "animate-spin text-indigo-600" : ""}`} />
                      <span>{isRefreshingSchema ? "Scanning..." : "Scan"}</span>
                    </button>
                    <Link
                      to={`/explorer?connectionId=${c.id}`}
                      className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs flex items-center gap-1.5 border border-indigo-200 transition font-medium shadow-2xs"
                    >
                      <TableProperties className="w-3.5 h-3.5" />
                      <span>Schema</span>
                    </Link>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(c)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
                      title="Edit Profile"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                      title="Delete Connection"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Connect Database Modal with Advanced Parameters & URI Mode */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 my-8"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingId ? "Edit Database Connection" : "Connect Customer Database"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Credentials are encrypted with managed AES-256 keys and never logged.
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-slate-400 hover:text-slate-700 p-1 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Engine Selection Cards */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Select Database Engine</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SUPPORTED_ENGINES.map((engine) => {
                    const isSelected = selectedEngine === engine.id;
                    const isAvailable = engine.status === "active";

                    return (
                      <div
                        key={engine.id}
                        onClick={() => {
                          if (isAvailable) {
                            setSelectedEngine(engine.id);
                            setForm((prev) => ({ ...prev, port: engine.port }));
                          }
                        }}
                        className={`p-3 rounded-xl border text-center transition-all select-none cursor-pointer ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20"
                            : isAvailable
                            ? "border-slate-200 hover:border-slate-300 bg-white"
                            : "border-slate-200 bg-slate-50/70 opacity-60 cursor-not-allowed"
                        }`}
                      >
                        <div className="font-bold text-xs text-slate-900 mb-1">{engine.name}</div>
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {engine.badge}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mode Toggle: Manual Parameters vs Connection URI */}
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setConnectionMode("manual")}
                  className={`pb-2 px-3 text-xs font-semibold border-b-2 transition ${
                    connectionMode === "manual"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Manual Parameters
                </button>
                <button
                  type="button"
                  onClick={() => setConnectionMode("uri")}
                  className={`pb-2 px-3 text-xs font-semibold border-b-2 transition ${
                    connectionMode === "uri"
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Connection URI / String
                </button>
              </div>

              <form onSubmit={handleSaveConnection} className="space-y-3.5 text-xs">
                {/* Connection Name */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Connection Display Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Primary Production CMS"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>

                {connectionMode === "uri" ? (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Database Connection URI</label>
                    <input
                      type="text"
                      required
                      placeholder="mysql://username:password@127.0.0.1:3306/database_name?sslmode=prefer"
                      value={form.connection_uri}
                      onChange={(e) => setForm({ ...form, connection_uri: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Supports standard MySQL connection strings. Credentials will be safely parsed and masked before persistence.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="col-span-2">
                        <label className="block text-slate-700 font-semibold mb-1">Host / Address</label>
                        <input
                          type="text"
                          required
                          placeholder="127.0.0.1 or db.example.com"
                          value={form.host}
                          onChange={(e) => setForm({ ...form, host: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Port</label>
                        <input
                          type="number"
                          required
                          placeholder="3306"
                          value={form.port}
                          onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 3306 })}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Database / Schema Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. demo_blog_cms"
                        value={form.database_name}
                        onChange={(e) => setForm({ ...form, database_name: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1">Username</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. root"
                          value={form.username}
                          onChange={(e) => setForm({ ...form, username: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-700 font-semibold mb-1 flex items-center justify-between">
                          <span>Password</span>
                          <span className="text-[10px] text-emerald-600 font-normal">Encrypted</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? "text" : "password"}
                            placeholder={editingId ? "Leave blank to keep existing" : "Database password"}
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 pr-9 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          >
                            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Advanced Settings Accordion */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full p-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-slate-700 font-semibold transition"
                  >
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                      Advanced Settings (TLS/SSL & Timeout)
                    </span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="p-3 bg-white space-y-3 border-t border-slate-200">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-700 font-semibold mb-1">TLS/SSL Mode</label>
                          <SearchableSelect
                            value={form.ssl_mode === "prefer" ? "preferred" : (form.ssl_mode === "require" ? "required" : (form.ssl_mode === "disable" ? "disabled" : (form.ssl_mode || "preferred")))}
                            onChange={(val) => setForm({ ...form, ssl_mode: String(val) })}
                            placeholder="Select TLS/SSL mode..."
                            options={[
                              { value: "preferred", label: "Prefer (Default)", badge: "Default" },
                              { value: "required", label: "Require (Enforce TLS)", badge: "Enforce TLS" },
                              { value: "disabled", label: "Disable", badge: "None" },
                            ]}
                          />
                        </div>
                        <div>
                          <label className="block text-slate-700 font-semibold mb-1">Timeout (Seconds)</label>
                          <input
                            type="number"
                            min="3"
                            max="60"
                            value={form.connection_timeout}
                            onChange={(e) => setForm({ ...form, connection_timeout: parseInt(e.target.value) || 10 })}
                            className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        SSRF policy prevents queries against AWS/GCP metadata services (169.254.169.254) and unrouteable subnets.
                      </p>
                    </div>
                  )}
                </div>

                {/* Staged Diagnostics Feedback */}
                {isTestingAdHoc && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs space-y-2"
                  >
                    <div className="flex items-center gap-2 font-bold text-indigo-900">
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                      <span>Executing Staged Connection Diagnostics...</span>
                    </div>
                    <div className="text-[11px] text-indigo-700 space-y-1 pl-5">
                      <div>1. Validating settings & IP safety rules...</div>
                      <div>2. Opening secure PDO handshake...</div>
                      <div>3. Verifying access privileges & server version...</div>
                      <div>4. Reading table metadata & foreign constraints...</div>
                    </div>
                  </motion.div>
                )}

                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3.5 rounded-xl border text-xs ${
                      testResult.success
                        ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
                        : "bg-rose-50/80 border-rose-200 text-rose-900"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="font-bold flex items-center gap-1.5">
                        {testResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600" />
                        )}
                        <span>{testResult.success ? "Connection Verified Successfully" : "Connection Verification Failed"}</span>
                      </div>
                      {testResult.latency_ms && (
                        <span className="font-mono text-[11px] font-semibold text-slate-500">
                          {testResult.latency_ms}ms round-trip
                        </span>
                      )}
                    </div>

                    {testResult.stages && testResult.stages.length > 0 ? (
                      <div className="space-y-1.5 pt-2 border-t border-slate-200/60 mt-1">
                        {testResult.stages.map((st: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-[11px]">
                            {st.status === "passed" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <strong className="text-slate-800">{st.stage}:</strong>{" "}
                              <span className="text-slate-600 font-mono text-[10px]">{st.detail}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] mt-1">{testResult.message}</div>
                    )}
                  </motion.div>
                )}

                {/* Modal Footer Controls */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleTestAdHoc}
                    disabled={isTestingAdHoc}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition flex items-center gap-1.5 shadow-2xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingAdHoc ? "animate-spin text-indigo-600" : ""}`} />
                    <span>{isTestingAdHoc ? "Testing..." : "Test Connection"}</span>
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-3.5 py-2 text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary-gradient px-4 py-2 text-white font-semibold rounded-lg shadow-xs"
                    >
                      {editingId ? "Update Profile" : "Save Profile"}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
