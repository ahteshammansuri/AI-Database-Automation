import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database, Hand, Keyboard, Loader2, Lock, MoreHorizontal, Send, Square, Unplug, WifiOff, X } from "lucide-react";
import { OrbitRig } from "../components/agent/orbit/OrbitRig";
import { FieldError } from "../components/ui/kit";
import { usePressAndHold } from "../hooks/usePressAndHold";
import { useVoiceLifecycle } from "../hooks/useVoiceLifecycle";
import { useOrbitRemoteLink } from "../hooks/useOrbitRemoteLink";
import { deviceApi, loadDeviceToken, saveDeviceToken, type DeviceApiError } from "../services/orbitRemoteDevice";
import {
  MAX_REQUEST, REMOTE_PATH, codeFromHash, micNeedsHttps, remoteFaceState, remoteGazeDirection, remoteStatusLine,
} from "../services/orbitRemoteProtocol";
import { redactSecretsFromUtterance } from "../services/secretRedactor";
import { BrandName, usePlatform } from "../context/PlatformContext";

/**
 * Orbit Remote on the phone (opened from the QR code on the dashboard). Shows only Orbit's face. Hold it and speak:
 * when released, the request goes to the computer and the web Orbit does it there; the face mirrors the web Orbit
 * (thinking, speaking with real lip-sync, listening) and its eyes follow the web Orbit around the screen.
 */

const SECRET_MESSAGE = "For your safety, passwords and API keys are never sent from your phone. Type them on the computer, in Orbit's secure field.";

const GLOW: Record<string, string> = {
  listening: "rgba(34,211,238,0.55)",
  understanding: "rgba(129,140,248,0.5)",
  thinking: "rgba(167,139,250,0.5)",
  planning: "rgba(167,139,250,0.5)",
  working: "rgba(99,102,241,0.5)",
  inspecting: "rgba(99,102,241,0.45)",
  curious: "rgba(56,189,248,0.42)",
  speaking: "rgba(129,140,248,0.5)",
  success: "rgba(52,211,153,0.5)",
  celebrate: "rgba(52,211,153,0.55)",
  needs_confirmation: "rgba(251,191,36,0.5)",
  waiting_for_user: "rgba(251,191,36,0.45)",
  warning: "rgba(251,191,36,0.45)",
  error: "rgba(248,113,113,0.5)",
  offline: "rgba(148,163,184,0.25)",
};

function useFaceSize(): number {
  const calc = () => Math.round(Math.max(180, Math.min(window.innerWidth - 56, 380, window.innerHeight * 0.44)));
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const onResize = () => setSize(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** Keep the screen on while the remote is open (where supported). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: any = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock.request("screen");
      } catch {
        // not allowed now (battery saver, not visible): the screen may sleep as usual
      }
    };
    const onVisible = () => document.visibilityState === "visible" && !cancelled && void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release?.().catch?.(() => {});
    };
  }, [active]);
}

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // no haptics
  }
};

const Brand: React.FC<{ subtitle?: string | null }> = ({ subtitle }) => (
  <div className="flex min-w-0 items-center gap-2.5">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-glow">
      <Database className="h-4 w-4 text-white" strokeWidth={2.4} />
    </span>
    <span className="min-w-0">
      <span className="block text-[14px] font-bold leading-tight tracking-[-0.01em]">Orbit Remote</span>
      <span className="block truncate text-[11.5px] text-slate-400">{subtitle || <BrandName />}</span>
    </span>
  </div>
);

const Backdrop: React.FC<{ glow?: string }> = ({ glow }) => (
  <div aria-hidden className="pointer-events-none fixed inset-0">
    <div className="landing-blob absolute -left-24 -top-32 h-80 w-80 rounded-full bg-indigo-600/30" />
    <div className="landing-blob absolute -bottom-36 -right-20 h-80 w-80 rounded-full bg-violet-600/25" style={{ animationDelay: "-6s" }} />
    <div className="absolute inset-0 landing-grid opacity-50" />
    <div
      className="absolute left-1/2 top-[38%] h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background] duration-700"
      style={{ background: `radial-gradient(closest-side, ${glow ?? "rgba(99,102,241,0.28)"}, transparent 72%)` }}
    />
  </div>
);

