import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { api, clearApiCache } from "../services/api";
import { useToast } from "./ToastContext";

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
}

const LiveEventsContext = createContext<LiveEventsContextType>({
  status: "disconnected",
  lastEvent: null,
  addListener: () => () => {},
  reconnect: () => {},
});

export const LiveEventsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<"connected" | "connecting" | "reconnecting" | "disconnected">("disconnected");
  const [lastEvent, setLastEvent] = useState<WorkspaceLiveEvent | null>(null);
  const listenersRef = useRef<Set<(event: WorkspaceLiveEvent) => void>>(new Set());
  const lastEventIdRef = useRef<number>(0);
  const isPollingRef = useRef<boolean>(false);
  const pollTimerRef = useRef<any>(null);

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
      const res: any = await api.getLiveEvents(lastEventIdRef.current);
      const items: WorkspaceLiveEvent[] = Array.isArray(res?.events)
        ? res.events
        : Array.isArray(res)
        ? res
        : [];

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

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setStatus("disconnected");
      return;
    }

    setStatus("connected");
    // Initial fetch to establish baseline latest_id
    pollEvents();

    const intervalMs = 3500;
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

    const handleStorageChange = () => {
      pollEvents();
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [pollEvents]);

  return (
    <LiveEventsContext.Provider
      value={{
        status,
        lastEvent,
        addListener,
        reconnect: pollEvents,
      }}
    >
      {children}
    </LiveEventsContext.Provider>
  );
};

export const useLiveEvents = () => useContext(LiveEventsContext);
