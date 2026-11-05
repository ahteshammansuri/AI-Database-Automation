import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { TableInsight } from "../components/automation/fieldPlan";

/**
 * The customer's AI model reading a table (what columns hold, what codes mean, where images go): starts the reading
 * when the table is opened, checks back while it runs, and calls `onReady` once new results are in so the page can
 * reload what it shows. `reread` asks for a fresh reading.
 */
export function useTableInsight(connectionId: number | null, table: string | null | undefined, onReady?: () => void) {
  const [insight, setInsight] = useState<TableInsight | null>(null);
  const ready = useRef(onReady);
  useEffect(() => { ready.current = onReady; });
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async (again = false) => {
    if (!connectionId || !table) return;
    try {
      const res: TableInsight = await api.tableInsights(connectionId, table, again);
      setInsight(res);
      if (lastStatus.current === "pending" && res.status !== "pending") ready.current?.();
      lastStatus.current = res.status;
    } catch {
      setInsight(null);
    }
  }, [connectionId, table]);

  useEffect(() => {
    lastStatus.current = null;
    setInsight(null);
    load();
  }, [load]);

  useEffect(() => {
    if (insight?.status !== "pending") return;
    const t = setTimeout(() => load(), 8000);
    return () => clearTimeout(t);
  }, [insight, load]);

  return { insight, reread: () => { lastStatus.current = "pending"; return load(true); } };
}
