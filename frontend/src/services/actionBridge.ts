/**
 * ActionBridge — typed, allowlisted portal operations Orbit can perform.
 *
 * Pages register handlers for semantic actions (open the real form, set controlled
 * field state, press a control...). Handlers return a typed result that is reported
 * back to the server as the acknowledgement. Nothing is reported as done unless a
 * mounted handler actually ran: if no handler mounts in time the result is
 * "not_mounted", never "ok".
 */

/** Internal page-level actions used by the Orbit runtime (surfaces cover everything else). */
export const ORBIT_UI_ACTIONS = ["navigation.navigate", "ui.focus_target"] as const;

export type ActionBridgeType = (typeof ORBIT_UI_ACTIONS)[number] | (string & {});

export type ActionExecutionStatus = "ok" | "not_mounted" | "validation_error" | "timeout" | "error";

export interface ActionResult<T = any> {
  status: ActionExecutionStatus;
  data?: T;
  errors?: Record<string, string> | string[];
  error?: string;
}

export type ActionHandler<P = any, R = any> = (payload: P) => ActionResult<R> | Promise<ActionResult<R>> | void | Promise<void>;

class ActionBridgeService {
  private handlers = new Map<string, ActionHandler>();
  private mountListeners = new Set<() => void>();

  /** Register the handler for an action (the most recently mounted page wins). */
  public on(action: ActionBridgeType, handler: ActionHandler): () => void {
    this.handlers.set(action, handler);
    this.mountListeners.forEach((l) => l());
    return () => {
      if (this.handlers.get(action) === handler) {
        this.handlers.delete(action);
      }
    };
  }

  public isMounted(action: ActionBridgeType): boolean {
    return this.handlers.has(action);
  }

  private waitForHandler(action: string, timeoutMs: number): Promise<ActionHandler | null> {
    const existing = this.handlers.get(action);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.mountListeners.delete(check);
        resolve(null);
      }, timeoutMs);
      const check = () => {
        const h = this.handlers.get(action);
        if (h) {
          clearTimeout(timer);
          this.mountListeners.delete(check);
          resolve(h);
        }
      };
      this.mountListeners.add(check);
    });
  }

  /**
   * Run an action and report its real outcome. Waits (bounded) for the page that owns
   * the action to mount, e.g. right after a navigation.
   */
  public async dispatchAsync<T = any>(
    action: ActionBridgeType,
    payload?: any,
    opts: { mountTimeoutMs?: number; timeoutMs?: number } = {}
  ): Promise<ActionResult<T>> {
    if (!(ORBIT_UI_ACTIONS as readonly string[]).includes(action)) {
      return { status: "error", error: `Action '${action}' is not allowlisted.` };
    }
    const handler = await this.waitForHandler(action, opts.mountTimeoutMs ?? 2500);
    if (!handler) {
      return { status: "not_mounted", error: `No mounted handler for '${action}'.` };
    }
    try {
      const timeoutMs = opts.timeoutMs ?? 4000;
      const res = await Promise.race([
        Promise.resolve(handler(payload)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      if (res && typeof res === "object" && "status" in res) {
        return res as ActionResult<T>;
      }
      return { status: "ok" };
    } catch (err: any) {
      if (err?.message === "timeout") return { status: "timeout", error: `Action '${action}' timed out.` };
      return { status: "error", error: err?.message || String(err) };
    }
  }

  /** Fire-and-forget convenience for local UI use. */
  public dispatch(action: ActionBridgeType, payload?: any): void {
    void this.dispatchAsync(action, payload);
  }
}

export const actionBridge = new ActionBridgeService();
