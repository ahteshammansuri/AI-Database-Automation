import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, Brain, CheckCircle2, ChevronDown, Circle, History, Keyboard, Loader2, MessageSquare, Mic, MicOff, Pause, Play,
  Plus, RotateCcw, Shield, Smartphone, Sparkles, Square, Trash2, Volume2, VolumeX, XCircle,
} from "lucide-react";
import { useOrbitRemote } from "../../context/OrbitRemoteContext";
import { OrbitMascotCharacter, CharacterState } from "./OrbitMascotCharacter";
import { SecureCredentialCard } from "./SecureCredentialCard";
import { useAssistant, ACTIVE_TASK_STATUSES } from "../../context/AssistantContext";
import { collapseTimeline, stageText } from "../../services/orbitBehavior";
import { usePressAndHold } from "../../hooks/usePressAndHold";
import { dockClearance } from "../../hooks/useMascotTravel";
import soundManager from "../../services/soundEffects";
import { FieldError } from "../ui/kit";
import { rules, validateField } from "../../lib/validation";
import { usePlatform } from "../../context/PlatformContext";

export interface AgentOperationalHUDProps {
  isOpen: boolean;
  onClose: () => void;
  characterState: CharacterState;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  voiceError: string | null;
  audioLevel: number | null;
  voiceSupported: boolean;
  usesRemoteRecognition: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onToggleListening: () => void;
}

const PREVIEW_STATES: CharacterState[] = [
  "idle", "greeting", "listening", "thinking", "speaking", "moving", "pointing", "clicking", "typing",
  "working", "validating", "waiting_for_user", "needs_confirmation", "success", "warning", "error", "paused", "offline",
];

const DISCLOSURE_KEY = "orbit_stt_disclosure_ack";


const TimelineIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === "succeeded") return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="w-3 h-3 text-rose-400 shrink-0" />;
  if (status === "running") return <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />;
  if (status === "waiting") return <Circle className="w-3 h-3 text-amber-400 shrink-0" />;
  if (status === "adjusted") return <RotateCcw className="w-3 h-3 text-sky-400 shrink-0" />;
  if (status === "cancelled" || status === "stopped") return <Square className="w-3 h-3 text-slate-400 shrink-0" />;
  return <Circle className="w-3 h-3 text-slate-500 shrink-0" />;
};

