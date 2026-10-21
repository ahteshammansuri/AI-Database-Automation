import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, Copy, Hand, Laptop, Loader2, Lock, MonitorSmartphone, QrCode as QrIcon, RefreshCw, ScanLine, Smartphone, Unplug, Wifi } from "lucide-react";
import { FormAlert, ModalShell } from "../ui/kit";
import { QrCode } from "./QrCode";
import { PhoneOrbitMock } from "./PhoneOrbitMock";
import { useOrbitRemote } from "../../context/OrbitRemoteContext";
import { orbitPresence } from "../../services/orbitPresence";
import { formatCountdown, micNeedsHttps, remoteFaceState } from "../../services/orbitRemoteProtocol";

const ENDED_TEXT: Record<string, string> = {
  disconnected_from_phone: "The phone disconnected.",
  disconnected_from_computer: "You disconnected the phone.",
  expired: "The connection ended after a long time without use.",
  pairing_expired: "The code expired before it was scanned.",
  replaced: "Another phone was connected instead.",
  signed_out: "You signed out, so the phone was disconnected.",
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const Step: React.FC<{ n: number; icon: React.ElementType; title: string; text: string }> = ({ n, icon: Icon, title, text }) => (
  <li className="flex gap-3">
    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
      <Icon className="h-4 w-4" />
      <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-slate-950 text-[9.5px] font-bold text-white">{n}</span>
    </span>
    <span>
      <span className="block text-[13.5px] font-semibold text-slate-900">{title}</span>
      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-500">{text}</span>
    </span>
  </li>
);

/** Pair a phone with this tab: the QR code, then the connected phone (or why it ended). */
export const OrbitRemoteModal: React.FC = () => {
  const r = useOrbitRemote();
  const presence = useSyncExternalStore((cb) => orbitPresence.subscribe(cb), () => orbitPresence.get());
  const now = useNow(r.modalOpen && r.phase === "pending");
  const [copied, setCopied] = useState(false);
  const autoStarted = useRef<string | null>(null);

  const remaining = r.expiresAt ? Math.max(0, Math.round((r.expiresAt - now) / 1000)) : 0;
  const needsCode = r.phase === "idle" || r.phase === "ended" || (r.phase === "pending" && (!r.link || remaining === 0));

  // Opening the window shows a fresh code straight away; an expired code is replaced while the window is open.
  useEffect(() => {
    if (!r.modalOpen || !needsCode || r.phase === "ended") return;
    const key = `${r.phase}:${r.session?.id ?? ""}:${remaining}`;
    if (autoStarted.current === key || document.visibilityState !== "visible") return;
    autoStarted.current = key;
    void r.startPairing();
  }, [r.modalOpen, needsCode, r.phase, r.session?.id, remaining, r]);

  useEffect(() => {
    if (!r.modalOpen) autoStarted.current = null;
  }, [r.modalOpen]);

  const copy = async () => {
    if (!r.link) return;
    try {
      await navigator.clipboard.writeText(r.link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the address stays visible to copy by hand
    }
  };

  const httpsNote = r.link ? micNeedsHttps(new URL(r.link.url).protocol, new URL(r.link.url).hostname) : false;

  return (
    <ModalShell
      open={r.modalOpen}
      onClose={r.closeModal}
      size="lg"
      icon={MonitorSmartphone}
      title="Orbit on your phone"
      description="Talk to Orbit from your phone. It does the work here, on this screen."
      footer={
        <>
          {r.phase === "connected" && (
            <button type="button" onClick={() => void r.disconnect()} className="da-btn da-btn-ghost mr-auto text-rose-600 hover:bg-rose-50">
              <Unplug className="h-4 w-4" /> Disconnect phone
            </button>
          )}
          {r.phase === "connected" && (
            <button type="button" onClick={() => void r.startPairing()} className="da-btn da-btn-secondary">
              <QrIcon className="h-4 w-4" /> Connect a different phone
            </button>
          )}
          {r.phase === "ended" && (
            <button type="button" onClick={() => void r.startPairing()} className="da-btn da-btn-secondary mr-auto">
              <RefreshCw className="h-4 w-4" /> Show a new code
            </button>
          )}
          <button type="button" onClick={r.closeModal} className="da-btn da-btn-primary">Done</button>
        </>
      }
    >
      <div className="space-y-5">
        <FormAlert message={r.error} />

        {(r.phase === "starting" || r.phase === "idle" || (r.phase === "pending" && (!r.link || remaining === 0))) && (
          <div className="grid place-items-center gap-3 py-16 text-[13px] text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" /> Making a one-time code…
          </div>
        )}

        {r.phase === "pending" && r.link && remaining > 0 && (
          <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
            <div className="mx-auto flex flex-col items-center">
              <div className="rounded-[30px] bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 p-[2px] shadow-glow">
                <div className="rounded-[28px] bg-white p-4">
                  <QrCode value={r.link.url} size={216} label="QR code to open Orbit on your phone" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-500" aria-live="polite">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold tabular-nums ${remaining <= 30 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-700"}`}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Works for {formatCountdown(remaining)}
                </span>
                <button type="button" onClick={() => void r.startPairing()} className="font-semibold text-indigo-600 hover:text-indigo-700">New code</button>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              <ol className="space-y-3.5">
                <Step n={1} icon={ScanLine} title="Scan with your phone's camera" text="Open the link it shows. Nothing to install." />
                <Step n={2} icon={Hand} title="Hold Orbit's face and speak" text="Say what you need, like “open my approvals” or “connect a database”." />
                <Step n={3} icon={Laptop} title="Let go and watch it happen here" text="Orbit works on this screen. Your phone shows what it is thinking and saying." />
              </ol>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">Your phone opens</span>
                  <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
                <div className="mt-1 truncate font-mono text-[13px] font-semibold text-slate-800" title={r.link.host}>{r.link.host}</div>
                {r.link.reach === "lan" && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-slate-500">
                    <Wifi className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" /> Your phone needs to be on the same Wi-Fi as this computer.
                  </p>
                )}
                {r.link.reach === "lan" && r.lanAddresses.length > 1 && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-500">
                    Network
                    <select
                      value={r.preferredHost ?? r.lanAddresses[0]}
                      onChange={(e) => r.setPreferredHost(e.target.value)}
                      className="da-input w-auto py-1 font-mono text-[12px]"
                      aria-label="Network address for your phone"
                    >
                      {r.lanAddresses.map((ip) => <option key={ip} value={ip}>{ip}</option>)}
                    </select>
                  </label>
                )}
                {r.link.reach === "local" && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> A phone cannot open “localhost”, and no Wi-Fi address was found on this computer.
                    Open DataAuto with this computer's network address, or set ORBIT_REMOTE_PUBLIC_URL.
                  </p>
                )}
              </div>

              {httpsNote && (
                <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>
                    Phones only allow the microphone on secure (https) pages. On this address you can still type to Orbit from the phone.
                    For voice, open DataAuto over https (in development: <code className="font-mono font-semibold">npm run dev:https</code>).
                  </span>
                </p>
              )}

              <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-slate-500">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                The code works once and only for a few minutes. Passwords and keys are never sent from the phone: you type them here.
              </p>
            </div>
          </div>
        )}

        {r.phase === "connected" && r.session && (
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <PhoneOrbitMock
              className="mx-auto"
              width={176}
              state={r.phoneListening ? "listening" : remoteFaceState(presence.state)}
              caption={r.phoneListening ? "Listening…" : "Hold to talk"}
            />
            <div className="min-w-0 space-y-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Connected
                </span>
                <h3 className="mt-3 flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-slate-950">
                  <Smartphone className="h-5 w-5 text-indigo-600" /> {r.session.device_label || "Your phone"}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">
                  Hold Orbit's face on your phone and say what you need. When you let go, Orbit does it here, and your phone
                  follows along: what it is thinking, what it says, and where it goes.
                </p>
              </div>
              {r.phoneListening && (
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-[13px] text-cyan-900" aria-live="polite">
                  <span className="font-semibold">Listening on your phone</span>
                  {r.phoneListening.words ? <span className="mt-0.5 block italic">“{r.phoneListening.words}”</span> : null}
                </div>
              )}
              <ul className="space-y-1.5 text-[12.5px] text-slate-500">
                <li className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.liveLink ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {r.liveLink ? "Live link: the phone mirrors Orbit instantly." : "Live link unavailable: the phone updates every few seconds."}
                </li>
                <li className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.session.device_online === false ? "bg-amber-500" : "bg-emerald-500"}`} />
                  {r.session.device_online === false ? "The phone has not checked in for a minute. Is the page still open there?" : "The phone is open and checking in."}
                </li>
                <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-emerald-500" /> Confirmations, passwords and keys stay on this computer.</li>
              </ul>
            </div>
          </div>
        )}

        {r.phase === "elsewhere" && (
          <div className="space-y-4 py-4 text-center">
            <MonitorSmartphone className="mx-auto h-10 w-10 text-indigo-500" />
            <div>
              <h3 className="text-[17px] font-bold text-slate-950">Your phone is working with another tab</h3>
              <p className="mx-auto mt-1 max-w-md text-[13.5px] text-slate-500">
                {r.session?.device_label || "Your phone"} sends its requests to DataAuto in another tab or window. You can move it here.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void r.takeOver()} className="da-btn da-btn-primary">Use it in this tab</button>
              <button type="button" onClick={() => void r.disconnect()} className="da-btn da-btn-secondary">Disconnect phone</button>
            </div>
          </div>
        )}

        {r.phase === "ended" && (
          <div className="space-y-2 py-10 text-center">
            <Unplug className="mx-auto h-9 w-9 text-slate-400" />
            <h3 className="text-[17px] font-bold text-slate-950">No phone connected</h3>
            <p className="text-[13.5px] text-slate-500">{(r.endReason && ENDED_TEXT[r.endReason]) || "The phone is no longer connected."} Show a new code to connect again.</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
