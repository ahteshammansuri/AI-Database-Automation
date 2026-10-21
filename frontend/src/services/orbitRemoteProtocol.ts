/**
 * Orbit Remote protocol: what the signed-in tab and a paired phone exchange, and the pure rules both sides use.
 * No imports, so the node test runner loads it directly.
 *
 * Channel `private-orbit-remote.{sessionId}` (Reverb):
 *  - server  -> both : `.remote.signal` { type: "paired" | "command" | "ended", ... }
 *  - tab     -> phone: client events "state" (RemoteState), "gaze" (RemoteGaze), "speech" (RemoteSpeechEvent)
 *  - phone   -> tab  : client events "listening" (RemoteListening), "hello" (asks the tab for a fresh state)
 * Requests from the phone go through the API (validated, rate limited, audited), never as client events.
 */

export const REMOTE_PATH = "/orbit/remote";
export const REMOTE_WHISPER = { state: "state", gaze: "gaze", speech: "speech", listening: "listening", hello: "hello" } as const;
export const MAX_CAPTION = 600;
export const MAX_REQUEST = 1000;

/** The web Orbit as the phone mirrors it. */
export interface RemoteState {
  /** Orbit's visible state on the computer (OrbitRig state name). */
  face: string;
  emotion?: string | null;
  /** One short line: what Orbit is doing ("Thinking", "Opening Connections"). */
  status: string;
  /** What Orbit is saying (speech or narration), or the request it is working on. */
  caption?: string | null;
  caption_kind?: "speech" | "narration" | "user" | null;
  speaking: boolean;
  working: boolean;
  /** Something only the computer can do: confirm, type a secret, answer a question. */
  needs?: "confirm" | "secret" | "input" | null;
  task?: string | null;
  page?: string | null;
}

/** Centre of the web Orbit in the computer's viewport, 0..1 on each axis. */
export interface RemoteGaze {
  x: number;
  y: number;
  docked: boolean;
  moving: boolean;
}

/** Real speech playback on the computer (drives the phone's lips; same shape as ttsAdapter events). */
export type RemoteSpeechEvent =
  | { type: "start"; text: string }
  | { type: "boundary"; charIndex: number }
  | { type: "end" | "cancelled" | "error" };

export interface RemoteListening {
  listening: boolean;
  /** Words heard so far (secrets already removed on the phone). */
  words?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const WATCHING = new Set(["moving", "flying", "navigating", "returning", "arriving"]);
const HANDS_BUSY = new Set(["clicking", "typing", "entering_data", "interacting", "pointing", "executing"]);
const LOOKING = new Set(["inspecting", "validating"]);

/**
 * The phone shows only Orbit's face, watching the web Orbit: while it flies the phone looks curious and follows it
 * with its eyes; while its hands work the phone looks focused; everything else (thinking, speaking, listening,
 * success, needs confirmation ...) is mirrored as is.
 */
export function remoteFaceState(desktopFace: string | null | undefined): string {
  const f = String(desktopFace || "idle").toLowerCase();
  if (WATCHING.has(f)) return "curious";
  if (HANDS_BUSY.has(f)) return "working";
  if (LOOKING.has(f)) return "inspecting";
  return f;
}

/**
 * Where the phone's eyes look (-1..1), or null to let the face idle naturally. The phone follows the web Orbit while
 * it is out of its corner or busy; when it rests in the corner the phone face relaxes.
 */
export function remoteGazeDirection(g: RemoteGaze | null | undefined, desktopFace?: string | null): { x: number; y: number } | null {
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
  const busy = !!desktopFace && !["idle", "resting", "waiting", "offline", "paused", "cancelled"].includes(String(desktopFace));
  if (g.docked && !g.moving && !busy) return null;
  return { x: clamp((g.x - 0.5) * 1.9, -1, 1), y: clamp((g.y - 0.45) * 1.6, -1, 1) };
}

/** Whether a new gaze sample is worth sending (avoids flooding the socket while Orbit is still). */
export function gazeChanged(prev: RemoteGaze | null, next: RemoteGaze, minDelta = 0.006): boolean {
  if (!prev) return true;
  return prev.docked !== next.docked || prev.moving !== next.moving
    || Math.abs(prev.x - next.x) >= minDelta || Math.abs(prev.y - next.y) >= minDelta;
}

/** Normalise a viewport rectangle centre. */
export function gazeFromRect(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number, docked: boolean, moving: boolean): RemoteGaze {
  const x = vw > 0 ? (r.left + r.width / 2) / vw : 0.5;
  const y = vh > 0 ? (r.top + r.height / 2) / vh : 0.5;
  return { x: Math.round(clamp(x, 0, 1) * 1000) / 1000, y: Math.round(clamp(y, 0, 1) * 1000) / 1000, docked, moving };
}

export interface RemoteStateInput {
  face: string;
  emotion?: string | null;
  statusText: string;
  speaking: boolean;
  speechText?: string | null;
  narration?: string | null;
  lastUserText?: string | null;
  working: boolean;
  taskStatus?: string | null;
  secureInput?: boolean;
  taskGoal?: string | null;
  pageTitle?: string | null;
}

/** The state the tab sends: short, bounded, and without anything the phone does not need. */
export function buildRemoteState(i: RemoteStateInput): RemoteState {
  let caption: string | null = null;
  let kind: RemoteState["caption_kind"] = null;
  // While Orbit works: its live narration, else the request it is working on. Otherwise: what it last said.
  if (i.working && i.narration) {
    caption = i.narration;
    kind = "narration";
  } else if (i.working && i.lastUserText) {
    caption = i.lastUserText;
    kind = "user";
  } else if (i.speechText) {
    caption = i.speechText;
    kind = "speech";
  }
  const needs: RemoteState["needs"] =
    i.taskStatus === "WAITING_FOR_APPROVAL" ? "confirm" : i.secureInput ? "secret" : i.taskStatus === "WAITING_FOR_INPUT" ? "input" : null;
  return {
    face: String(i.face || "idle").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32) || "idle",
    emotion: i.emotion ? String(i.emotion).toLowerCase().replace(/[^a-z_]/g, "").slice(0, 24) || null : null,
    status: clip(i.statusText, 160) || "Ready",
    caption: caption ? clip(caption, MAX_CAPTION) : null,
    caption_kind: caption ? kind : null,
    speaking: !!i.speaking,
    working: !!i.working,
    needs,
    task: i.taskGoal ? clip(i.taskGoal, 200) : null,
    page: i.pageTitle ? clip(i.pageTitle, 120) : null,
  };
}

