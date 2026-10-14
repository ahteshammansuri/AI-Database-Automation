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
  | "automations.create_draft"
  | string;

export interface ActionBridgeEvent {
  action: ActionBridgeType;
  payload?: any;
  timestamp: string;
}

type ActionHandler = (payload: any) => void | Promise<void>;

class ActionBridgeService {
  private handlers: Map<string, Set<ActionHandler>> = new Map();

  /**
   * Subscribe to a typed portal UI action. Returns an unsubscribe cleanup function.
   */
  public on(action: ActionBridgeType, handler: ActionHandler): () => void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);

    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  /**
   * Dispatch an authoritative action event to all registered UI component listeners.
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
      console.log(`[ActionBridge] No active listeners for action '${action}'.`);
    }
  }
}

export const actionBridge = new ActionBridgeService();
