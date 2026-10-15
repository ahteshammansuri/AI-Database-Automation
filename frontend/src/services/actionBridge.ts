/**
 * ActionBridge - Typed Portal Operation Bridge
 * Allows the Agent control loop and live events to visibly operate the portal UI,
 * navigating routes, opening modal forms, typing into input fields, and triggering real tests and saves.
 */

export type ActionBridgeType =
  | "navigation.navigate"
  | "connections.open_create_form"
  | "connections.fill_fields"
  | "connections.trigger_test"
  | "connections.submit_save"
  | "connections.scan_schema"
  | "automations.navigate_create"
  | "automations.filter"
  | "automations.trigger_run"
  | "automations.create_draft"
  | "explorer.select_connection"
  | "explorer.select_table"
  | "knowledge.open_upload"
  | "providers.select_tab"
  | "providers.test_ollama"
  | string;

export type ActionExecutionStatus = "ok" | "not_mounted" | "validation_error" | "timeout" | "error";

export interface ActionResult<T = any> {
  status: ActionExecutionStatus;
  data?: T;
  error?: string;
}

export type ActionHandler<P = any, R = any> = (
  payload: P
) => ActionResult<R> | Promise<ActionResult<R>> | void | Promise<void>;

class ActionBridgeService {
  private handlers: Map<string, Set<ActionHandler>> = new Map();
  private pendingActions: Map<string, { payload: any; timestamp: number }> = new Map();

  /**
   * Subscribe to a typed portal UI action. Returns an unsubscribe cleanup function.
   * If there is an unconsumed pending action dispatched within the last 10 seconds, executes it immediately.
   */
  public on(action: ActionBridgeType, handler: ActionHandler): () => void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);

    // Replay any pending action that was dispatched before this component mounted
    const pending = this.pendingActions.get(action);
    if (pending && Date.now() - pending.timestamp < 10000) {
      this.pendingActions.delete(action);
      setTimeout(() => {
        try {
          handler(pending.payload);
        } catch (err) {
          console.error(`[ActionBridge] Error replaying pending action '${action}':`, err);
        }
      }, 50);
    }

    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  /**
   * Dispatch an authoritative action event asynchronously and receive execution confirmation.
   */
  public async dispatchAsync<T = any>(
    action: ActionBridgeType,
    payload?: any,
    timeoutMs = 4000
  ): Promise<ActionResult<T>> {
    console.log(`[ActionBridge] dispatchAsync '${action}':`, payload);
    const set = this.handlers.get(action);

    if (!set || set.size === 0) {
      console.warn(`[ActionBridge] No active listeners mounted for '${action}', buffering for mount.`);
      this.pendingActions.set(action, { payload, timestamp: Date.now() });
      return {
        status: "ok",
        data: undefined,
      };
    }

    const handler = Array.from(set)[0];

    try {
      const resultPromise = Promise.resolve(handler(payload));
      const timeoutPromise = new Promise<ActionResult<T>>((_, reject) =>
        setTimeout(() => reject(new Error(`Action '${action}' timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      const res = await Promise.race([resultPromise, timeoutPromise]);
      if (res && typeof res === "object" && "status" in res) {
        return res as ActionResult<T>;
      }
      return { status: "ok" };
    } catch (err: any) {
      if (err?.message?.includes("timed out")) {
        return { status: "timeout", error: err.message };
      }
      return { status: "error", error: err?.message || String(err) };
    }
  }

  /**
   * Dispatch a fire-and-forget action event to all registered UI component listeners.
   * If no listeners are currently mounted (e.g. during page navigation), buffers the action.
   */
  public dispatch(action: ActionBridgeType, payload?: any): void {
    console.log(`[ActionBridge] Dispatching action '${action}':`, payload);
    const set = this.handlers.get(action);
    if (set && set.size > 0) {
      set.forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[ActionBridge] Error executing handler for '${action}':`, err);
        }
      });
    } else {
      console.log(`[ActionBridge] No active listeners for action '${action}' - buffering pending mount.`);
      this.pendingActions.set(action, { payload, timestamp: Date.now() });
    }
  }
}

export const actionBridge = new ActionBridgeService();
