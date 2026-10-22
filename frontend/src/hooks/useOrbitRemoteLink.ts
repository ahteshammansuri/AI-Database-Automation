import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDeviceEcho } from "../services/echo";
import { clearDeviceToken, deviceApi, type DeviceApiError, type DeviceSessionView } from "../services/orbitRemoteDevice";
import { REMOTE_WHISPER, createThrottle, type RemoteGaze, type RemoteSpeechEvent, type RemoteState } from "../services/orbitRemoteProtocol";

/**
 * The phone's link to its computer: a live socket (state, gaze, speech, signals) with polling as the fallback,
 * plus a heartbeat so the computer knows the phone is still open.
 */

export const ENDED_MESSAGES: Record<string, string> = {
  not_connected: "This phone is not connected. Scan the QR code on your computer to connect.",
  expired: "This connection expired. Scan a new QR code on your computer.",
  replaced: "Another phone was connected to your account, so this one was disconnected.",
  disconnected_from_computer: "The computer disconnected this phone.",
  disconnected_from_phone: "You disconnected this phone.",
  signed_out: "You signed out on the computer, so this phone was disconnected.",
  signed_out_by_admin: "An administrator signed this account out, so this phone was disconnected.",
  suspended: "This account is suspended, so this phone was disconnected.",
  disconnected_by_admin: "An administrator disconnected this phone.",
  account_deleted: "This account no longer exists.",
  disabled: "Orbit Remote is turned off by the administrator.",
};

export interface RemoteLink {
  /** live: instant updates; polling: every few seconds (socket unavailable). */
  connection: "connecting" | "live" | "polling";
  ended: { reason: string | null; message: string } | null;
  session: DeviceSessionView["session"] | null;
  desktopOnline: boolean;
  state: RemoteState | null;
  gaze: RemoteGaze | null;
  commandStatus: Record<number, { status: string; reason: string | null }>;
  /** Speech playback on the computer, for the face's lips. */
  speechSource: (listener: (e: RemoteSpeechEvent) => void) => () => void;
  /** Tell the computer the face is being held (and the words heard so far). */
  sendListening: (listening: boolean, words?: string) => void;
  end: (reason: string | null, message?: string) => void;
}

const LIVE_POLL_MS = 15000;
const FALLBACK_POLL_MS = 3000;
const HEARD_FRESH_MS = 45000;

