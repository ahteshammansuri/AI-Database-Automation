import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "../services/api";
import { useLiveEvents } from "./LiveEventsContext";
import { useToast } from "./ToastContext";
import { CharacterState } from "../components/agent/AuraCoreCharacter";
import { redactSecretsFromUtterance } from "../services/secretRedactor";
import { ttsAdapter } from "../services/ttsAdapter";
import { pageStateService } from "../services/pageStateService";
import { runUiAction } from "../services/orbitRuntime";
import { orbitStage } from "../services/orbitStage";
import soundManager from "../services/soundEffects";
import { ACTIVE_TASK_STATUSES, TERMINAL_STATUSES, deriveCharacterState } from "../services/orbitBehavior";

export interface AgentTimelineEvent {
  id: number;
  task_id: number;
  step_name: string;
  status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";
  message: string;
  details?: any;
  created_at: string;
}

export type AgentTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "WAITING_FOR_APPROVAL"
  | "PAUSE_REQUESTED"
  | "PAUSED"
  | "INTERRUPT_REQUESTED"
  | "CANCELLED"
  | "SUCCEEDED"
  | "ANSWERED"
  | "PARTIAL_SUCCESS"
  | "FAILED"
  | "SUPERSEDED"
  | string;

export interface AgentTask {
  id: number;
  task_type: string;
  goal: string;
  status: AgentTaskStatus;
  stage?: string | null;
  plan_version?: number;
  autonomy_level: "PREPARE_FOR_REVIEW" | "CONFIRM_CONSEQUENTIAL_CHANGES" | "AUTOMATIC_WITHIN_PERMISSIONS";
  active_plan?: Array<{ tool: string; label: string; args?: any }>;
  current_step_index: number;
  pending_tool_call?: { name: string; args: any } | null;
  last_decision?: any;
  target_resource_type?: string;
  target_resource_id?: string;
  error_message?: string;
  timeline_events?: AgentTimelineEvent[];
  created_at: string;
}

export interface AgentMessage {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: any[];
  tool_results?: any[];
  secure_input_type?: string | null;
  is_voice?: boolean;
  meta?: any;
  created_at: string;
}

export type SpeechDelivery = "pending" | "speaking" | "spoken" | "failed" | "muted" | "cancelled";

export interface OrbitSpeech {
  messageId: number | null;
  text: string;
  emotion: string;
  style: string;
  source: "model" | "system";
  isServiceError: boolean;
  delivery: SpeechDelivery;
  failureReason?: string;
}

/** Where a queued turn is waiting (from the server's real agent queue). */
export interface QueueStatus {
  position: number;
  ahead: number;
  running: number;
  worker_alive: boolean;
}

export interface ToolActivity {
  traceId: string;
  tool: string;
  label: string;
  status: "running" | "succeeded" | "failed";
  message?: string;
}

export { ACTIVE_TASK_STATUSES };

interface AssistantContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;

  /** Derived from real runtime state (turn stage, task status, speech). */
  characterState: CharacterState;
  /** Local, non-operational state only (e.g. listening). Ignored while Orbit is working. */
  setCharacterState: (st: CharacterState) => void;

  conversationId: number | null;
  messages: AgentMessage[];
  activeTask: AgentTask | null;
  timelineEvents: AgentTimelineEvent[];
  isLoading: boolean;
  turnStage: string | null;
  toolActivity: ToolActivity | null;
  speech: OrbitSpeech | null;
  narration: string | null;
  isSpeaking: boolean;
  secureInputRequest: { kind: string; taskId: number } | null;
  queueStatus: QueueStatus | null;
  awaitingConfirmation: { taskId: number; tool: string } | null;
  autonomyLevel: string;
  setAutonomyLevel: (lvl: string) => Promise<void>;

  /** Kept for compatibility; travel is now driven by orbitStage events. */
  activeAnchor: string | null;
  setActiveAnchor: (anchor: string | null) => void;
  activeRoute: string | null;
  setActiveRoute: (route: string | null) => void;
  lastSpokenSpeech: string;
  setLastSpokenSpeech: (txt: string) => void;
  voiceResponsesEnabled: boolean;
  setVoiceResponsesEnabled: (enabled: boolean) => void;
  toggleVoiceResponses: () => void;

  sendMessage: (content: string, isVoice?: boolean, secureInputData?: any) => Promise<void>;
  handleVoiceTranscript: (transcript: string) => Promise<void>;
  interruptTask: (action?: "STOP" | "PAUSE" | "RESUME") => Promise<void>;
  requestInterrupt: (action?: "STOP" | "PAUSE") => Promise<void>;
  requestPause: () => Promise<void>;
  correctTask: (correction: string) => Promise<void>;
  confirmTask: () => Promise<void>;
  submitSecureCredentials: (data: any) => Promise<void>;
  startNewConversation: () => Promise<void>;
}

