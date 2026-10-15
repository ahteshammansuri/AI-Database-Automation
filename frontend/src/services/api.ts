import { redactSecretsFromUtterance } from "./secretRedactor";

const BASE_URL = "/api";

interface CacheEntry {
  data: any;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 25000; // 25 seconds fast cache for instant tab switching

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    memoryCache.clear();
  } else {
    for (const key of memoryCache.keys()) {
      if (key.includes(prefix)) {
        memoryCache.delete(key);
      }
    }
  }
}

interface RequestOptions extends RequestInit {
  forceRefresh?: boolean;
}

// Live state must never be served from the memory cache (event polling, Orbit task state).
const UNCACHED_PREFIXES = ["/live/", "/agent/"];

async function request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  const isRead = !options?.method || options.method.toUpperCase() === "GET";
  const isGet = isRead && !UNCACHED_PREFIXES.some((p) => endpoint.startsWith(p));
  const cacheKey = `${endpoint}_${localStorage.getItem("auth_token") || "anon"}`;

  // Serve from instant memory cache if fresh GET
  if (isGet && !options?.forceRefresh) {
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const url = `${BASE_URL}${endpoint}`;
  const token = localStorage.getItem("auth_token");

  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMsg = `Request failed with status ${response.status}`;
    try {
      const errData = await response.json();
      if (errData?.message) {
        errMsg = errData.message;
      } else if (errData?.error) {
        errMsg = typeof errData.error === "string" ? errData.error : JSON.stringify(errData.error);
      } else if (errData?.errors) {
        const firstKey = Object.keys(errData.errors)[0];
        errMsg = errData.errors[firstKey][0] || errMsg;
      }
    } catch {
      // Ignore non-json body error
    }
    throw new Error(errMsg);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json();

  // Store in cache if GET request
  if (isGet) {
    memoryCache.set(cacheKey, { data, timestamp: Date.now() });
  } else if (!isRead && !endpoint.startsWith("/agent/heartbeat") && !endpoint.startsWith("/agent/ui-actions/")) {
    // Invalidate cache on mutations (Orbit heartbeats/acks change no portal data)
    clearApiCache();
  }

  return data;
}