/** Full-screen message (connecting, scan a code, disconnected). */
const Notice: React.FC<{ face: string; title: string; text: string; busy?: boolean }> = ({ face, title, text, busy }) => {
  const size = useFaceSize();
  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-ink px-6 text-white" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
      <Backdrop glow={GLOW[face]} />
      <header className="relative z-10"><Brand /></header>
      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center pb-16 text-center">
        <OrbitRig state={face} width={Math.round(size * 0.78)} framing="head" followPointer={false} label="Orbit" />
        <h1 className="mt-6 flex items-center gap-2 text-[22px] font-extrabold tracking-[-0.02em]">
          {busy && <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />} {title}
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-slate-400">{text}</p>
      </main>
    </div>
  );
};

/** First view: a code to claim from the QR link, this tab's earlier connection, or nothing. */
function initialRemote(): { code: string | null; token: string | null; phase: "claiming" | "ready" | "invalid" } {
  const code = codeFromHash(window.location.hash);
  if (code) return { code, token: null, phase: "claiming" };
  const saved = loadDeviceToken();
  return { code: null, token: saved, phase: saved ? "ready" : "invalid" };
}

export const OrbitRemotePage: React.FC = () => {
  const { brand } = usePlatform();
  const [initial] = useState(initialRemote);
  const [token, setToken] = useState<string | null>(initial.token);
  const [phase, setPhase] = useState<"claiming" | "ready" | "invalid">(initial.phase);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Orbit Remote · ${brand}`;
  }, [brand]);

  // Claim the one-time code from the QR link, and drop it from the address bar straight away.
  useEffect(() => {
    const code = initial.code;
    if (!code) return;
    let alive = true;
    window.history.replaceState(null, "", REMOTE_PATH);
    deviceApi.claim(code)
      .then((res) => {
        saveDeviceToken(res.device_token);
        if (!alive) return;
        setToken(res.device_token);
        setPhase("ready");
      })
      .catch((e: DeviceApiError) => {
        if (!alive) return;
        setClaimError(e.errors?.code?.[0] ?? e.message);
        setPhase("invalid");
      });
    return () => {
      alive = false;
    };
  }, [initial.code]);

  if (phase === "claiming") return <Notice face="waking" title="Connecting…" text="Pairing this phone with your computer." busy />;
  if (phase === "invalid" || !token) {
    return (
      <Notice
        face={claimError ? "warning" : "curious"}
        title={claimError ? "That code didn't work" : "Scan the code on your computer"}
        text={claimError ?? `Open ${brand} on your computer, choose “Connect your phone” on the dashboard, and scan the QR code with this phone's camera.`}
      />
    );
  }
  return <RemoteConsole token={token} />;
};

