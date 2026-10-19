import { useEffect, useRef } from "react";
import { useLiveEvents } from "../context/LiveEventsContext";

/**
 * Reload a page's data when one of Orbit's backend tools changed it (for example Orbit removed a
 * document with remove_knowledge_document instead of the on-screen button), so the screen always
 * shows the real state.
 */
export function useRefreshAfterOrbit(tools: string[], reload: () => void) {
  const { addListener } = useLiveEvents();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const key = tools.join(",");
  useEffect(() => {
    const names = new Set(key.split(","));
    return addListener((event) => {
      const p: any = event.payload || {};
      if (event.event_name === "agent.tool_finished" && p.success && names.has(p.tool)) reloadRef.current();
    });
  }, [addListener, key]);
}
