import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../services/api";
import { getEcho } from "../services/echo";
import { ttsAdapter } from "../services/ttsAdapter";
import { orbitPresence } from "../services/orbitPresence";
import { pageStateService } from "../services/pageStateService";
import { stageText } from "../services/orbitBehavior";
import { redactSecretsFromUtterance } from "../services/secretRedactor";
import {
  REMOTE_WHISPER, buildRemoteState, createThrottle, gazeChanged, gazeFromRect, pairingLink,
  type PairingLink, type RemoteGaze, type RemoteListening, type RemoteState,
} from "../services/orbitRemoteProtocol";
import { ACTIVE_TASK_STATUSES, useAssistant } from "./AssistantContext";
import { useLiveEvents } from "./LiveEventsContext";
import { useToast } from "./ToastContext";

/**
 * Orbit Remote, computer side. Shows a pairing code, then relays the web Orbit to the paired phone (state, gaze,
 * lip-sync) and runs the phone's requests through the normal Orbit pipeline (`handleVoiceTranscript`), so page
 * context, confirmations and the secure fields all stay on this computer.
 */

export interface DesktopRemoteSession {
  id: string;
  status: "pending" | "active" | "ended";
  pairing_expires_at: string | null;
  device_label: string | null;
  device_online?: boolean;
  claimed_at: string | null;
  expires_at: string | null;
  attached_here: boolean;
  end_reason: string | null;
}

/** idle: nothing paired; pending: code shown; connected: phone paired with this tab; elsewhere: paired with another tab. */
export type RemotePhase = "idle" | "starting" | "pending" | "connected" | "elsewhere" | "ended";

interface OrbitRemoteValue {
  phase: RemotePhase;
  session: DesktopRemoteSession | null;
  /** The address in the QR code (null after a reload, when the one-time code is no longer known). */
  link: PairingLink | null;
  /** When the code stops working (ms since epoch, this computer's clock). */
  expiresAt: number | null;
  lanAddresses: string[];
  preferredHost: string | null;
  setPreferredHost: (host: string) => void;
  error: string | null;
  endReason: string | null;
  /** The phone is being held to talk (with the words heard so far); the web Orbit listens too (FloatingMascot). */
  phoneListening: RemoteListening | null;
  /** The live link to the phone is open (otherwise the phone falls back to slower updates). */
  liveLink: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  startPairing: () => Promise<void>;
  disconnect: () => Promise<void>;
  takeOver: () => Promise<void>;
}

const OrbitRemoteContext = createContext<OrbitRemoteValue | null>(null);

const INSTANCE_KEY = "orbit_remote_instance";
const HEARTBEAT_MS = 20000;
const SNAPSHOT_MS = 1500;
const GAZE_MS = 80;

