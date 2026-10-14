import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api } from "../services/api";
import { useLiveEvents } from "./LiveEventsContext";
import { useToast } from "./ToastContext";
import { CharacterState } from "../components/agent/AuraCoreCharacter";
import { actionBridge } from "../services/actionBridge";

export interface AgentTimelineEvent {
  id: number;
  task_id: number;
  step_name: string;
  status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";
  message: string;
  details?: any;
  created_at: string;
}

export interface AgentTask {
  id: number;
  task_type: string;
  goal: string;
  status:
    | "DRAFT"
    | "READY"
    | "QUEUED"
    | "RUNNING"
    | "WAITING_FOR_INPUT"
    | "WAITING_FOR_PROVIDER"
    | "WAITING_FOR_APPROVAL"
    | "VALIDATING"
    | "COMMITTING"
    | "SUCCEEDED"
    | "INTERRUPT_REQUESTED"
    | "PAUSE_REQUESTED"
    | "PAUSED"
    | "CANCELLED"
    | "PARTIAL_SUCCESS"
    | "FAILED";
  autonomy_level: "PREPARE_FOR_REVIEW" | "CONFIRM_CONSEQUENTIAL_CHANGES" | "AUTOMATIC_WITHIN_PERMISSIONS";
  active_plan?: Array<{ tool: string; label: string; args: any }>;
  current_step_index: number;
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
  created_at: string;
}

interface AssistantContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  // Deprecated drawer aliases preserved for compatibility
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;

  characterState: CharacterState;
  setCharacterState: (st: CharacterState) => void;

  conversationId: number | null;
  messages: AgentMessage[];
  activeTask: AgentTask | null;
  timelineEvents: AgentTimelineEvent[];
  isLoading: boolean;
  autonomyLevel: string;
  setAutonomyLevel: (lvl: string) => Promise<void>;

  // Voice & Travel State
  activeAnchor: string | null;
  setActiveAnchor: (anchor: string | null) => void;
  activeRoute: string | null;
  setActiveRoute: (route: string | null) => void;
  lastSpokenSpeech: string;
  setLastSpokenSpeech: (txt: string) => void;
  voiceResponsesEnabled: boolean;
  setVoiceResponsesEnabled: (enabled: boolean) => void;
  toggleVoiceResponses: () => void;

  // Actions
  sendMessage: (content: string, isVoice?: boolean, secureInputData?: any) => Promise<void>;
  handleVoiceTranscript: (transcript: string) => Promise<void>;
  interruptTask: (action?: "STOP" | "PAUSE") => Promise<void>;
  requestInterrupt: (action?: "STOP" | "PAUSE") => Promise<void>;
  requestPause: () => Promise<void>;
  correctTask: (correction: string) => Promise<void>;
  confirmTask: () => Promise<void>;
  submitSecureCredentials: (data: any) => Promise<void>;
  startNewConversation: () => Promise<void>;
}