const AssistantContext = createContext<AssistantContextType | undefined>(undefined);

const SECURE_LABEL: Record<string, string> = { database_password: "database password", api_key: "API key" };

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localState, setLocalState] = useState<CharacterState>("idle");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const conversationIdRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const activeTaskRef = useRef<AgentTask | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<AgentTimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [turnStage, setTurnStage] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null);
  const [speech, setSpeech] = useState<OrbitSpeech | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const loadingConversation = useRef<Promise<number | null> | null>(null);
  const [autonomyLevel, setAutonomyLevelState] = useState("CONFIRM_CONSEQUENTIAL_CHANGES");
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [voiceResponsesEnabled, setVoiceResponsesEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  voiceEnabledRef.current = voiceResponsesEnabled;
  const spokenMessageIds = useRef<Set<number>>(new Set());
  const seenTimelineIds = useRef<Set<number>>(new Set());

  const { addListener, setFastPolling, status: liveStatus } = useLiveEvents();
  const { toast } = useToast();

  const setTask = useCallback((t: AgentTask | null) => {
    activeTaskRef.current = t;
    setActiveTask(t);
  }, []);

  const applyTimeline = useCallback((events: AgentTimelineEvent[]) => {
    seenTimelineIds.current = new Set(events.map((e) => e.id));
    setTimelineEvents(events);
  }, []);

  // ------------------------------------------------------------------
  // Speech: one channel, only model/system text from the server, never canned.
  // ------------------------------------------------------------------

  useEffect(() => {
    return ttsAdapter.subscribe((e) => {
      if (e.type === "start") {
        setIsSpeaking(true);
        setSpeech((s) => (s && ttsAdapter.cleanSpokenText(s.text) === e.text ? { ...s, delivery: "speaking" } : s));
      } else if (e.type === "end" || e.type === "cancelled" || e.type === "error") {
        setIsSpeaking(false);
        setSpeech((s) => {
          if (!s || ttsAdapter.cleanSpokenText(s.text) !== e.text) return s;
          if (e.type === "end") return { ...s, delivery: "spoken" };
          if (e.type === "cancelled") return { ...s, delivery: "cancelled" };
          return { ...s, delivery: "failed", failureReason: e.reason };
        });
      }
    });
  }, []);

  const presentSpeech = useCallback((msg: AgentMessage | null, fallback?: Partial<OrbitSpeech>) => {
    const text = msg?.content ?? fallback?.text ?? "";
    if (!text) return;
    const meta = msg?.meta || {};
    const id = msg?.id ?? fallback?.messageId ?? null;
    if (id !== null && spokenMessageIds.current.has(id)) return;
    if (id !== null) spokenMessageIds.current.add(id);

    const next: OrbitSpeech = {
      messageId: id,
      text,
      emotion: meta.emotion_hint ?? fallback?.emotion ?? "neutral",
      style: meta.response_style ?? fallback?.style ?? "conversational",
      source: (meta.source ?? fallback?.source ?? "model") as "model" | "system",
      isServiceError: Boolean(meta.is_service_error ?? fallback?.isServiceError),
      delivery: voiceEnabledRef.current ? "pending" : "muted",
    };
    setSpeech(next);
    setNarration(null);
    if (voiceEnabledRef.current) void ttsAdapter.speak(text);
  }, []);

  // ------------------------------------------------------------------
  // Loading persisted state (initial load, reconnect, after events)
  // ------------------------------------------------------------------

  const refreshConversation = useCallback(async (convId?: number | null) => {
    const id = convId ?? conversationIdRef.current;
    if (!id) return null;
    try {
      const res: any = await api.getAgentConversation(id);
      const msgs: AgentMessage[] = res?.conversation?.messages || [];
      setMessages(msgs);
      const task: AgentTask | null = res?.active_task || null;
      setTask(task);
      setQueueStatus(res?.queue ?? null);
      applyTimeline(task?.timeline_events || []);
      setTurnStage(task && ACTIVE_TASK_STATUSES.includes(task.status) ? task.stage || "QUEUED" : null);
      return { msgs, task };
    } catch {
      return null;
    }
  }, [applyTimeline, setTask]);

  const loadConversation = useCallback((): Promise<number | null> => {
    // Single flight: React StrictMode runs mount effects twice, which created duplicate conversations.
    if (!loadingConversation.current) {
      loadingConversation.current = loadConversationOnce().finally(() => {
        loadingConversation.current = null;
      });
    }
    return loadingConversation.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConversationOnce(): Promise<number | null> {
    if (!localStorage.getItem("auth_token")) return null;
    try {
      const listRes: any = await api.listAgentConversations();
      const list = listRes?.conversations || [];
      let targetId: number;
      if (list.length > 0) {
        targetId = list[0].id;
      } else {
        const created: any = await api.createAgentConversation("Orbit");
        targetId = created.conversation.id;
      }
      setConversationId(targetId);
      conversationIdRef.current = targetId;
      const loaded = await refreshConversation(targetId);
      // Never re-speak history on page load.
      loaded?.msgs.forEach((m) => spokenMessageIds.current.add(m.id));

      const prefRes: any = await api.getAgentPreferences();
      const pref = prefRes?.preferences || {};
      if (pref.autonomy_level) setAutonomyLevelState(pref.autonomy_level);
      if (pref.voice_enabled !== undefined) setVoiceResponsesEnabled(Boolean(pref.voice_enabled));
      return targetId;
    } catch (e) {
      console.warn("Failed to initialize Orbit conversation:", e);
      return null;
    }
  }

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // Reconcile with persisted server state whenever the live channel reconnects.
  const prevLiveStatus = useRef(liveStatus);
  useEffect(() => {
    if (prevLiveStatus.current === "reconnecting" && liveStatus === "connected") {
      void refreshConversation();
    }
    prevLiveStatus.current = liveStatus;
  }, [liveStatus, refreshConversation]);

  // Heartbeat: tells the server this page can perform visible UI actions.
  useEffect(() => {
    if (!localStorage.getItem("auth_token")) return;
    const beat = () => api.agentHeartbeat().catch(() => {});
    beat();
    const t = setInterval(beat, 25000);
    return () => clearInterval(t);
  }, []);

  // While a turn waits in the queue, refresh its real position and worker liveness.
  useEffect(() => {
    if (activeTask?.status !== "QUEUED") {
      setQueueStatus(null);
      return;
    }
    const id = activeTask.id;
    let stop = false;
    const poll = async () => {
      try {
        const res: any = await api.getAgentTask(id);
        if (stop) return;
        setQueueStatus(res?.queue ?? null);
        if (res?.task && res.task.status !== "QUEUED") {
          setActiveTask((prev) => (prev && prev.id === id ? { ...prev, status: res.task.status, stage: res.task.stage } : prev));
        }
      } catch {
        // keep last known status
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [activeTask?.id, activeTask?.status]);

  // Fast event polling only while a turn is in flight.
  const working = isLoading || (activeTask ? ACTIVE_TASK_STATUSES.includes(activeTask.status) : false);
  useEffect(() => {
    setFastPolling(working);
  }, [working, setFastPolling]);

  // ------------------------------------------------------------------
  // Live agent events
  // ------------------------------------------------------------------

  useEffect(() => {
    return addListener((evt) => {
      const name = evt.event_name;
      if (!name?.startsWith("agent.")) return;
      const p = evt.payload || {};
      const current = activeTaskRef.current;
      const isCurrentTask = !current || current.id === p.task_id;

      switch (name) {
        case "agent.ui_action":
          void runUiAction(p);
          break;
        case "agent.turn_stage":
          if (isCurrentTask) setTurnStage(p.stage);
          if (p.stage === "THINKING") setToolActivity(null);
          break;
        case "agent.narration":
          if (isCurrentTask) {
            setNarration(p.text);
            if (voiceEnabledRef.current && !ttsAdapter.isSpeaking()) void ttsAdapter.speak(p.text);
          }
          break;
        case "agent.tool_started":
          setToolActivity({ traceId: p.trace_id, tool: p.tool, label: p.label, status: "running" });
          break;
        case "agent.tool_finished":
          setToolActivity({
            traceId: p.trace_id, tool: p.tool, label: p.label,
            status: p.success ? "succeeded" : "failed", message: p.safe_message,
          });
          break;
        case "agent.timeline_event":
          if (p.id && seenTimelineIds.current.has(p.id)) break;
          if (p.id) seenTimelineIds.current.add(p.id);
          setTimelineEvents((prev) => [...prev, {
            id: p.id ?? Date.now(), task_id: p.task_id, step_name: p.step_name, status: p.status,
            message: p.message, details: p.details, created_at: p.created_at || new Date().toISOString(),
          }]);
          break;
        case "agent.task_updated":
          setActiveTask((prev) => {
            const next = prev && prev.id === p.task_id
              ? { ...prev, status: p.status, stage: p.stage, plan_version: p.plan_version, error_message: p.error_message,
                  pending_tool_call: p.awaiting_confirmation_for ? { name: p.awaiting_confirmation_for, args: {} } : null }
              : prev;
            activeTaskRef.current = next;
            return next;
          });
          if (TERMINAL_STATUSES.includes(p.status) || ["WAITING_FOR_INPUT", "WAITING_FOR_APPROVAL", "PAUSED"].includes(p.status)) {
            setTurnStage(null);
          }
          break;
        case "agent.speech":
          void (async () => {
            const loaded = await refreshConversation();
            const msg = loaded?.msgs.find((m) => m.id === p.message_id) || null;
            presentSpeech(msg, {
              messageId: p.message_id, text: p.speech_text, emotion: p.emotion_hint, style: p.response_style,
              source: p.source, isServiceError: p.is_service_error,
            });
            // Stay beside a field that still needs the user; otherwise return to the dock.
            if (!(p.task_status === "WAITING_FOR_INPUT" && p.secure_input_type)) {
              setTimeout(() => orbitStage.emit({ type: "return" }), 1500);
            }
          })();
          break;
      }
    });
  }, [addListener, presentSpeech, refreshConversation]);

  // ------------------------------------------------------------------
  // Derived character state (never driven by timers for real work)
  // ------------------------------------------------------------------

  const characterState = useMemo(() => deriveCharacterState({
    taskStatus: activeTask?.status,
    turnStage,
    sending: isLoading,
    speaking: isSpeaking,
    runningTool: toolActivity?.status === "running" ? toolActivity.tool : null,
    speechEmotion: speech?.emotion,
    serviceError: speech?.isServiceError,
    localState,
  }) as CharacterState, [activeTask?.status, isLoading, turnStage, toolActivity, isSpeaking, speech, localState]);

  const secureInputRequest = useMemo(() => {
    if (!activeTask || activeTask.status !== "WAITING_FOR_INPUT") return null;
    const kind = activeTask.last_decision?.secure_input_type
      || [...messages].reverse().find((m) => m.role === "assistant")?.secure_input_type;
    return kind ? { kind, taskId: activeTask.id } : null;
  }, [activeTask, messages]);

  const awaitingConfirmation = useMemo(() => {
    if (!activeTask || activeTask.status !== "WAITING_FOR_APPROVAL") return null;
    return { taskId: activeTask.id, tool: activeTask.pending_tool_call?.name || "the requested action" };
  }, [activeTask]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const sendMessage = async (content: string, isVoice = false, secureInputData?: any) => {
    let convId = conversationIdRef.current;
    if (!convId) convId = await loadConversation();
    if (!convId) {
      toast.error("Orbit unavailable", "Could not start a session. Check that you are signed in.");
      return;
    }

    // Secrets never enter the transcript or the model request: route them to the secure channel.
    const { redactedText, hasRedaction, extractedSecrets } = redactSecretsFromUtterance(content);
    const secure: Record<string, any> = { ...(secureInputData || {}) };
    if (hasRedaction) {
      if (extractedSecrets.password) secure.password = extractedSecrets.password;
      if (extractedSecrets.apiKey) secure.api_key = extractedSecrets.apiKey;
      toast.info("Secret kept private", "A credential in your message was moved to the secure channel.");
    }

    ttsAdapter.stop();
    setNarration(null);
    setMessages((prev) => [...prev, {
      id: -Date.now(), role: "user", content: redactedText, is_voice: isVoice, created_at: new Date().toISOString(),
    }]);
    setIsLoading(true);
    setIsOpen(true);
    soundManager.playSoundForBehavior("thinking");

    try {
      const res: any = await api.postAgentMessage(
        convId, redactedText, isVoice, Object.keys(secure).length ? secure : undefined, pageStateService.getSnapshot()
      );
      if (res?.conversation?.messages) setMessages(res.conversation.messages);
      if (res?.task) {
        setTask(res.task);
        setQueueStatus(res.queue ?? null);
        applyTimeline(res.task.timeline_events || []);
        setTurnStage(ACTIVE_TASK_STATUSES.includes(res.task.status) ? res.task.stage || "QUEUED" : null);
        // If the turn already finished (fast/sync worker), present its reply now.
        if (!ACTIVE_TASK_STATUSES.includes(res.task.status)) {
          const last = [...(res.conversation?.messages || [])].reverse().find((m: AgentMessage) => m.role === "assistant");
          if (last && last.meta?.task_id === res.task.id) presentSpeech(last);
        }
      }
    } catch (err: any) {
      toast.error("Orbit could not take that request", err?.message || "The server did not accept the message.");
      setSpeech({
        messageId: null, text: `I couldn't send that: ${err?.message || "server unavailable"}.`, emotion: "concerned",
        style: "error", source: "system", isServiceError: true, delivery: "muted",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceTranscript = async (transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;
    setIsOpen(true);
    await sendMessage(clean, true);
  };

  const interruptTask = async (action: "STOP" | "PAUSE" | "RESUME" = "STOP") => {
    ttsAdapter.stop();
    const task = activeTaskRef.current;
    if (!task) return;
    try {
      const res: any = await api.interruptAgentTask(task.id, action);
      if (res?.task) {
        setTask(res.task);
        applyTimeline(res.task.timeline_events || []);
      }
      if (action !== "RESUME") orbitStage.emit({ type: "return" });
      toast.info(action === "STOP" ? "Stopping" : action === "PAUSE" ? "Pausing" : "Resuming", res?.message || "");
    } catch (err: any) {
      toast.error("Could not reach Orbit", err?.message || "Interrupt failed.");
    }
  };

  const confirmTask = async () => {
    const task = activeTaskRef.current;
    if (!task) return;
    setIsLoading(true);
    try {
      const res: any = await api.confirmAgentTask(task.id);
      if (res?.task) setTask(res.task);
      if (res?.conversation?.messages) setMessages(res.conversation.messages);
    } catch (err: any) {
      toast.error("Confirmation failed", err?.message || "Could not confirm.");
    } finally {
      setIsLoading(false);
    }
  };

  const submitSecureCredentials = async (data: { password?: string; api_key?: string }) => {
    const kind = data.api_key ? "api_key" : "database_password";
    await sendMessage(`I entered the ${SECURE_LABEL[kind]} in the secure field.`, false, data);
  };

  const updateAutonomyLevel = async (lvl: string) => {
    setAutonomyLevelState(lvl);
    try {
      await api.updateAgentPreferences({ autonomy_level: lvl });
      toast.success("Autonomy updated", lvl.replace(/_/g, " ").toLowerCase());
    } catch (err) {
      console.warn("Failed to update autonomy preference:", err);
    }
  };

  const toggleVoiceResponses = async () => {
    const next = !voiceResponsesEnabled;
    setVoiceResponsesEnabled(next);
    if (!next) ttsAdapter.stop();
    try {
      await api.updateAgentPreferences({ voice_enabled: next });
    } catch {
      // local preference still applies
    }
  };

  const startNewConversation = async () => {
    try {
      ttsAdapter.stop();
      const created: any = await api.createAgentConversation("Orbit");
      setConversationId(created.conversation.id);
      conversationIdRef.current = created.conversation.id;
      setMessages([]);
      setTask(null);
      applyTimeline([]);
      setTurnStage(null);
      setToolActivity(null);
      setSpeech(null);
      setNarration(null);
      orbitStage.emit({ type: "return" });
    } catch (err: any) {
      toast.error("Error", err?.message || "Failed to start a new conversation.");
    }
  };

  return (
    <AssistantContext.Provider
      value={{
        isOpen,
        setIsOpen,
        toggleOpen: () => setIsOpen((p) => !p),
        isDrawerOpen: isOpen,
        setIsDrawerOpen: setIsOpen,
        toggleDrawer: () => setIsOpen((p) => !p),
        characterState,
        setCharacterState: setLocalState,
        conversationId,
        messages,
        activeTask,
        timelineEvents,
        isLoading,
        turnStage,
        toolActivity,
        speech,
        narration,
        isSpeaking,
        secureInputRequest,
        queueStatus,
        awaitingConfirmation,
        autonomyLevel,
        setAutonomyLevel: updateAutonomyLevel,
        activeAnchor,
        setActiveAnchor,
        activeRoute,
        setActiveRoute,
        lastSpokenSpeech: speech?.text || "",
        setLastSpokenSpeech: () => {},
        voiceResponsesEnabled,
        setVoiceResponsesEnabled,
        toggleVoiceResponses,
        sendMessage,
        handleVoiceTranscript,
        interruptTask,
        requestInterrupt: (a = "STOP") => interruptTask(a),
        requestPause: () => interruptTask("PAUSE"),
        correctTask: (c: string) => sendMessage(c, false),
        confirmTask,
        submitSecureCredentials,
        startNewConversation,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
};

export const useAssistant = () => {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
};