export function useOrbitRemoteLink(token: string | null): RemoteLink {
  const [view, setView] = useState<DeviceSessionView | null>(null);
  const [state, setState] = useState<RemoteState | null>(null);
  const [gaze, setGaze] = useState<RemoteGaze | null>(null);
  const [connection, setConnection] = useState<RemoteLink["connection"]>("connecting");
  const [ended, setEnded] = useState<RemoteLink["ended"]>(null);
  const [commandStatus, setCommandStatus] = useState<RemoteLink["commandStatus"]>({});
  // The computer spoke on the live channel recently (it counts as connected even between heartbeats).
  const [heardRecently, setHeardRecently] = useState(false);
  const heardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heard = useCallback(() => {
    setHeardRecently(true);
    if (heardTimer.current) clearTimeout(heardTimer.current);
    heardTimer.current = setTimeout(() => setHeardRecently(false), HEARD_FRESH_MS);
  }, []);
  useEffect(() => () => {
    if (heardTimer.current) clearTimeout(heardTimer.current);
  }, []);
  const channelRef = useRef<any>(null);
  const connectionRef = useRef(connection);
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const [bus] = useState(() => {
    const listeners = new Set<(e: RemoteSpeechEvent) => void>();
    return {
      subscribe: (fn: (e: RemoteSpeechEvent) => void) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      emit: (e: RemoteSpeechEvent) => listeners.forEach((l) => {
        try {
          l(e);
        } catch {
          // never break the face
        }
      }),
    };
  });

  const end = useCallback((reason: string | null, message?: string) => {
    clearDeviceToken();
    setEnded({ reason, message: message || (reason && ENDED_MESSAGES[reason]) || "This phone is no longer connected. Scan a new QR code on your computer." });
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const v = await deviceApi.session(token);
      setView(v);
      // The socket is fresher than the saved snapshot; use the snapshot only without it.
      if (connectionRef.current !== "live" && v.desktop.state) setState(v.desktop.state);
      setCommandStatus((prev) => {
        const next = { ...prev };
        for (const c of v.commands) next[c.id] = { status: c.status, reason: c.reason };
        return next;
      });
    } catch (e) {
      const err = e as DeviceApiError;
      if (err.status === 401) end(err.reason ?? null, err.message);
    }
  }, [token, end]);

  // Heartbeat / fallback polling.
  const live = connection === "live";
  useEffect(() => {
    if (!token || ended) return;
    void refresh();
    const t = setInterval(() => void refresh(), live ? LIVE_POLL_MS : FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [token, ended, live, refresh]);

  // Live socket on this phone's own channel.
  const sessionId = view?.session.id ?? null;
  useEffect(() => {
    if (!token || !sessionId || ended) return;
    const echo: any = createDeviceEcho(token);
    // No socket (or no subscription within a few seconds): keep working by polling.
    const fallback = setTimeout(() => setConnection((c) => (c === "live" ? c : "polling")), echo ? 6000 : 0);
    if (!echo) return () => clearTimeout(fallback);
    const name = `orbit-remote.${sessionId}`;
    const ch: any = echo.private(name);
    channelRef.current = ch;
    ch.subscribed(() => {
      setConnection("live");
      try {
        ch.whisper(REMOTE_WHISPER.hello, {});
      } catch {
        // the next state change arrives anyway
      }
    });
    ch.error(() => setConnection("polling"));
    ch.listen(".remote.signal", (e: any) => {
      if (e?.type === "ended") end(e.reason ?? null);
      else if (e?.type === "command" && e.command_id) {
        setCommandStatus((prev) => ({ ...prev, [e.command_id]: { status: e.status, reason: e.reason ?? null } }));
      }
    });
    ch.listenForWhisper(REMOTE_WHISPER.state, (s: RemoteState) => {
      heard();
      setState(s);
    });
    ch.listenForWhisper(REMOTE_WHISPER.gaze, (g: RemoteGaze) => {
      heard();
      setGaze(g);
    });
    ch.listenForWhisper(REMOTE_WHISPER.speech, (e: RemoteSpeechEvent) => {
      heard();
      bus.emit(e);
    });
    const conn = echo.connector?.pusher?.connection;
    const onChange = ({ current }: { current: string }) => {
      if (current !== "connected") setConnection("polling");
    };
    conn?.bind?.("state_change", onChange);
    return () => {
      clearTimeout(fallback);
      channelRef.current = null;
      conn?.unbind?.("state_change", onChange);
      try {
        echo.leave(name);
        echo.disconnect();
      } catch {
        // already closed
      }
    };
  }, [token, sessionId, ended, end, bus, heard]);

  // Without the socket there are no speech events: move the lips while the computer reports speaking.
  const prevSpeaking = useRef(false);
  useEffect(() => {
    const speaking = !!state?.speaking;
    if (connection !== "live") {
      if (speaking && !prevSpeaking.current && state?.caption) bus.emit({ type: "start", text: state.caption });
      if (!speaking && prevSpeaking.current) bus.emit({ type: "end" });
    }
    prevSpeaking.current = speaking;
  }, [state?.speaking, state?.caption, connection, bus]);

  const listeningThrottle = useMemo(() => createThrottle(250), []);
  const sendListening = useCallback((listening: boolean, words?: string) => {
    const send = () => {
      try {
        channelRef.current?.whisper(REMOTE_WHISPER.listening, { listening, words: words ? words.slice(0, 300) : undefined });
      } catch {
        // display only; requests themselves go through the API
      }
    };
    if (!listening) {
      listeningThrottle.cancel();
      send();
    } else if (words) listeningThrottle.run(send);
    else send();
  }, [listeningThrottle]);

  const desktopOnline = (view?.desktop.online ?? false) || heardRecently;

  return {
    connection, ended, session: view?.session ?? null, desktopOnline, state, gaze, commandStatus,
    speechSource: bus.subscribe, sendListening, end,
  };
}
