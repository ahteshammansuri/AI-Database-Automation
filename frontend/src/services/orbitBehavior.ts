/**
 * Orbit's character state as a pure function of real runtime state.
 * Operational states (thinking, working, success, error...) come only from server
 * task status / turn stage; nothing here is driven by timers.
 */

export const ACTIVE_TASK_STATUSES = ["QUEUED", "RUNNING", "PAUSE_REQUESTED", "INTERRUPT_REQUESTED"];
export const TERMINAL_STATUSES = ["SUCCEEDED", "ANSWERED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED", "SUPERSEDED"];

export interface BehaviorInput {
  taskStatus?: string | null;
  turnStage?: string | null;
  sending: boolean;
  speaking: boolean;
  runningTool?: string | null;
  speechEmotion?: string | null;
  serviceError?: boolean;
  localState?: string;
}

export function deriveCharacterState(i: BehaviorInput): string {
  const status = i.taskStatus ?? null;
  if (i.sending) return "understanding";
  if (status && ACTIVE_TASK_STATUSES.includes(status)) {
    if (status === "INTERRUPT_REQUESTED") return "interrupted";
    if (status === "PAUSE_REQUESTED") return "paused";
    if (i.turnStage === "CALLING_TOOL") return i.runningTool?.startsWith("scan") ? "processing" : "working";
    return "thinking";
  }
  if (i.speaking) return "speaking";
  switch (status) {
    case "WAITING_FOR_INPUT":
      return "waiting_for_user";
    case "WAITING_FOR_APPROVAL":
      return "needs_confirmation";
    case "PAUSED":
      return "paused";
    case "SUCCEEDED":
      return i.speechEmotion === "celebrating" ? "celebrate" : "success";
    case "PARTIAL_SUCCESS":
      return "warning";
    case "FAILED":
      return i.serviceError ? "offline" : "error";
    case "CANCELLED":
      return "cancelled";
  }
  return i.localState || "idle";
}

export interface TimelineRow {
  id: number;
  task_id: number;
  step_name: string;
  status: string;
  message: string;
  details?: any;
  created_at: string;
}

/**
 * What the timeline shows: a tool's "running" row is replaced by its finished row (same
 * trace_id), and once the turn is over nothing is left spinning.
 */
export function collapseTimeline(rows: TimelineRow[], taskActive: boolean): TimelineRow[] {
  const out: TimelineRow[] = [];
  const indexByTrace = new Map<string, number>();
  for (const row of rows) {
    const trace = row.details?.trace_id;
    if (trace && indexByTrace.has(trace)) {
      out[indexByTrace.get(trace)!] = row;
      continue;
    }
    if (trace) indexByTrace.set(trace, out.length);
    out.push(row);
  }
  return taskActive ? out : out.map((r) => (r.status === "running" ? { ...r, status: "stopped" } : r));
}

/** One short line describing what Orbit is doing (Orbit panel header, and the phone in Orbit Remote). */
export function stageText(stage: string | null, tool: string | null | undefined, status: string | undefined,
  queue?: { ahead: number; worker_alive: boolean } | null): string {
  if (status === "QUEUED" && queue) {
    if (!queue.worker_alive) return "Waiting — no Orbit worker is running";
    if (queue.ahead > 0) return `Waiting behind ${queue.ahead} other Orbit task${queue.ahead > 1 ? "s" : ""}`;
    return "Starting now";
  }
  switch (stage) {
    case "QUEUED":
      return "Queued";
    case "UNDERSTANDING":
      return "Reading your request";
    case "THINKING":
      return "Thinking";
    case "CALLING_TOOL":
      return tool ? `Working: ${tool}` : "Working";
  }
  switch (status) {
    case "WAITING_FOR_INPUT":
      return "Waiting for your answer";
    case "WAITING_FOR_APPROVAL":
      return "Waiting for your confirmation";
    case "PAUSED":
      return "Paused";
    case "SUCCEEDED":
      return "Done — verified";
    case "PARTIAL_SUCCESS":
      return "Partly done";
    case "FAILED":
      return "Could not finish";
    case "CANCELLED":
      return "Stopped";
    case "INTERRUPT_REQUESTED":
      return "Stopping at the next safe step";
    case "PAUSE_REQUESTED":
      return "Pausing at the next safe step";
  }
  return "Ready";
}