export const AgentOperationalHUD: React.FC<AgentOperationalHUDProps> = ({
  isOpen, onClose, characterState, isListening, transcript, interimTranscript, voiceError, audioLevel,
  voiceSupported, usesRemoteRecognition, onStartListening, onStopListening, onToggleListening,
}) => {
  const {
    messages, activeTask, timelineEvents, speech, narration, thinking, turnStage, toolActivity, secureInputRequest, queueStatus,
    awaitingConfirmation, voiceResponsesEnabled, toggleVoiceResponses, interruptTask, confirmTask,
    submitSecureCredentials, sendMessage, isLoading, startNewConversation,
    conversations, loadConversationsList, switchConversation, deleteConversation, conversationId,
    activeModel,
  } = useAssistant();
  const remote = useOrbitRemote();
  const remoteOn = usePlatform().config.orbit.remote_enabled;

  const [showTyping, setShowTyping] = useState(!voiceSupported);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [showChainOfThought, setShowChainOfThought] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showStudio, setShowStudio] = useState(false);
  const [previewState, setPreviewState] = useState<CharacterState>("idle");
  const [sfxMuted, setSfxMuted] = useState(soundManager.isMuted());
  const [disclosureAck, setDisclosureAck] = useState(() => {
    try {
      return localStorage.getItem(DISCLOSURE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!voiceSupported) setShowTyping(true);
  }, [voiceSupported]);

  // The panel sits above docked Orbit (never underneath it), so every control stays clickable.
  const [clearance, setClearance] = useState(() => dockClearance());
  useEffect(() => {
    const onResize = () => setClearance(dockClearance());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const { isHolding, bind: micBind } = usePressAndHold({
    startOnDown: true,
    onHoldStart: () => !isListening && onStartListening(),
    onHoldEnd: () => onStopListening(),
    onTap: () => onToggleListening(),
    holdThresholdMs: 220,
  });

  const status = activeTask?.status;
  const working = status ? ACTIVE_TASK_STATUSES.includes(status) : false;
  const lastUser = useMemo(() => [...messages].reverse().find((m) => m.role === "user"), [messages]);
  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant"), [messages]);
  const recentTimeline = collapseTimeline(
    timelineEvents.filter((e) => !activeTask || e.task_id === activeTask.id),
    working,
  ).slice(-6);

  const ackDisclosure = () => {
    setDisclosureAck(true);
    try {
      localStorage.setItem(DISCLOSURE_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.section
          role="dialog"
          aria-label="Orbit assistant"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          style={{ bottom: clearance, maxHeight: `calc(100vh - ${clearance + 72}px)` }}
          className="fixed right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[420px] overflow-y-auto bg-slate-900/95 backdrop-blur-2xl border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col"
        >
          {/* Header */}
          <header className="p-3.5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/60 rounded-t-3xl">
            <div className="flex items-center gap-3 min-w-0">
              <OrbitMascotCharacter state={characterState} size="sm" />
              <div className="min-w-0">
                <div className="font-bold text-sm text-white">Orbit</div>
                <p className="text-[11px] text-slate-400 truncate" aria-live="polite">
                  {isListening ? "Listening" : stageText(turnStage, toolActivity?.status === "running" ? toolActivity.label : null, status, queueStatus)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {remoteOn && <button type="button" onClick={remote.openModal}
                title={remote.phase === "connected" ? `Phone connected: ${remote.session?.device_label || "your phone"}` : "Use Orbit from your phone"}
                aria-label={remote.phase === "connected" ? "Phone connected (manage)" : "Use Orbit from your phone"}
                className={`relative p-1.5 rounded-xl border ${remote.phase === "connected" ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/40" : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"}`}>
                <Smartphone className="w-3.5 h-3.5" />
                {remote.phase === "connected" && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-950" />}
              </button>}
              <button type="button" onClick={toggleVoiceResponses}
                title={voiceResponsesEnabled ? "Orbit speaks replies (click to mute voice)" : "Voice replies off (click to enable)"}
                className={`p-1.5 rounded-xl border ${voiceResponsesEnabled ? "bg-slate-800 text-cyan-300 border-cyan-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/40"}`}>
                {voiceResponsesEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => setSfxMuted(soundManager.toggleMute())}
                title={sfxMuted ? "Sound effects off" : "Sound effects on"}
                className="p-1.5 rounded-xl border bg-slate-800 border-slate-700 text-slate-400 hover:text-white text-[10px] font-mono w-7">
                {sfxMuted ? "fx̶" : "fx"}
              </button>
              <button type="button" onClick={() => setShowStudio((s) => !s)} title="Preview Orbit's poses (does not affect the live assistant)"
                className={`p-1.5 rounded-xl border ${showStudio ? "bg-indigo-500/25 text-indigo-300 border-indigo-400/50" : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"}`}>
                <Sparkles className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={onClose} title="Minimize" className="p-1.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 hover:text-white">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          {showStudio && (
            <div className="px-4 py-3 bg-slate-950/90 border-b border-indigo-500/30 space-y-2">
              <p className="text-[10px] text-slate-400">Pose preview only. The live Orbit always reflects real activity.</p>
              <div className="flex items-center gap-3">
                <OrbitMascotCharacter state={previewState} size="md" />
                <div className="flex flex-wrap gap-1">
                  {PREVIEW_STATES.map((s) => (
                    <button key={s} type="button" onClick={() => setPreviewState(s)}
                      className={`text-[10px] px-1.5 py-0.5 rounded-md border ${previewState === s ? "bg-indigo-500/30 border-indigo-400 text-white" : "bg-slate-900 border-slate-800 text-slate-400"}`}>
                      {s.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="p-3.5 space-y-3">
            {usesRemoteRecognition && !disclosureAck && (
              <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 space-y-1.5">
                <p>
                  Voice input uses your browser's speech recognition, which may send audio to the browser vendor's speech
                  service. Never say passwords or API keys out loud — Orbit asks for them in a secure field.
                </p>
                <button type="button" onClick={ackDisclosure} className="text-amber-100 underline">Got it</button>
              </div>
            )}

            {status === "QUEUED" && queueStatus && !queueStatus.worker_alive && (
              <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5">
                Your request is saved, but no Orbit background worker is running, so nothing will process it yet.
                Start the services with <span className="font-mono">./run_all.sh</span> (it runs the agent worker).
              </div>
            )}

            {showConversations ? (
              <div className="space-y-3 py-1">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowConversations(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                      title="Back to conversation"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                      Conversations ({conversations.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await startNewConversation();
                      setShowConversations(false);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {conversations.length === 0 ? (
                    <p className="text-center text-xs text-slate-500 py-6">No previous conversations yet.</p>
                  ) : (
                    conversations.map((c) => {
                      const isActive = c.id === conversationId;
                      const lastMsg = c.messages?.[0]?.content;
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            void switchConversation(c.id);
                            setShowConversations(false);
                          }}
                          className={`group relative p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            isActive
                              ? "bg-cyan-950/30 border-cyan-500/40 shadow-sm shadow-cyan-900/20"
                              : "bg-slate-900/50 hover:bg-slate-800/60 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-200 truncate">
                                  {c.title || `Chat #${c.id}`}
                                </span>
                                {isActive && (
                                  <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-semibold border border-cyan-500/30">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                                {lastMsg || "No messages yet"}
                              </p>
                              <span className="text-[9px] text-slate-500 mt-1 block">
                                {new Date(c.updated_at).toLocaleString([], {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <div className="shrink-0 flex items-center gap-1">
                              {deletingId === c.id ? (
                                <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-1 rounded-md border border-rose-500/40">
                                  <span className="text-[9px] text-rose-300">Delete?</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void deleteConversation(c.id);
                                      setDeletingId(null);
                                    }}
                                    className="px-1 text-[9px] font-bold text-rose-400 hover:text-rose-200"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeletingId(null);
                                    }}
                                    className="px-1 text-[9px] text-slate-400 hover:text-slate-200"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingId(c.id);
                                  }}
                                  className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
                                  title="Delete chat"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Caption: what you said, what Orbit said */}
                <div className="bg-slate-950/80 rounded-2xl p-3 border border-slate-800/90 space-y-2" aria-live="polite">
                  {(isListening || isHolding) && (
                    <div className="flex items-center gap-2 text-cyan-300 text-[11px]">
                      <MicOff className="w-3.5 h-3.5 animate-pulse" />
                      <span>{isHolding ? "Listening — release to send" : "Listening — tap to send"}</span>
                      {audioLevel !== null && (
                        <span className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden" aria-hidden>
                          <span className="block h-full bg-cyan-400 transition-[width] duration-75" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
                        </span>
                      )}
                    </div>
                  )}
                  {(interimTranscript || (isListening && transcript)) && (
                    <p className="text-[11px] italic text-cyan-200">“{interimTranscript || transcript}”</p>
                  )}
                  {!isListening && lastUser && (
                    <p className="text-[11px] text-slate-400"><span className="text-cyan-400">You:</span> {lastUser.content}</p>
                  )}
                  {working && narration && <p className="text-[11px] italic text-indigo-300">{narration}</p>}
                  {speech && (
                    <div className="space-y-1">
                      <p className={`text-xs leading-relaxed ${speech.isServiceError ? "text-amber-200" : "text-slate-100"}`}>
                        <span className="text-indigo-300 font-semibold">Orbit:</span> {speech.text}
                      </p>
                      <div className="flex flex-wrap gap-1.5 text-[9px] font-mono">
                        {speech.source === "system" && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            {speech.isServiceError ? "service notice" : "status (not AI-generated)"}
                          </span>
                        )}
                        {speech.delivery === "speaking" && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">speaking</span>}
                        {speech.delivery === "failed" && <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">not spoken: {speech.failureReason}</span>}
                        {speech.delivery === "muted" && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">voice off — text only</span>}
                        {speech.delivery === "cancelled" && <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">interrupted</span>}
                      </div>
                    </div>
                  )}
                  {!speech && !lastUser && !isListening && (
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Hold the mic (or Orbit) and talk. Ask about the portal, check a connection, or have Orbit connect a database for you.
                    </p>
                  )}
                  {voiceError && (
                    <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {voiceError}
                    </p>
                  )}
                  {messages.length > 2 && (
                    <button type="button" onClick={() => setShowHistory((h) => !h)} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
                      <History className="w-3 h-3" /> {showHistory ? "Hide history" : "Show history"}
                    </button>
                  )}
                  {showHistory && (
                    <ul className="max-h-40 overflow-y-auto space-y-1 border-t border-slate-800 pt-2">
                      {messages.slice(-12).map((m) => (
                        <li key={m.id} className="text-[10px] text-slate-400">
                          <span className={m.role === "user" ? "text-cyan-400" : "text-indigo-300"}>{m.role === "user" ? "You" : "Orbit"}:</span> {m.content}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Chain of Thought / Orbit Reasoning & Context Window */}
                {(thinking?.text || lastAssistant?.meta?.thought || working) && (
                  <div className="rounded-2xl border border-violet-500/25 bg-violet-950/20 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowChainOfThought((s) => !s)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-violet-900/10 transition-colors"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-300">
                        <Brain className="w-3.5 h-3.5 text-violet-400" />
                        Orbit Chain of Thought & Context Window
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 text-violet-400 transition-transform duration-200 ${showChainOfThought ? "rotate-180" : ""}`} />
                    </button>

                    {(showChainOfThought || working) && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-violet-500/20 text-[11px] text-slate-300">
                        <div>
                          <span className="text-[10px] font-semibold text-violet-300 block mb-0.5">Reasoning / Thought:</span>
                          <p className="text-violet-100 bg-violet-950/40 p-2 rounded-xl border border-violet-500/20 leading-relaxed font-sans">
                            {thinking?.text
                              || lastAssistant?.meta?.thought
                              || (working ? "Analyzing database schema, permissions and user prompt." : "Ready to assist with your database and automations.")}
                          </p>
                        </div>

                        {((thinking?.next && thinking.next.length > 0) || (activeTask?.active_plan && activeTask.active_plan.length > 0)) && (
                          <div>
                            <span className="text-[10px] font-semibold text-violet-300 block mb-0.5">Execution Plan:</span>
                            <ol className="list-decimal ml-4 space-y-0.5 text-violet-200/90 font-mono text-[10px]">
                              {(thinking?.next || activeTask?.active_plan?.map((p) => p.label || p.tool) || []).map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-violet-900/30 text-[10px]">
                          <div>
                            <span className="text-slate-500 block">AI Model:</span>
                            <span className="text-cyan-300 font-mono font-medium">
                              {thinking?.model
                                || lastAssistant?.meta?.model
                                || activeTask?.slots?._active_model
                                || activeModel?.label
                                || (activeModel?.model ? `${activeModel.provider}: ${activeModel.model}` : "Google Gemini (gemini-3.5-flash-lite)")}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Active Path:</span>
                            <span className="text-slate-300 font-mono truncate block">{window.location.pathname}</span>
                          </div>
                          {activeTask?.slots?.connection_id && (
                            <div>
                              <span className="text-slate-500 block">Target DB:</span>
                              <span className="text-emerald-300 font-mono">Conn #{activeTask.slots.connection_id}</span>
                            </div>
                          )}
                          {activeTask?.slots?.table && (
                            <div>
                              <span className="text-slate-500 block">Target Table:</span>
                              <span className="text-amber-300 font-mono">{activeTask.slots.table}</span>
                            </div>
                          )}
                        </div>

                        {lastAssistant?.meta?.rag && (
                          <div className="pt-1 text-[10px] text-slate-400">
                            <span className="text-emerald-400 font-semibold">Knowledge Retrieved: </span>
                            <span>{lastAssistant.meta.rag.count ?? 0} passage(s)</span>
                            {lastAssistant.meta.rag.source_ids?.length > 0 && (
                              <span className="font-mono text-slate-500 ml-1">({lastAssistant.meta.rag.source_ids.slice(0, 3).join(", ")})</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Real operation timeline */}
                {activeTask && recentTimeline.length > 0 && (
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-300">What Orbit actually did</span>
                      {(activeTask.plan_version ?? 1) > 1 && <span className="font-mono">plan v{activeTask.plan_version}</span>}
                    </div>
                    <ol className="space-y-1">
                      {recentTimeline.map((e) => (
                        <li key={e.id} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                          <TimelineIcon status={e.status} />
                          <span className="min-w-0 break-words">{e.message}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {secureInputRequest && (
                  <SecureCredentialCard kind={secureInputRequest.kind} onSubmit={submitSecureCredentials} disabled={isLoading}
                    onCancel={() => interruptTask("STOP")} />
                )}

                {awaitingConfirmation && (
                  <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-3 space-y-2">
                    <p className="text-xs text-amber-200 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      Orbit is waiting for your OK to run <span className="font-mono">{awaitingConfirmation.tool}</span>.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={confirmTask} disabled={isLoading}
                        className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-xl text-xs">Confirm</button>
                      <button type="button" onClick={() => interruptTask("STOP")} className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-xl text-xs">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Voice-first controls */}
                <div className="flex items-center gap-2">
                  <button type="button" {...micBind} disabled={!voiceSupported}
                    aria-pressed={isListening}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-xs select-none touch-none transition-all ${
                      isHolding || isListening ? "bg-cyan-500 text-slate-950 ring-4 ring-cyan-500/20" : "bg-gradient-to-r from-cyan-600 to-indigo-600 text-white hover:from-cyan-500 hover:to-indigo-500"
                    } disabled:opacity-40`}>
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    <span>{isHolding ? "Release to send" : isListening ? "Tap to send" : "Hold or tap to talk"}</span>
                  </button>
                  {activeTask && working && (
                    <button type="button" onClick={() => interruptTask("PAUSE")} title="Pause at the next safe step"
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-2xl">
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {activeTask && status === "PAUSED" && (
                    <button type="button" onClick={() => interruptTask("RESUME")} title="Resume"
                      className="p-3 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-2xl">
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {activeTask && (working || status === "PAUSED" || status === "WAITING_FOR_INPUT") && (
                    <button type="button" onClick={() => interruptTask("STOP")} title="Stop: no new steps start"
                      className="p-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-2xl">
                      <Square className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setShowTyping((s) => !s)} className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1">
                <Keyboard className="w-3.5 h-3.5" /> {showTyping ? "Hide typing" : "Type instead"}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void loadConversationsList();
                    setShowConversations((s) => !s);
                  }}
                  className={`text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1 transition-colors ${
                    showConversations ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-cyan-200 hover:bg-slate-800/70"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Chats ({conversations.length})
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await startNewConversation();
                    setShowConversations(false);
                  }}
                  className="text-[11px] text-slate-400 hover:text-cyan-200 px-2 py-0.5 rounded-md hover:bg-slate-800/70"
                >
                  New conversation
                </button>
              </div>
            </div>
            {showTyping && (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isLoading) return;
                  const problem = validateField("message", { message: typed }, {
                    message: [rules.required("Message", "Type a message for Orbit first."), rules.maxLength(4000, "Message")],
                  });
                  setTypedError(problem);
                  if (problem) return;
                  void sendMessage(typed.trim(), false);
                  setTyped("");
                }}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    id="orbit-typed"
                    type="text"
                    value={typed}
                    onChange={(e) => { setTyped(e.target.value); setTypedError(null); }}
                    placeholder="Type to Orbit (never type passwords here)"
                    aria-label="Type a message to Orbit"
                    aria-invalid={!!typedError}
                    aria-describedby={typedError ? "orbit-typed-error" : undefined}
                    disabled={isLoading}
                    className={`flex-1 min-w-0 bg-slate-950/80 border rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none ${typedError ? "border-rose-400/80 focus:border-rose-400" : "border-slate-700/80 focus:border-cyan-500"}`}
                  />
                  <button type="submit" disabled={isLoading}
                    className="px-3 py-2 bg-slate-800 disabled:opacity-40 text-xs text-cyan-300 border border-cyan-500/30 rounded-xl">Send</button>
                </div>
                <FieldError id="orbit-typed" message={typedError} tone="dark" />
              </form>
            )}
          </div>

          <footer className="px-4 py-2 bg-slate-950/80 border-t border-slate-800/80 rounded-b-3xl flex items-center gap-1.5 text-[10px] text-slate-500">
            <Shield className="w-3 h-3 text-cyan-400/80" />
            <span>Orbit uses registered portal tools only — no raw SQL, no deletes on your database.</span>
          </footer>
        </motion.section>
      )}
    </AnimatePresence>
  );
};

export default AgentOperationalHUD;