function randomId(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/** One id per browser tab (kept across reloads of that tab), so the phone's requests go to exactly one tab. */
function tabInstance(): string {
  try {
    let v = sessionStorage.getItem(INSTANCE_KEY);
    if (!v || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) {
      v = `tab_${randomId(20)}`;
      sessionStorage.setItem(INSTANCE_KEY, v);
    }
    return v;
  } catch {
    return `tab_${randomId(20)}`;
  }
}

const ENDED_TOAST: Record<string, [string, string]> = {
  disconnected_from_phone: ["Phone disconnected", "The phone ended Orbit Remote."],
  expired: ["Phone disconnected", "Orbit Remote ended after a long time without use."],
  signed_out: ["Phone disconnected", "You signed out."],
};

export const OrbitRemoteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const assistant = useAssistant();
  const { addListener } = useLiveEvents();
  const { toast } = useToast();
  // Toast helpers change identity on every toast; read them through a ref so the phone channel never rejoins.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const [instance] = useState(tabInstance);

  const [phase, setPhaseState] = useState<RemotePhase>("idle");
  const [session, setSession] = useState<DesktopRemoteSession | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [preferredHost, setPreferredHost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [phoneListening, setPhoneListening] = useState<RemoteListening | null>(null);
  const [liveLink, setLiveLink] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Latest values for socket/event handlers (registered once).
  const phaseRef = useRef(phase);
  const sessionRef = useRef(session);
  const assistantRef = useRef(assistant);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    assistantRef.current = assistant;
  }, [assistant]);
  const setPhase = useCallback((p: RemotePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const channelRef = useRef<any>(null);
  const handled = useRef<Set<number>>(new Set());

  const applySession = useCallback((s: DesktopRemoteSession | null) => {
    setSession(s);
    if (!s) return setPhase("idle");
    if (s.status === "ended") {
      setEndReason(s.end_reason);
      return setPhase("ended");
    }
    if (!s.attached_here) return setPhase("elsewhere");
    setPhase(s.status === "active" ? "connected" : "pending");
  }, [setPhase]);

  // ---------------------------------------------------------------- restore after a reload / in a new tab
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res: any = await api.orbitRemoteCurrent(instance);
        if (!alive) return;
        setLanAddresses(res?.lan_addresses ?? []);
        setPublicUrl(res?.public_url ?? null);
        const s: DesktopRemoteSession | null = res?.session ?? null;
        if (!s || s.status !== "active") {
          // A code shown before a reload cannot be shown again (it is never stored); a new one is made on demand.
          if (s?.status === "pending" && s.attached_here) applySession(s);
          return;
        }
        if (s.attached_here) return applySession(s);
        try {
          const attached: any = await api.orbitRemoteAttach(s.id, instance);
          if (alive) applySession(attached.session);
        } catch (e: any) {
          if (alive && e?.status === 409) applySession({ ...s, attached_here: false });
        }
      } catch {
        // Orbit Remote is optional: the portal works without it.
      }
    })();
    return () => {
      alive = false;
    };
  }, [instance, applySession]);

  // ---------------------------------------------------------------- lifecycle
  const onPaired = useCallback((label?: string | null) => {
    if (phaseRef.current === "connected") return;
    setSession((s) => (s ? { ...s, status: "active", device_label: label ?? s.device_label, device_online: true } : s));
    setCode(null);
    setExpiresAt(null);
    setPhase("connected");
    toastRef.current.success("Phone connected", `${label || "Your phone"} can now talk to Orbit. Hold Orbit's face on the phone and speak.`);
  }, [setPhase]);

  const onEnded = useCallback((reason?: string | null, quiet = false) => {
    if (phaseRef.current === "ended" || phaseRef.current === "idle") return;
    const wasConnected = phaseRef.current === "connected";
    setPhase("ended");
    setEndReason(reason ?? null);
    setSession((s) => (s ? { ...s, status: "ended", end_reason: reason ?? null } : s));
    setCode(null);
    setExpiresAt(null);
    setPhoneListening(null);
    const t = reason ? ENDED_TOAST[reason] : null;
    if (!quiet && wasConnected && t) toastRef.current.info(t[0], t[1]);
  }, [setPhase]);

  const onCommand = useCallback(async (p: any) => {
    const s = sessionRef.current;
    if (!s || p?.session !== s.id || p?.instance !== instance || phaseRef.current !== "connected") return;
    const id = Number(p.command_id);
    if (!id || handled.current.has(id)) return;
    handled.current.add(id);
    let status = "rejected";
    try {
      const res: any = await api.orbitRemoteAck(s.id, id, instance, "received");
      status = res?.command?.status;
    } catch {
      return;
    }
    // The server refuses late or already-taken requests; only a fresh one runs here.
    if (status !== "received") return;
    const a = assistantRef.current;
    if (p.kind === "stop") {
      if (a.activeTask && ACTIVE_TASK_STATUSES.includes(a.activeTask.status)) void a.interruptTask("STOP");
      else ttsAdapter.stop();
      return;
    }
    const text = String(p.text ?? "").trim();
    if (text) void a.handleVoiceTranscript(text);
  }, [instance]);

  const onPhoneListening = useCallback((e: RemoteListening) => {
    if (phaseRef.current !== "connected") return;
    if (e?.listening) {
      const words = e.words ? redactSecretsFromUtterance(String(e.words).slice(0, 300)).redactedText : "";
      setPhoneListening({ listening: true, words });
    } else {
      setPhoneListening(null);
    }
  }, []);

  // Workspace events: commands, plus paired/ended when the phone channel is not connected.
  useEffect(() => {
    return addListener((evt) => {
      const p = evt.payload || {};
      if (evt.event_name === "orbit.remote_command") void onCommand(p);
      else if (evt.event_name === "orbit.remote_paired" && sessionRef.current?.id === p.session) onPaired(p.device_label);
      else if (evt.event_name === "orbit.remote_ended" && sessionRef.current?.id === p.session) onEnded(p.reason);
    });
  }, [addListener, onCommand, onPaired, onEnded]);

  // ---------------------------------------------------------------- what the phone sees
  const presence = useSyncExternalStore(
    (cb) => orbitPresence.subscribe(cb),
    () => orbitPresence.get(),
  );
  const [pageTitle, setPageTitle] = useState(() => pageStateService.getSnapshot().pageTitle);
  useEffect(() => pageStateService.subscribe((snap) => setPageTitle(snap.pageTitle)), []);

  const {
    activeTask, isLoading, turnStage, toolActivity, queueStatus, isSpeaking, speech, narration, messages, secureInputRequest,
  } = assistant;
  const working = isLoading || (activeTask ? ACTIVE_TASK_STATUSES.includes(activeTask.status) : false);
  const lastUserText = useMemo(() => [...messages].reverse().find((m) => m.role === "user")?.content ?? null, [messages]);

  const remoteState: RemoteState = useMemo(() => {
    const statusText = presence.state === "listening"
      ? phoneListening ? "Listening to you" : "Listening on the computer"
      : isSpeaking ? "Speaking"
      : presence.moving && !presence.docked ? "Moving to the next step"
      : stageText(turnStage, toolActivity?.status === "running" ? toolActivity.label : null, activeTask?.status, queueStatus);
    return buildRemoteState({
      face: presence.state,
      emotion: presence.emotion,
      statusText,
      speaking: isSpeaking,
      speechText: speech?.text ?? null,
      narration,
      lastUserText,
      working,
      taskStatus: activeTask?.status ?? null,
      secureInput: !!secureInputRequest,
      taskGoal: working ? activeTask?.goal ?? null : null,
      // "Portal" is only the fallback before a page names itself: not worth showing on the phone.
      pageTitle: pageTitle && pageTitle !== "Portal" ? pageTitle : null,
    });
  }, [presence, phoneListening, isSpeaking, turnStage, toolActivity, activeTask, queueStatus, speech, narration, lastUserText, working, secureInputRequest, pageTitle]);

  const remoteStateRef = useRef(remoteState);
  useEffect(() => {
    remoteStateRef.current = remoteState;
  }, [remoteState]);
  const lastWhispered = useRef<string>("");
  const lastGaze = useRef<RemoteGaze | null>(null);
  const whisperThrottle = useMemo(() => createThrottle(150), []);
  const snapshotThrottle = useMemo(() => createThrottle(SNAPSHOT_MS), []);

  const whisper = useCallback((event: string, data: unknown) => {
    try {
      channelRef.current?.whisper(event, data);
    } catch {
      // not subscribed yet: the next change or heartbeat catches up
    }
  }, []);

  const sendSnapshot = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !["pending", "connected"].includes(phaseRef.current)) return;
    try {
      const res: any = await api.orbitRemoteState(s.id, instance, phaseRef.current === "connected" ? remoteStateRef.current : null);
      if (res?.session) setSession((prev) => (prev && prev.id === res.session.id ? { ...prev, ...res.session } : prev));
    } catch (e: any) {
      if (e?.status === 410) onEnded(e?.data?.session?.end_reason ?? "ended");
      else if (e?.status === 409) setPhase("elsewhere");
    }
  }, [instance, onEnded, setPhase]);

  const publishState = useCallback((force = false) => {
    const json = JSON.stringify(remoteStateRef.current);
    if (force || json !== lastWhispered.current) {
      lastWhispered.current = json;
      whisper(REMOTE_WHISPER.state, remoteStateRef.current);
    }
  }, [whisper]);

  const active = phase === "pending" || phase === "connected";

  // State: live to the phone on every change, and a bounded snapshot to the server.
  useEffect(() => {
    if (phase !== "connected") return;
    whisperThrottle.run(() => publishState());
    snapshotThrottle.run(() => void sendSnapshot());
  }, [remoteState, phase, publishState, sendSnapshot, whisperThrottle, snapshotThrottle]);

  // Heartbeat (also while a code is shown, so the phone sees the computer as connected when it scans).
  useEffect(() => {
    if (!active || !session?.id) return;
    void sendSnapshot();
    const t = setInterval(() => void sendSnapshot(), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [active, session?.id, sendSnapshot]);

  // The phone's channel.
  useEffect(() => {
    if (!active || !session?.id) return;
    const echo = getEcho();
    if (!echo) return;
    const name = `orbit-remote.${session.id}`;
    const ch: any = echo.private(name);
    channelRef.current = ch;
    ch.subscribed?.(() => {
      setLiveLink(true);
      lastWhispered.current = "";
      lastGaze.current = null;
    });
    ch.error?.(() => setLiveLink(false));
    ch.listen(".remote.signal", (e: any) => {
      if (e?.type === "paired") onPaired(e.device_label);
      else if (e?.type === "ended") onEnded(e.reason);
    });
    ch.listenForWhisper(REMOTE_WHISPER.listening, (e: RemoteListening) => onPhoneListening(e));
    ch.listenForWhisper(REMOTE_WHISPER.hello, () => {
      // The phone (re)joined: send everything now instead of waiting for the next change.
      lastGaze.current = null;
      publishState(true);
    });
    return () => {
      channelRef.current = null;
      setLiveLink(false);
      try {
        echo.leave(name);
      } catch {
        // already left
      }
    };
  }, [active, session?.id, onPaired, onEnded, onPhoneListening, publishState]);

  // Where the web Orbit is (the phone's eyes follow it), sampled while connected.
  useEffect(() => {
    if (phase !== "connected" || !liveLink) return;
    const t = setInterval(() => {
      const p = orbitPresence.get();
      if (!p.el) return;
      const g = gazeFromRect(p.el.getBoundingClientRect(), window.innerWidth, window.innerHeight, p.docked, p.moving);
      if (gazeChanged(lastGaze.current, g)) {
        lastGaze.current = g;
        whisper(REMOTE_WHISPER.gaze, g);
      }
    }, GAZE_MS);
    return () => clearInterval(t);
  }, [phase, liveLink, whisper]);

  // Real speech playback, so the phone's lips move with the voice here.
  useEffect(() => {
    if (phase !== "connected" || !liveLink) return;
    return ttsAdapter.subscribe((e) => {
      if (e.type === "start") whisper(REMOTE_WHISPER.speech, { type: "start", text: e.text.slice(0, 2000) });
      else if (e.type === "boundary") whisper(REMOTE_WHISPER.speech, { type: "boundary", charIndex: e.charIndex });
      else whisper(REMOTE_WHISPER.speech, { type: e.type });
    });
  }, [phase, liveLink, whisper]);

  // ---------------------------------------------------------------- actions
  const startPairing = useCallback(async () => {
    setError(null);
    setPhase("starting");
    try {
      const res: any = await api.orbitRemoteStart(instance);
      handled.current.clear();
      setLanAddresses(res?.lan_addresses ?? []);
      setPublicUrl(res?.public_url ?? null);
      setCode(res.code);
      setExpiresAt(Date.now() + Number(res.pairing_ttl_seconds || 180) * 1000);
      setEndReason(null);
      setSession(res.session);
      setPhase("pending");
    } catch (e: any) {
      setError(e?.message || "Could not create a code. Try again.");
      setPhase(sessionRef.current?.status === "active" ? "connected" : "idle");
    }
  }, [instance, setPhase]);

  const disconnect = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      await api.orbitRemoteEnd(s.id);
    } catch {
      // ended either way on the next heartbeat
    }
    onEnded("disconnected_from_computer", true);
  }, [onEnded]);

  const takeOver = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setError(null);
    try {
      const res: any = await api.orbitRemoteAttach(s.id, instance);
      applySession(res.session);
    } catch (e: any) {
      setError(e?.message || "Could not take over the phone here.");
    }
  }, [instance, applySession]);

  const link = useMemo(() => (code ? pairingLink({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
    code,
    lanAddresses,
    publicUrl,
    preferredHost,
  }) : null), [code, lanAddresses, publicUrl, preferredHost]);

  const value: OrbitRemoteValue = {
    phase, session, link, expiresAt, lanAddresses, preferredHost, setPreferredHost, error, endReason, phoneListening, liveLink,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    startPairing, disconnect, takeOver,
  };

  return <OrbitRemoteContext.Provider value={value}>{children}</OrbitRemoteContext.Provider>;
};

export const useOrbitRemote = (): OrbitRemoteValue => {
  const ctx = useContext(OrbitRemoteContext);
  if (!ctx) throw new Error("useOrbitRemote must be used within an OrbitRemoteProvider");
  return ctx;
};