/** What the phone says under the face. Things only the computer can do are spelled out. */
export function remoteStatusLine(s: RemoteState | null, opts: { desktopOnline: boolean; holding: boolean; sending: boolean }): string {
  if (opts.holding) return "Listening… release to send";
  if (opts.sending) return "Sending to your computer…";
  if (!opts.desktopOnline) return "Your computer is not connected";
  if (!s) return "Connecting to your computer…";
  if (s.needs === "confirm") return "Confirm on your computer to continue";
  if (s.needs === "secret") return "Type the password or key on your computer";
  if (s.needs === "input") return "Orbit has a question for you";
  return s.status || "Ready";
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || /^127\./.test(h) || h.endsWith(".localhost");
}

/** Phones need a secure page (https, or localhost) for the microphone. */
export function micNeedsHttps(protocol: string, hostname: string): boolean {
  return protocol !== "https:" && !isLoopbackHost(hostname);
}

export interface PairingLinkInput {
  protocol: string;
  hostname: string;
  port: string;
  code: string;
  lanAddresses: string[];
  publicUrl?: string | null;
  /** The Wi-Fi address the user picked (when there are several). */
  preferredHost?: string | null;
}

export interface PairingLink {
  url: string;
  /** public: configured address; same: the address this computer uses; lan: this machine's Wi-Fi address; local: a phone cannot open it. */
  reach: "public" | "same" | "lan" | "local";
  host: string;
}

/** The address a phone opens from the QR code. The code rides in the #fragment, so it is never sent in a request line or logged. */
export function pairingLink(i: PairingLinkInput): PairingLink {
  const tail = `${REMOTE_PATH}#code=${encodeURIComponent(i.code)}`;
  const pub = (i.publicUrl || "").trim().replace(/\/+$/, "");
  if (pub) {
    let host = pub;
    try {
      host = new URL(pub).host;
    } catch {
      // keep the raw value
    }
    return { url: pub + tail, reach: "public", host };
  }
  const port = i.port ? `:${i.port}` : "";
  if (isLoopbackHost(i.hostname)) {
    const lan = i.preferredHost && i.lanAddresses.includes(i.preferredHost) ? i.preferredHost : i.lanAddresses[0];
    if (lan) return { url: `${i.protocol}//${lan}${port}${tail}`, reach: "lan", host: `${lan}${port}` };
    return { url: `${i.protocol}//${i.hostname}${port}${tail}`, reach: "local", host: `${i.hostname}${port}` };
  }
  return { url: `${i.protocol}//${i.hostname}${port}${tail}`, reach: "same", host: `${i.hostname}${port}` };
}

/** The pairing code from the page address (#code=...), or null. */
export function codeFromHash(hash: string): string | null {
  const m = /(?:^#|&)code=([A-Za-z0-9_-]{32,128})(?:&|$)/.exec(hash || "");
  return m ? m[1] : null;
}

/** "2:41" */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Calls through at most once per `ms`; the last call in a burst is delivered at the end of the window. */
export function createThrottle(ms: number, now: () => number = () => Date.now()) {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  return {
    run(fn: () => void) {
      const t = now();
      if (t - last >= ms) {
        last = t;
        fn();
        return;
      }
      pending = fn;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = now();
          const p = pending;
          pending = null;
          p?.();
        }, ms - (t - last));
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