const RemoteConsole: React.FC<{ token: string }> = ({ token }) => {
  const { brand } = usePlatform();
  const link = useOrbitRemoteLink(token);
  const { sendListening, end: endLink } = link;
  const size = useFaceSize();
  useWakeLock(!link.ended);

  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ id: number; text: string } | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [holdHint, setHoldHint] = useState(false);

  const needsHttps = micNeedsHttps(window.location.protocol, window.location.hostname);

  const send = useCallback(async (raw: string, via: "voice" | "typed"): Promise<boolean> => {
    const text = raw.trim();
    const fail = (msg: string) => {
      if (via === "typed") setTypeError(msg);
      else setNotice(msg);
      return false;
    };
    if (!text) return fail("Say or type what Orbit should do.");
    if (text.length > MAX_REQUEST) return fail(`Keep it under ${MAX_REQUEST} characters.`);
    if (redactSecretsFromUtterance(text).hasRedaction) return fail(SECRET_MESSAGE);
    setNotice(null);
    setSending(true);
    try {
      const res = await deviceApi.command(token, "say", text);
      setLastSent({ id: res.command.id, text });
      buzz(8);
      return true;
    } catch (e) {
      const err = e as DeviceApiError;
      if (err.status === 401) {
        endLink(err.reason ?? null, err.message);
        return false;
      }
      return fail(err.errors?.text?.[0] ?? err.message);
    } finally {
      setSending(false);
    }
  }, [token, endLink]);

  const onTranscript = useCallback((t: string) => {
    void send(t, "voice");
  }, [send]);
  const voice = useVoiceLifecycle({ onTranscript, measureLevel: false });

  // While held: the computer's Orbit listens too, and shows the words (secrets removed).
  const wasListening = useRef(false);
  useEffect(() => {
    if (voice.isListening) {
      const words = voice.interimTranscript ? redactSecretsFromUtterance(voice.interimTranscript).redactedText : undefined;
      sendListening(true, words);
    } else if (wasListening.current) {
      sendListening(false);
    }
    wasListening.current = voice.isListening;
  }, [voice.isListening, voice.interimTranscript, sendListening]);

  const voiceUsable = voice.isSupported && !needsHttps;
  const startTalking = () => {
    if (!voiceUsable) {
      setTyping(true);
      return;
    }
    setNotice(null);
    buzz(12);
    sendListening(true);
    if (!voice.isListening) voice.startListening();
  };
  const stopTalking = () => {
    sendListening(false);
    voice.stopListening();
  };

  const { isHolding, bind } = usePressAndHold({
    startOnDown: true,
    holdThresholdMs: 220,
    onHoldStart: startTalking,
    onHoldEnd: stopTalking,
    onTap: () => {
      if (!voiceUsable) return setTyping(true);
      // A quick tap starts listening hands-free; tap again (or pause) to send.
      if (voice.isListening) stopTalking();
      else {
        startTalking();
        setHoldHint(true);
      }
    },
  });
  useEffect(() => {
    if (!holdHint) return;
    const t = setTimeout(() => setHoldHint(false), 2600);
    return () => clearTimeout(t);
  }, [holdHint]);

  // A request the computer has not picked up after a while gets an honest note.
  const sentStatus = lastSent ? link.commandStatus[lastSent.id] : null;
  const [lateId, setLateId] = useState<number | null>(null);
  useEffect(() => {
    if (!lastSent || sentStatus) return;
    const t = setTimeout(() => setLateId(lastSent.id), 8000);
    return () => clearTimeout(t);
  }, [lastSent, sentStatus]);
  const waitingAck = !!lastSent && !sentStatus;
  const ackLate = waitingAck && lateId === lastSent?.id;
  const rejectedLate = sentStatus?.status === "rejected" && sentStatus.reason === "too_old";

  const stop = async () => {
    buzz(10);
    try {
      await deviceApi.command(token, "stop");
    } catch (e) {
      const err = e as DeviceApiError;
      if (err.status === 401) endLink(err.reason ?? null, err.message);
      else setNotice(err.errors?.text?.[0] ?? err.message);
    }
  };

  const disconnect = async () => {
    setMenu(false);
    try {
      await deviceApi.end(token);
    } catch {
      // ended locally either way
    }
    endLink("disconnected_from_phone");
  };

  const submitTyped = async (e: React.FormEvent) => {
    e.preventDefault();
    setTypeError(null);
    if (await send(typed, "typed")) {
      setTyped("");
      setTyping(false);
    }
  };

  const s = link.state;
  const listening = isHolding || voice.isListening;
  const face = listening ? "listening"
    : sending || (waitingAck && !ackLate) ? "understanding"
    : !link.desktopOnline && link.connection !== "connecting" ? "offline"
    : remoteFaceState(s?.face);
  const gaze = useMemo(() => (listening ? null : remoteGazeDirection(link.gaze, s?.face)), [listening, link.gaze, s?.face]);
  const status = remoteStatusLine(s, { desktopOnline: link.desktopOnline || link.connection === "connecting", holding: listening, sending: sending || (waitingAck && !ackLate) });

  const captionLabel = s?.caption_kind === "user" ? "You asked" : s?.caption_kind === "narration" ? "Orbit is doing" : "Orbit says";
  const firstName = link.session?.owner_first_name;

  if (link.ended) {
    return <Notice face="offline" title="Disconnected" text={`${link.ended.message} You can close this page.`} />;
  }

  return (
    <div
      className="relative flex min-h-[100dvh] select-none flex-col overflow-hidden bg-ink text-white [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
      style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}
    >
      <Backdrop glow={GLOW[face]} />

      <header className="relative z-10 flex items-center justify-between gap-3 px-5">
        <Brand subtitle={link.session?.desktop_label ? `With ${link.session.desktop_label}` : null} />
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              !link.desktopOnline && link.connection !== "connecting"
                ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                : link.connection === "live"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-400/30 bg-amber-500/10 text-amber-200"
            }`}
            aria-live="polite"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!link.desktopOnline && link.connection !== "connecting" ? "bg-rose-400" : link.connection === "live" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            {!link.desktopOnline && link.connection !== "connecting" ? "Computer offline" : link.connection === "live" ? "Live" : link.connection === "polling" ? "Delayed" : "Connecting"}
          </span>
          <button type="button" onClick={() => setMenu(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300" aria-label="Options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center px-5 pb-40 pt-4 text-center">
        {firstName && <p className="text-[13px] text-slate-400">Hi {firstName}. Orbit is ready on your computer.</p>}

        <button
          type="button"
          {...bind}
          aria-label={voiceUsable ? "Hold to talk to Orbit, release to send" : "Type a request for Orbit"}
          aria-pressed={listening}
          data-face={face}
          data-gaze={gaze ? `${gaze.x.toFixed(2)},${gaze.y.toFixed(2)}` : ""}
          className="relative mt-3 touch-none rounded-[42%] outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/40"
          style={{ width: size, height: size }}
        >
          {/* Listening rings */}
          <AnimatePresence>
            {listening && [0, 1].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute inset-0 rounded-[42%] border-2 border-cyan-300/50"
                initial={{ opacity: 0.6, scale: 0.92 }}
                animate={{ opacity: 0, scale: 1.22 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
              />
            ))}
          </AnimatePresence>
          <motion.span
            className="relative block"
            animate={{ scale: listening ? 1.04 : 1 }}
            transition={{ type: "spring", damping: 16, stiffness: 220 }}
          >
            <OrbitRig
              state={face}
              width={size}
              framing="head"
              gaze={gaze}
              emotion={s?.speaking ? s?.emotion : null}
              speechSource={link.speechSource}
              followPointer={false}
              label={`Orbit (${status})`}
            />
          </motion.span>
        </button>

        <p className="mt-4 text-[18px] font-semibold tracking-[-0.01em]" aria-live="polite">{status}</p>
        {s?.page && !listening && <p className="mt-0.5 text-[12.5px] text-slate-500">On {s.page}</p>}

        <div className="mt-4 w-full max-w-md space-y-2.5">
          {listening && (
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.08] px-4 py-3 text-left text-[15px] leading-relaxed text-cyan-50">
              {voice.interimTranscript ? `“${voice.interimTranscript}”` : <span className="text-cyan-200/70">Speak now…</span>}
            </div>
          )}
          {!listening && s?.caption && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left backdrop-blur">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{captionLabel}</div>
              <p className="mt-1 line-clamp-5 text-[14.5px] leading-relaxed text-slate-100">{s.caption}</p>
            </div>
          )}
          {s?.needs === "secret" && (
            <p className="flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-left text-[13px] text-amber-100">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Passwords and keys are typed on the computer, in Orbit's secure field. Never on the phone.
            </p>
          )}
          {(notice || voice.error || ackLate || rejectedLate) && (
            <p className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3.5 py-2.5 text-left text-[13px] text-rose-100" role="alert">
              {notice
                ?? (rejectedLate ? "That request reached your computer too late, so it was not run. Try again."
                : ackLate ? `Your computer has not picked this up yet. Is ${brand} open there?`
                : voice.error)}
            </p>
          )}
          {!link.desktopOnline && link.connection !== "connecting" && (
            <p className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left text-[13px] text-slate-300">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> Open {brand} on your computer (the tab you paired from). Orbit works there.
            </p>
          )}
          {needsHttps && (
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-left text-[12.5px] text-slate-400">
              Voice needs a secure (https) link on phones. You can type your requests instead.
            </p>
          )}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink via-ink/95 to-transparent px-5 pt-8" style={{ paddingBottom: "max(18px, env(safe-area-inset-bottom))" }}>
        <p className="flex items-center justify-center gap-1.5 text-[12.5px] text-slate-400">
          <Hand className="h-3.5 w-3.5 text-cyan-300" />
          {holdHint ? "Listening hands-free: tap Orbit again to send" : voiceUsable ? "Hold Orbit to talk · let go to send" : "Tap Orbit or “Type” to send a request"}
        </p>
        <div className="mx-auto mt-3 flex max-w-md gap-2.5">
          <button type="button" onClick={() => { setTyping(true); setTypeError(null); }} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] py-3.5 text-[14px] font-semibold text-white active:bg-white/[0.1]">
            <Keyboard className="h-4 w-4" /> Type
          </button>
          {s?.working && (
            <button type="button" onClick={() => void stop()} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/15 py-3.5 text-[14px] font-semibold text-rose-100 active:bg-rose-500/25">
              <Square className="h-4 w-4 fill-current" /> Stop
            </button>
          )}
        </div>
      </footer>

      {/* Type a request */}
      <AnimatePresence>
        {typing && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTyping(false)} />
            <motion.form
              onSubmit={submitTyped}
              noValidate
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] border-t border-white/10 bg-slate-950 px-5 pt-4 text-left"
              style={{ paddingBottom: "max(18px, env(safe-area-inset-bottom))" }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
              <div className="flex items-center justify-between">
                <label htmlFor="remote-text" className="text-[15px] font-bold">Ask Orbit</label>
                <button type="button" onClick={() => setTyping(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                id="remote-text"
                autoFocus
                rows={3}
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setTypeError(null);
                }}
                placeholder="e.g. Open my approvals and show me the newest draft"
                aria-invalid={!!typeError}
                aria-describedby={typeError ? "remote-text-error" : undefined}
                className={`mt-3 w-full resize-none rounded-2xl border bg-white/[0.04] px-4 py-3 text-[16px] text-white placeholder-slate-500 outline-none focus:ring-4 ${typeError ? "border-rose-400/70 focus:ring-rose-400/15" : "border-white/10 focus:border-cyan-400/60 focus:ring-cyan-400/15"}`}
              />
              <FieldError id="remote-text" message={typeError} tone="dark" />
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500"><Lock className="h-3 w-3" /> Never type passwords here; Orbit asks for them on the computer.</p>
              <button type="submit" disabled={sending} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-[15px] font-bold text-slate-950 disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to Orbit
              </button>
            </motion.form>
          </>
        )}
      </AnimatePresence>

      {/* Options */}
      <AnimatePresence>
        {menu && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] border-t border-white/10 bg-slate-950 px-5 pt-4"
              style={{ paddingBottom: "max(18px, env(safe-area-inset-bottom))" }}
              role="dialog"
              aria-label="Options"
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
              <p className="text-[13px] text-slate-400">
                Connected{link.session?.desktop_label ? ` to ${link.session.desktop_label}` : ""}. This phone can ask Orbit to do things; confirmations, passwords and keys stay on the computer.
              </p>
              <button type="button" onClick={() => void disconnect()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/15 py-3.5 text-[15px] font-semibold text-rose-100">
                <Unplug className="h-4 w-4" /> Disconnect this phone
              </button>
              <button type="button" onClick={() => setMenu(false)} className="mt-2.5 w-full rounded-2xl py-3 text-[14px] font-semibold text-slate-300">Cancel</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrbitRemotePage;
