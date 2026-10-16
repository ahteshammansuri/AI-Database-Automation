import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { api, clearApiCache } from "../services/api";
import { useToast } from "./ToastContext";
import { useAuth } from "./AuthContext";
import { getEcho, disconnectEcho } from "../services/echo";

export interface WorkspaceLiveEvent {
  id: number;
  user_id: number;
  event_name: string;
  payload: any;
  resource_type?: string;
  resource_id?: string;
  created_at: string;
}

interface LiveEventsContextType {
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  lastEvent: WorkspaceLiveEvent | null;
  addListener: (callback: (event: WorkspaceLiveEvent) => void) => () => void;
  reconnect: () => void;
  /** Poll quickly (for live agent choreography) while enabled; normal cadence otherwise. */
  setFastPolling: (enabled: boolean) => void;
}

const NORMAL_POLL_MS = 15000;
const FAST_POLL_MS = 4000;

const LiveEventsContext = createContext<LiveEventsContextType>({
  status: "disconnected",
  lastEvent: null,
  addListener: () => () => {},
  reconnect: () => {},
  setFastPolling: () => {},
});

export const LiveEventsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<"connected" | "connecting" | "reconnecting" | "disconnected">("disconnected");
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<WorkspaceLiveEvent | null>(null);
  const listenersRef = useRef<Set<(event: WorkspaceLiveEvent) => void>>(new Set());
  const lastEventIdRef = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
  const pollTimerRef = useRef<any>(null);
  const baselineReadyRef = useRef<boolean>(false);
  const [fastPolling, setFastPolling] = useState<boolean>(false);

  const { toast } = useToast();

  const handleLiveEventAlert = useCallback((event: WorkspaceLiveEvent) => {
    const { event_name, payload } = event;

    // Automatically trigger animated toasts for key lifecycle events
    if (event_name === "execution.created") {
      toast.info("Execution Queued", `Automation #${payload.automation_id || ""} queued for fair dispatch.`);
    } else if (event_name === "execution.stage_changed") {
      toast.info(`Execution Stage: ${payload.status}`, `Run #${payload.execution_id} progressed to ${payload.status}`);
    } else if (event_name === "execution.published") {
      toast.success("Content Published!", `Record #${payload.target_record_id || ""} written to target database.`);
    } else if (event_name === "execution.failed") {
      toast.error("Execution Failed", payload.reason || "An error occurred during execution.");
    } else if (event_name === "connection.tested") {
      if (payload.success) {
        toast.success("Database Connected", `Server: ${payload.server_version || "MySQL"} (${payload.latency_ms || 10}ms)`);
      } else {
        toast.error("Connection Failed", payload.message || "Could not reach target database.");
      }
    } else if (event_name === "connection.schema_refreshed") {
      toast.success("Schema Rescanned", `Discovered ${payload.tables_discovered || 0} tables.`);
    }
  }, [toast]);

  const dispatchEvent = useCallback((event: WorkspaceLiveEvent) => {
    if (event.id > lastEventIdRef.current) {
      lastEventIdRef.current = event.id;
    }
    setLastEvent(event);

    // Invalidate API cache so UI shows fresh state on next access
    if (event.event_name?.startsWith("execution.")) {
      clearApiCache("/executions");
      clearApiCache("/dashboard/stats");
    } else if (event.event_name?.startsWith("connection.")) {
      clearApiCache("/connections");
      clearApiCache("/schema");
    }

    // Trigger sweet toast notification
    handleLiveEventAlert(event);

    // Notify registered component listeners
    listenersRef.current.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error("Error in live event listener:", err);
      }
    });
  }, [handleLiveEventAlert]);

  const addListener = useCallback((callback: (event: WorkspaceLiveEvent) => void) => {
    listenersRef.current.add(callback);
    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  const pollEvents = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setStatus("disconnected");
      return;
    }

    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      if (!baselineReadyRef.current) {
        // Start from "now": history is never replayed into a fresh page.
        const base: any = await api.getLiveEventsBaseline();
        lastEventIdRef.current = Number(base?.latest_id || 0);
        baselineReadyRef.current = true;
        setStatus("connected");
        return;
      }
      const res: any = await api.getLiveEvents(lastEventIdRef.current);
      const raw: any[] = Array.isArray(res?.events) ? res.events : Array.isArray(res) ? res : [];
      // The API names the field event_type; listeners use event_name.
      const items: WorkspaceLiveEvent[] = raw.map((e) => ({ ...e, event_name: e.event_name ?? e.event_type }));

      if (items.length > 0) {
        items.forEach(dispatchEvent);
      } else if (res?.latest_id && res.latest_id > lastEventIdRef.current) {
        lastEventIdRef.current = res.latest_id;
      }
      setStatus("connected");
    } catch {
      setStatus("reconnecting");
    } finally {
      isPollingRef.current = false;
    }
  }, [dispatchEvent]);

  // 1. Establish real-time push connection via Laravel Reverb WebSockets
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      disconnectEcho();
      setWsConnected(false);
      return;
    }

    const echo = getEcho();
    if (!echo) return;

    const channelName = `workspace.${user.id}`;
    const channel = echo.private(channelName);

    channel.listen(".workspace.event", (event: any) => {
      const mapped: WorkspaceLiveEvent = {
        id: event.id || Date.now(),
        user_id: user.id,
        event_name: event.event_name || event.event_type || "workspace.event",
        payload: event.payload || {},
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        created_at: event.created_at || new Date().toISOString(),
      };
      dispatchEvent(mapped);
    });

    const pusher = (echo.connector as any)?.pusher;
    if (pusher?.connection) {
      const onConnected = () => {
        setStatus("connected");
        setWsConnected(true);
      };
      const onDisconnected = () => {
        setWsConnected(false);
      };
      const onError = () => {
        setWsConnected(false);
      };

      pusher.connection.bind("connected", onConnected);
      pusher.connection.bind("disconnected", onDisconnected);
      pusher.connection.bind("error", onError);

      if (pusher.connection.state === "connected") {
        setStatus("connected");
        setWsConnected(true);
      }

      return () => {
        pusher.connection.unbind("connected", onConnected);
        pusher.connection.unbind("disconnected", onDisconnected);
        pusher.connection.unbind("error", onError);
        channel.stopListening(".workspace.event");
        echo.leave(channelName);
      };
    }

    return () => {
      channel.stopListening(".workspace.event");
      echo.leave(channelName);
    };
  }, [user?.id, isAuthenticated, dispatchEvent]);

  // 2. HTTP Polling Fallback (Only active if WebSockets are offline or before initial baseline)
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token || !isAuthenticated) {
      setStatus("disconnected");
      return;
    }

    // Initial baseline fetch
    if (!baselineReadyRef.current) {
      pollEvents();
    }

    // If Reverb WebSocket is actively connected, completely disable HTTP polling (0 polling requests)
    if (wsConnected) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    // Fallback: If WebSocket is disconnected, poll at relaxed intervals
    const intervalMs = fastPolling ? FAST_POLL_MS : NORMAL_POLL_MS;
    pollTimerRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        pollEvents();
      }
    }, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pollEvents();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pollEvents, fastPolling, wsConnected, isAuthenticated]);

  return (
    <LiveEventsContext.Provider
      value={{
        status,
        lastEvent,
        addListener,
        reconnect: pollEvents,
        setFastPolling,
      }}
    >
      {children}
    </LiveEventsContext.Provider>
  );
};

export const useLiveEvents = () => useContext(LiveEventsContext);