const AssistantContext = createContext<AssistantContextType | undefined>(undefined);

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [characterState, setCharacterState] = useState<CharacterState>("idle");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const conversationIdRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<AgentTimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [autonomyLevel, setAutonomyLevelState] = useState<string>("CONFIRM_CONSEQUENTIAL_CHANGES");

  // Voice & Mascot Travel State
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [lastSpokenSpeech, setLastSpokenSpeech] = useState<string>("");
  const [voiceResponsesEnabled, setVoiceResponsesEnabled] = useState<boolean>(false);

  const { addListener } = useLiveEvents();
  const { toast } = useToast();

  // Load existing conversation or create fresh one on init
  const loadConversation = useCallback(async (): Promise<number | null> => {
    const token = localStorage.getItem("auth_token");
    if (!token) return null;

    try {
      const listRes: any = await api.listAgentConversations();
      const list = listRes?.conversations || [];
      let targetId: number;

      if (list.length > 0) {
        targetId = list[0].id;
        setConversationId(targetId);
        conversationIdRef.current = targetId;
        const detailRes: any = await api.getAgentConversation(targetId);
        const msgs = detailRes?.conversation?.messages || [];
        setMessages(msgs);
        // Do NOT auto-speak on initial page load; keep assistant silent and let HUD display text
        if (detailRes?.active_task) {
          setActiveTask(detailRes.active_task);
          setTimelineEvents(detailRes.active_task.timeline_events || []);
        }
      } else {
        const createRes: any = await api.createAgentConversation("Initial Consultation");
        targetId = createRes.conversation.id;
        setConversationId(targetId);
        conversationIdRef.current = targetId;
        setMessages([]);
      }

      // Load user preferences
      const prefRes: any = await api.getAgentPreferences();
      if (prefRes?.preferences?.autonomy_level) {
        setAutonomyLevelState(prefRes.preferences.autonomy_level);
      }
      if (prefRes?.preferences?.voice_responses_enabled !== undefined) {
        setVoiceResponsesEnabled(Boolean(prefRes.preferences.voice_responses_enabled));
      }

      return targetId;
    } catch (e) {
      console.warn("Failed to initialize agent conversation:", e);
      return null;
    }
  }, []);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // Derive Character State from activeTask & loading state across the 17-state machine
  useEffect(() => {
    if (isLoading) {
      setCharacterState("understanding");
      return;
    }

    if (!activeTask) {
      setCharacterState("idle");
      return;
    }

    switch (activeTask.status) {
      case "RUNNING":
      case "COMMITTING":
        setCharacterState("executing");
        break;
      case "WAITING_FOR_INPUT":
        setCharacterState("waiting_for_user");
        break;
      case "WAITING_FOR_APPROVAL":
        setCharacterState("needs_confirmation");
        break;
      case "WAITING_FOR_PROVIDER":
        setCharacterState("interacting");
        break;
      case "INTERRUPT_REQUESTED":
        setCharacterState("cancelled");
        break;
      case "PAUSED":
      case "PAUSE_REQUESTED":
        setCharacterState("paused");
        break;
      case "SUCCEEDED":
        setCharacterState("success");
        break;
      case "PARTIAL_SUCCESS":
        setCharacterState("success");
        break;
      case "FAILED":
        setCharacterState("error");
        break;
      case "CANCELLED":
        setCharacterState("cancelled");
        break;
      default:
        setCharacterState("idle");
        break;
    }
  }, [activeTask, isLoading]);

  // Subscribe to real-time agent SSE events via LiveEventsContext
  useEffect(() => {
    const unsubscribe = addListener((evt) => {
      if (evt.event_name === "agent.timeline_event" && evt.payload) {
        const p = evt.payload;
        setTimelineEvents((prev) => [
          ...prev,
          {
            id: Date.now(),
            task_id: p.task_id,
            step_name: p.step_name,
            status: p.status,
            message: p.message,
            details: p.details,
            created_at: p.created_at || new Date().toISOString(),
          },
        ]);

        if (activeTask && activeTask.id === p.task_id) {
          setActiveTask((prev) => (prev ? { ...prev, status: p.task_status || prev.status } : null));
        }
      } else if (evt.event_name === "agent.task_updated" && evt.payload) {
        const p = evt.payload;
        setActiveTask((prev) => {
          if (!prev || prev.id !== p.task_id) return prev;
          return {
            ...prev,
            status: p.status,
            current_step_index: p.current_step_index,
            error_message: p.error_message,
          };
        });
      } else if (evt.event_name === "agent.action_requested" && evt.payload) {
        const p = evt.payload;
        if (p.action) {
          actionBridge.dispatch(p.action, p.payload);
        }
      }
    });

    return () => unsubscribe();
  }, [addListener, activeTask]);

  // Map semantic intent / task steps to application route & anchor
  const mapIntentToNavigation = useCallback((task: AgentTask | null, goalPrompt: string) => {
    const lower = (goalPrompt + " " + (task?.task_type || "")).toLowerCase();

    if (
      lower.includes("connect") ||
      lower.includes("database") ||
      lower.includes("mysql") ||
      task?.task_type === "ADD_CONNECTION" ||
      task?.task_type === "TEST_CONNECTION"
    ) {
      actionBridge.dispatch("navigation.navigate", { route: "/connections" });
      setActiveRoute("/connections");
      setActiveAnchor("connection-form-anchor");
      return;
    }

    if (
      lower.includes("schema") ||
      lower.includes("scan") ||
      lower.includes("table") ||
      lower.includes("column") ||
      task?.task_type === "SCAN_SCHEMA"
    ) {
      actionBridge.dispatch("navigation.navigate", { route: "/explorer" });
      setActiveRoute("/explorer");
      setActiveAnchor("schema-explorer-anchor");
      return;
    }

    if (
      lower.includes("automation") ||
      lower.includes("blog") ||
      lower.includes("schedule") ||
      task?.task_type === "CREATE_AUTOMATION" ||
      task?.task_type === "RUN_AUTOMATION"
    ) {
      actionBridge.dispatch("navigation.navigate", { route: "/automations/new" });
      setActiveRoute("/automations/new");
      setActiveAnchor("automation-builder-anchor");
      return;
    }

    if (
      lower.includes("approval") ||
      lower.includes("review") ||
      lower.includes("reject") ||
      task?.task_type === "REVIEW_APPROVALS"
    ) {
      actionBridge.dispatch("navigation.navigate", { route: "/approvals" });
      setActiveRoute("/approvals");
      setActiveAnchor("approvals-list-anchor");
      return;
    }

    if (
      lower.includes("execution") ||
      lower.includes("history") ||
      lower.includes("job") ||
      task?.task_type === "LIST_EXECUTIONS"
    ) {
      actionBridge.dispatch("navigation.navigate", { route: "/executions" });
      setActiveRoute("/executions");
      setActiveAnchor("executions-history-anchor");
      return;
    }

    if (lower.includes("knowledge") || lower.includes("rag") || lower.includes("document")) {
      actionBridge.dispatch("navigation.navigate", { route: "/knowledge" });
      setActiveRoute("/knowledge");
      setActiveAnchor("knowledge-upload-anchor");
      return;
    }

    if (lower.includes("provider") || lower.includes("model") || lower.includes("ollama")) {
      actionBridge.dispatch("navigation.navigate", { route: "/ai-providers" });
      setActiveRoute("/ai-providers");
      setActiveAnchor("ai-provider-settings-anchor");
      return;
    }
  }, []);

  // Send message / speech request
  const sendMessage = async (content: string, isVoice = false, secureInputData?: any) => {
    let convId = conversationIdRef.current || conversationId;
    if (!convId) {
      convId = await loadConversation();
    }
    if (!convId) {
      toast.error("Session Error", "Could not initialize consultation session. Please check your connection.");
      return;
    }

    setIsLoading(true);
    setCharacterState("understanding");
    setIsOpen(true);

    try {
      const res: any = await api.postAgentMessage(convId, content, isVoice, secureInputData);

      if (res.conversation?.messages) {
        setMessages(res.conversation.messages);
        const lastMsg = [...res.conversation.messages].reverse().find((m: any) => m.role === "assistant");
        if (lastMsg) {
          setLastSpokenSpeech(lastMsg.content);
        }
      } else if (res.message) {
        setLastSpokenSpeech(res.message.content || "");
      }

      if (res.task) {
        setActiveTask(res.task);
        setTimelineEvents(res.task.timeline_events || []);
        // Trigger semantic travel
        mapIntentToNavigation(res.task, content);

        // Immediate Action Bridge dispatch for visible UI execution
        if (res.task.task_type === "ADD_CONNECTION") {
          const slots = (res.task as any).slots || {};
          const nonSecret = { ...slots };
          delete nonSecret.password;
          actionBridge.dispatch("connections.open_create_form", { slots: nonSecret });
          if (Object.keys(nonSecret).length > 0) {
            actionBridge.dispatch("connections.fill_fields", { fields: nonSecret });
          }
        } else if (res.task.task_type === "SCAN_SCHEMA") {
          actionBridge.dispatch("navigation.navigate", { route: "/explorer" });
        } else if (res.task.task_type === "CREATE_AUTOMATION") {
          actionBridge.dispatch("navigation.navigate", { route: "/automations/new" });
        }
      } else {
        mapIntentToNavigation(null, content);
      }
    } catch (err: any) {
      toast.error("Agent Error", err.message || "Failed to communicate with assistant.");
      setCharacterState("error");
    } finally {
      setIsLoading(false);
    }
  };

  // Voice transcript handler with interrupt detection
  const handleVoiceTranscript = async (transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;

    setIsOpen(true);
    const lower = clean.toLowerCase();

    // Check for voice interruption commands
    if (lower === "stop" || lower === "cancel" || lower === "halt" || lower.startsWith("stop ")) {
      await interruptTask("STOP");
      return;
    }

    if (lower === "pause" || lower === "wait" || lower.startsWith("pause ")) {
      await interruptTask("PAUSE");
      return;
    }

    toast.info("Voice Instruction", `"${clean}"`);
    await sendMessage(clean, true);
  };

  // Submit in-context secure credentials
  const submitSecureCredentials = async (data: any) => {
    if (!activeTask) return;
    setIsLoading(true);
    setCharacterState("executing");
    try {
      await sendMessage("Provided secure connection credentials", false, data);
    } finally {
      setIsLoading(false);
    }
  };

  // Instant Interrupt (Stop / Pause)
  const interruptTask = async (action: "STOP" | "PAUSE" = "STOP") => {
    if (!activeTask) return;
    try {
      const res: any = await api.interruptAgentTask(activeTask.id, action);
      if (res.task) {
        setActiveTask(res.task);
        setTimelineEvents(res.task.timeline_events || []);
      }
      setCharacterState(action === "PAUSE" ? "paused" : "cancelled");
      setLastSpokenSpeech(action === "PAUSE" ? "Execution paused." : "Operation stopped by user.");
      toast.info(action === "PAUSE" ? "Task Paused" : "Stop Requested", res.message || "Signaled agent to halt.");
    } catch (err: any) {
      toast.error("Interrupt Failed", err.message || "Could not halt agent task.");
    }
  };

  // Mid-task Correction
  const correctTask = async (correction: string) => {
    if (!activeTask) return;
    setIsLoading(true);
    setCharacterState("understanding");
    try {
      const res: any = await api.correctAgentTask(activeTask.id, correction);
      if (res.conversation?.messages) {
        setMessages(res.conversation.messages);
      }
      if (res.task) {
        setActiveTask(res.task);
        setTimelineEvents(res.task.timeline_events || []);
        mapIntentToNavigation(res.task, correction);
      }
      setLastSpokenSpeech("Correction applied. Revising plan.");
      toast.success("Correction Applied", "Assistant updated execution plan.");
    } catch (err: any) {
      toast.error("Correction Failed", err.message || "Could not apply correction.");
    } finally {
      setIsLoading(false);
    }
  };

  // Confirm Consequential Step
  const confirmTask = async () => {
    if (!activeTask) return;
    setIsLoading(true);
    setCharacterState("executing");
    try {
      const res: any = await api.confirmAgentTask(activeTask.id);
      if (res.conversation?.messages) {
        setMessages(res.conversation.messages);
      }
      if (res.task) {
        setActiveTask(res.task);
        setTimelineEvents(res.task.timeline_events || []);
      }
    } catch (err: any) {
      toast.error("Confirmation Failed", err.message || "Could not confirm task step.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateAutonomyLevel = async (lvl: string) => {
    setAutonomyLevelState(lvl);
    try {
      await api.updateAgentPreferences({ autonomy_level: lvl });
      toast.success("Autonomy Level Updated", `Operating mode set to: ${lvl}`);
    } catch (err) {
      console.warn("Failed to update autonomy preferences:", err);
    }
  };

  const toggleVoiceResponses = async () => {
    const nextVal = !voiceResponsesEnabled;
    setVoiceResponsesEnabled(nextVal);
    try {
      await api.updateAgentPreferences({ voice_enabled: nextVal });
    } catch {
      // Local fallback
    }
  };

  const startNewConversation = async () => {
    try {
      const createRes: any = await api.createAgentConversation("New Consultation");
      setConversationId(createRes.conversation.id);
      conversationIdRef.current = createRes.conversation.id;
      setMessages([]);
      setActiveTask(null);
      setTimelineEvents([]);
      setActiveAnchor(null);
      setActiveRoute(null);
      setLastSpokenSpeech("");
      setCharacterState("idle");
      toast.info("New Thread", "Started fresh consultation thread.");
    } catch (err: any) {
      toast.error("Error", err.message || "Failed to start new conversation.");
    }
  };

  return (
    <AssistantContext.Provider
      value={{
        isOpen,
        setIsOpen,
        toggleOpen: () => setIsOpen((prev) => !prev),
        isDrawerOpen: isOpen,
        setIsDrawerOpen: setIsOpen,
        toggleDrawer: () => setIsOpen((prev) => !prev),
        characterState,
        setCharacterState,
        conversationId,
        messages,
        activeTask,
        timelineEvents,
        isLoading,
        autonomyLevel,
        setAutonomyLevel: updateAutonomyLevel,

        activeAnchor,
        setActiveAnchor,
        activeRoute,
        setActiveRoute,
        lastSpokenSpeech,
        setLastSpokenSpeech,
        voiceResponsesEnabled,
        setVoiceResponsesEnabled,
        toggleVoiceResponses,

        sendMessage,
        handleVoiceTranscript,
        interruptTask,
        requestInterrupt: interruptTask,
        requestPause: () => interruptTask("PAUSE"),
        correctTask,
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
  if (!ctx) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return ctx;
};