export const api = {
  // Auth
  register: (data: any) => request<any>("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data: any) => request<any>("/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => request<any>("/auth/logout", { method: "POST" }),
  me: () => request<any>("/auth/me"),

  // Stats & Dashboard
  getStats: (range = "7d") => request<any>(`/dashboard/stats?range=${encodeURIComponent(range)}`),
  getHealth: () => request<any>("/ai-providers/health"),

  // Database Connections
  listConnections: () => request<any[]>("/connections"),
  getConnection: (id: number) => request<any>(`/connections/${id}`),
  createConnection: (data: any) => request<any>("/connections", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      database_name: data.database_name || data.database,
      db_type: data.db_type || "mysql",
    }),
  }),
  updateConnection: (id: number, data: any) => request<any>(`/connections/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...data,
      database_name: data.database_name || data.database,
    }),
  }),
  deleteConnection: (id: number) => request<any>(`/connections/${id}`, { method: "DELETE" }),
  testConnection: (id: number) => request<any>("/connections/test", { method: "POST", body: JSON.stringify({ id }) }),
  testAdHocConnection: (data: any) => request<any>("/connections/test", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      database_name: data.database_name || data.database,
    }),
  }),

  // Schema Discovery
  getSchema: (id: number) => request<any>(`/connections/${id}/schema`),
  refreshSchema: (id: number) => request<any>(`/connections/${id}/refresh-schema`, { method: "POST" }),
  getLookupValues: (connectionId: number, table: string, search?: string) =>
    request<any[]>(`/connections/${connectionId}/lookup-values?table=${encodeURIComponent(table)}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  annotateTable: (connectionId: number, table: string, data: any) =>
    request<any>(`/connections/${connectionId}/tables/${encodeURIComponent(table)}/annotate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  proposeAutomationPlan: (dataOrConnId: { connection_id: number; prompt: string; provider?: string; model?: string } | number, prompt?: string) => {
    const payload = typeof dataOrConnId === "number"
      ? { connection_id: dataOrConnId, prompt: prompt || "" }
      : dataOrConnId;
    return request<any>("/automations/propose-plan", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // AI Providers & Models
  listAIProviders: () => request<any[]>("/ai-providers"),
  saveAIProvider: (data: any) => request<any>("/ai-providers", { method: "POST", body: JSON.stringify(data) }),
  testAIProvider: (providerId: string) => request<any>(`/ai-providers/health?provider=${encodeURIComponent(providerId)}`),
  checkAIProviderHealth: (provider: string, model?: string) =>
    request<any>(`/ai-providers/health?provider=${encodeURIComponent(provider)}${model ? `&model=${encodeURIComponent(model)}` : ""}`),
  
  // Role-Based AI Model Assignments
  listModelRoles: () => request<{ success: boolean; roles: any[] }>("/model-roles"),
  updateModelRole: (data: {
    role: string;
    provider: string;
    model_name: string;
    temperature?: number;
    max_tokens?: number;
    is_active?: boolean;
  }) => request<any>("/model-roles", { method: "PUT", body: JSON.stringify(data) }),
  probeModelRole: (data: { provider: string; model_name?: string }) =>
    request<any>("/model-roles/probe", { method: "POST", body: JSON.stringify(data) }),

  previewAIGeneration: (data: any) =>
    request<any>("/automations/preview-ai", { method: "POST", body: JSON.stringify(data) }),
  fieldAssist: (data: {
    field_name: string;
    action: "generate" | "improve" | "shorten" | "expand" | "change_tone" | "regenerate";
    current_value?: string;
    topic?: string;
    tone?: string;
    target_table?: string;
    provider?: string;
    model?: string;
  }) => request<{
    success: boolean;
    field_name: string;
    action: string;
    suggested_value: string;
    explanation: string;
  }>("/automations/field-assist", { method: "POST", body: JSON.stringify(data) }),

  // Knowledge Base (RAG)
  listKnowledge: () => request<any[]>("/knowledge"),
  uploadKnowledge: async (title: string, file: File) => {
    const formData = new FormData();
    if (title) formData.append("title", title);
    formData.append("file", file);
    return request<any>("/knowledge/upload", {
      method: "POST",
      body: formData,
    });
  },
  deleteKnowledge: (id: number) => request<any>(`/knowledge/${id}`, { method: "DELETE" }),
  queryKnowledge: (query: string, topK = 3) =>
    request<any>("/knowledge/query", {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK }),
    }),

  // Automations
  listAutomations: () => request<any[]>("/automations"),
  getAutomation: (id: number) => request<any>(`/automations/${id}`),
  createAutomation: (data: any) => request<any>("/automations", { method: "POST", body: JSON.stringify(data) }),
  updateAutomation: (id: number, data: any) => request<any>(`/automations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAutomation: (id: number) => request<any>(`/automations/${id}`, { method: "DELETE" }),
  triggerAutomation: (id: number) => request<any>(`/automations/${id}/trigger`, { method: "POST" }),

  // Executions
  listExecutions: (page = 1, pageSize = 25, status?: string) =>
    request<any>(`/executions?page=${page}${status ? `&status=${status}` : ""}`),
  getExecution: (id: number) => request<any>(`/executions/${id}`),
  publishNow: (id: number) => request<any>(`/executions/${id}/publish-now`, { method: "POST" }),
  retryExecution: (id: number) => request<any>(`/executions/${id}/retry`, { method: "POST" }),
  cancelExecution: (id: number) => request<any>(`/executions/${id}/cancel`, { method: "POST" }),
  pauseExecution: (id: number) => request<any>(`/executions/${id}/pause`, { method: "POST" }),
  resumeExecution: (id: number) => request<any>(`/executions/${id}/resume`, { method: "POST" }),
  updatePublishedRecord: (id: number, payload: Record<string, any>) =>
    request<any>(`/executions/${id}/update-record`, {
      method: "POST",
      body: JSON.stringify({ payload }),
    }),
  getLiveEvents: (sinceId?: number) => request<any[]>(`/live/events${sinceId ? `?since_id=${sinceId}` : ""}`),
  getLiveEventsBaseline: () => request<any>("/live/events?baseline=1"),
  scheduleManual: (data: any) => request<any>("/automations", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      operation_mode: "MANUAL_SCHEDULE",
    })
  }),
  manualPublish: (data: {
    connection_id: number;
    target_table: string;
    payload: Record<string, any>;
    publish_now?: boolean;
    scheduled_time?: string;
    name?: string;
  }) => request<any>("/automations/manual-publish", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  // Approvals & Decisions
  listApprovals: () => request<any[]>("/approvals"),
  getApprovalPreview: (token: string) => request<any>(`/approvals/${token}`),
  submitApprovalAction: (token: string, action: "APPROVE" | "REJECT", feedback?: string) => {
    if (action === "APPROVE") {
      return request<any>(`/approvals/${token}/approve`, { method: "POST" });
    }
    return request<any>(`/approvals/${token}/reject`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
  },
  updateApprovalPayload: (versionId: number, payload: Record<string, any>) =>
    request<any>(`/approvals/${versionId}/payload`, {
      method: "PUT",
      body: JSON.stringify({ payload }),
    }),
  portalApprove: (versionId: number, options?: { publish_now?: boolean; payload?: Record<string, any> }) =>
    request<any>(`/approvals/${versionId}/portal-approve`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    }),
  portalReject: (versionId: number, feedback?: string) =>
    request<any>(`/approvals/${versionId}/portal-reject`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    }),

  // Audit Logs
  listAuditLogs: () => request<any[]>("/audit-logs"),

  // Autonomous AI Agent Assistant
  listAgentConversations: () => request<any>("/agent/conversations"),
  createAgentConversation: (title?: string) =>
    request<any>("/agent/conversations", {
      method: "POST",
      body: JSON.stringify({ title: title || "New Consultation" }),
    }),
  getAgentConversation: (id: number) => request<any>(`/agent/conversations/${id}`),
  postAgentMessage: (id: number, content: string, isVoice = false, secureInputData?: any, pageContext?: any) => {
    const { redactedText, hasRedaction, extractedSecrets } = redactSecretsFromUtterance(content);
    const mergedSecure = {
      ...(hasRedaction ? extractedSecrets : {}),
      ...(secureInputData || {}),
    };
    return request<any>(`/agent/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: redactedText,
        is_voice: isVoice,
        secure_input_data: Object.keys(mergedSecure).length > 0 ? mergedSecure : undefined,
        page_context: pageContext,
      }),
    });
  },
  interruptAgentTask: (taskId: number, action: "STOP" | "PAUSE" | "RESUME" = "STOP") =>
    request<any>(`/agent/tasks/${taskId}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  correctAgentTask: (taskId: number, correction: string) =>
    request<any>(`/agent/tasks/${taskId}/correct`, {
      method: "POST",
      body: JSON.stringify({ correction }),
    }),
  confirmAgentTask: (taskId: number) =>
    request<any>(`/agent/tasks/${taskId}/confirm`, {
      method: "POST",
    }),
  getAgentTask: (taskId: number) => request<any>(`/agent/tasks/${taskId}`),
  getAgentTaskTimeline: (taskId: number) => request<any>(`/agent/tasks/${taskId}/timeline`),
  getAgentPreferences: () => request<any>("/agent/preferences"),
  updateAgentPreferences: (prefs: { autonomy_level?: string; voice_enabled?: boolean; preferred_model?: string }) =>
    request<any>("/agent/preferences", {
      method: "PUT",
      body: JSON.stringify(prefs),
    }),
  listAgentTools: () => request<any>("/agent/tools"),
  ackAgentUiAction: (correlationId: string, status: string, result: Record<string, any> = {}) =>
    request<any>(`/agent/ui-actions/${encodeURIComponent(correlationId)}/ack`, {
      method: "POST",
      body: JSON.stringify({ status, result }),
    }),
  agentHeartbeat: () => request<any>("/agent/heartbeat", { method: "POST", body: "{}" }),
  getAgentSurfaces: () => request<any>("/agent/surfaces"),
  continueAgentTask: (taskId: number, body: { surface: string; field: string; page_context?: any }) =>
    request<any>(`/agent/tasks/${taskId}/continue`, { method: "POST", body: JSON.stringify(body) }),

  clearCache: clearApiCache,
};
