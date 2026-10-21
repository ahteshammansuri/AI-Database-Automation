/** Text helpers for the speech bubble beside Orbit. */

const BUBBLE_MAX_CHARS = 170;

/** Plain, short text for the bubble: no markdown, cut at a word boundary. */
export function bubbleText(raw: string, max = BUBBLE_MAX_CHARS): { text: string; truncated: boolean } {
  const plain = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+])\s+/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return { text: plain, truncated: false };
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:]$/, "")}…`, truncated: true };
}

export type BubbleKind = "caption" | "confirm" | "question" | "working" | "reply" | "error";

export interface Bubble {
  /** Identity of this message; a dismissed or expired key stays hidden. */
  key: string;
  kind: BubbleKind;
  text: string;
  /** Label of the button that opens Orbit's panel, if any. */
  action?: string;
  /** Milliseconds before it hides by itself; undefined = stays while the state lasts. */
  ttlMs?: number;
}

export interface BubbleInput {
  caption: { key: string; text: string } | null;
  taskId: number | null;
  status: string | null;
  awaitingConfirmationTool: string | null;
  speech: { messageId: number | null; text: string; isServiceError: boolean } | null;
  narration: string | null;
  runningStep: string | null;
  queue: { ahead: number; worker_alive: boolean } | null;
}

/**
 * What the bubble shows, by priority: show-me caption, pending confirmation, open question, current
 * work, then the latest reply. All text comes from the server (model speech, narration, step labels).
 */
export function pickBubble(s: BubbleInput): Bubble | null {
  const speech = s.speech?.text ? bubbleText(s.speech.text) : null;
  if (s.caption) {
    return { key: s.caption.key, kind: "caption", text: bubbleText(s.caption.text).text,
      ttlMs: Math.min(11000, Math.max(4000, 3000 + s.caption.text.length * 55)) };
  }
  if (s.awaitingConfirmationTool && s.taskId !== null) {
    return {
      key: `confirm:${s.taskId}:${s.speech?.messageId ?? ""}`,
      kind: "confirm",
      text: speech?.text || `Waiting for your OK before: ${s.awaitingConfirmationTool.replace(/_/g, " ")}.`,
      action: "Open to confirm",
    };
  }
  if (s.status === "WAITING_FOR_INPUT" && speech && s.taskId !== null) {
    return { key: `question:${s.taskId}:${s.speech?.messageId ?? ""}`, kind: "question", text: speech.text, action: "Reply" };
  }
  if (s.status === "QUEUED" || s.status === "RUNNING") {
    const queued = s.queue
      ? (!s.queue.worker_alive ? "Waiting for the Orbit worker to start." : s.queue.ahead > 0 ? `Queued: ${s.queue.ahead} request(s) ahead of yours.` : "Starting…")
      : null;
    const text = s.narration ? bubbleText(s.narration).text : s.runningStep ?? queued;
    return text ? { key: `working:${s.taskId}`, kind: "working", text } : null;
  }
  if (s.speech && speech) {
    return {
      key: `reply:${s.speech.messageId ?? "local"}:${s.speech.text.slice(0, 24)}`,
      kind: s.speech.isServiceError ? "error" : "reply",
      text: speech.text,
      action: speech.truncated ? "Read more" : undefined,
      ttlMs: Math.min(14000, 5000 + speech.text.length * 45),
    };
  }
  return null;
}
