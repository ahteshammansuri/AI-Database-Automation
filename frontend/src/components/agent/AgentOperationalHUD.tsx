import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Square,
  Pause,
  Play,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Shield,
  Loader2,
  Radio,
  Sparkles,
  Keyboard,
  Compass,
  Layers,
  Volume1,
  RotateCcw,
} from "lucide-react";
import { OrbitMascotCharacter, CharacterState, CharacterAngle } from "./OrbitMascotCharacter";
import { AgentTask, AgentTimelineEvent, AgentMessage } from "../../context/AssistantContext";
import { usePressAndHold } from "../../hooks/usePressAndHold";
import soundManager from "../../services/soundEffects";

export interface AgentOperationalHUDProps {
  isOpen: boolean;
  onClose: () => void;
  messages?: AgentMessage[];
  characterState: CharacterState;
  activeTask: AgentTask | null;
  timelineEvents: AgentTimelineEvent[];
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  interimTranscript: string;
  lastSpokenText: string;
  voiceError: string | null;
  voiceResponsesEnabled: boolean;
  onToggleVoiceResponses: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onToggleListening: () => void;
  onInterrupt: (action?: "STOP" | "PAUSE") => Promise<void>;
  onConfirmTask: () => Promise<void>;
  onSubmitSecureInput: (data: any) => Promise<void>;
  onSendInstruction?: (text: string) => void;
  onSelectBehavior?: (state: CharacterState) => void;
  onSelectAngle?: (angle: CharacterAngle) => void;
  isLoading: boolean;
}

const AVAILABLE_ANGLES: { id: CharacterAngle; label: string; deg: string }[] = [
  { id: "front", label: "Front", deg: "0°" },
  { id: "front_three_quarter", label: "3/4 View", deg: "45°" },
  { id: "side", label: "Side", deg: "90°" },
  { id: "rear_three_quarter", label: "Rear 3/4", deg: "135°" },
  { id: "back", label: "Back", deg: "180°" },
  { id: "left", label: "Left", deg: "270°" },
];

export interface BehaviorSpec {
  id: CharacterState;
  label: string;
  category: "Actions" | "Expressions" | "Workflow" | "Alerts";
  soundTitle: string;
  soundDesc: string;
  visualDesc: string;
}

const ALL_BEHAVIORS: BehaviorSpec[] = [
  // Actions
  {
    id: "navigating",
    label: "Navigating UI",
    category: "Actions",
    soundTitle: "Radar Blip (800→1200Hz)",
    soundDesc: "High-definition interface ping",
    visualDesc: "Levitates smoothly, points arm toward target menu/button",
  },
  {
    id: "clicking",
    label: "Clicking / Interacting",
    category: "Actions",
    soundTitle: "Cybernetic Snap (1400→400Hz)",
    soundDesc: "Tactile mechanical-digital snap",
    visualDesc: "Interactive tap with holographic concentric ripple wave",
  },
  {
    id: "typing",
    label: "Typing Data",
    category: "Actions",
    soundTitle: "Micro-Keyboard Chirps (950→1350Hz)",
    soundDesc: "Rapid cybernetic key clatter",
    visualDesc: "Enters data into forms on glowing holographic keyboard",
  },
  {
    id: "processing",
    label: "Processing Data",
    category: "Actions",
    soundTitle: "Orbital Rings Hum (440+444Hz)",
    soundDesc: "Dual-oscillator gyroscopic binaural pulse",
    visualDesc: "Analyzing database metadata with spinning orbital rings",
  },
  {
    id: "flying",
    label: "Flying / Jet",
    category: "Actions",
    soundTitle: "Aero Thruster Glide (180→360Hz)",
    soundDesc: "Smooth propulsion frequency slide",
    visualDesc: "High-speed levitation dash with glowing blue thruster trail",
  },
  {
    id: "working",
    label: "Executing",
    category: "Actions",
    soundTitle: "Task Execution Hum",
    soundDesc: "Harmonic active computation tone",
    visualDesc: "Performs validated, policy-governed database actions",
  },

  // Expressions
  {
    id: "idle",
    label: "Idle / Waiting",
    category: "Expressions",
    soundTitle: "Ambient Hover",
    soundDesc: "Subtle aerodynamic levitation tone",
    visualDesc: "Calm levitation, natural blinking, friendly demeanor",
  },
  {
    id: "listening",
    label: "Listening",
    category: "Expressions",
    soundTitle: "Ping-Pong Chime (880→1174Hz)",
    soundDesc: "Ascending two-tone welcoming ping",
    visualDesc: "Antenna glowing cyan, attentive forward gaze",
  },
  {
    id: "thinking",
    label: "Thinking",
    category: "Expressions",
    soundTitle: "Curiosity Hum (260→320Hz)",
    soundDesc: "Gentle rhythmic low-pass oscillation",
    visualDesc: "Inquisitive eye shift, calculating next action",
  },
  {
    id: "celebrate",
    label: "Celebration",
    category: "Expressions",
    soundTitle: "Fanfare Arpeggio (523→1318Hz)",
    soundDesc: "Ascending major pentatonic sparkle",
    visualDesc: "Joyful celebratory leap with sparkle stars & cape flutter",
  },

  // Workflow
  {
    id: "understanding",
    label: "Understanding",
    category: "Workflow",
    soundTitle: "Harmonic Fifth (440→659Hz)",
    soundDesc: "Clean ascending fifth acknowledgment",
    visualDesc: "Curious head tilt, recognizing voice intent",
  },
  {
    id: "planning",
    label: "Planning",
    category: "Workflow",
    soundTitle: "Projector Sweep (350→950Hz)",
    soundDesc: "Holographic bandpass filter sweep",
    visualDesc: "Interactive holographic blueprint tablet display",
  },
  {
    id: "validating",
    label: "Validating",
    category: "Workflow",
    soundTitle: "Octave Check (587→1174Hz)",
    soundDesc: "High-precision constraint check ping",
    visualDesc: "Scanning schema constraints, safety rules & unique indexes",
  },
  {
    id: "success",
    label: "Task Success",
    category: "Workflow",
    soundTitle: "Major Triad (C5-E5-G5)",
    soundDesc: "Warm triumphal 523/659/784Hz bell chord",
    visualDesc: "Task verified and complete with glowing green shield",
  },

  // Alerts
  {
    id: "warning",
    label: "Warning / Oops",
    category: "Alerts",
    soundTitle: "Caution Chime (587→440Hz)",
    soundDesc: "Gentle descending triangle wave",
    visualDesc: "Puzzled shrug with soft amber warning glow",
  },
  {
    id: "error",
    label: "Alert / Error",
    category: "Alerts",
    soundTitle: "Alert Minor Chord (380→290Hz)",
    soundDesc: "Descending minor alert with harmonic buzz",
    visualDesc: "Vibrant red alert aura with determined >_< expression",
  },
  {
    id: "interrupted",
    label: "Interrupted",
    category: "Alerts",
    soundTitle: "Brake Pop (600→180Hz)",
    soundDesc: "Instant acoustic damping brake",
    visualDesc: "Halted action, directly looking at user for guidance",
  },
  {
    id: "offline",
    label: "Standby Mode",
    category: "Alerts",
    soundTitle: "Power Down Tone (440→110Hz)",
    soundDesc: "Soft descending power-down decay",
    visualDesc: "LED display dimmed into restful sleep mode",
  },
];

export const AgentOperationalHUD: React.FC<AgentOperationalHUDProps> = ({
  isOpen,
  onClose,
  messages = [],
  characterState,
  activeTask,
  timelineEvents,
  isListening,
  isSpeaking,
  transcript,
  interimTranscript,
  lastSpokenText,
  voiceError,
  voiceResponsesEnabled,
  onToggleVoiceResponses,
  onStartListening,
  onStopListening,
  onToggleListening,
  onInterrupt,
  onConfirmTask,
  onSubmitSecureInput,
  onSendInstruction,
  onSelectBehavior,
  onSelectAngle,
  isLoading,
}) => {
  const [showKeyboardFallback, setShowKeyboardFallback] = useState(false);
  const [showAngleStudio, setShowAngleStudio] = useState(false);
  const [showBehaviorStudio, setShowBehaviorStudio] = useState(false);
  const [inspectedAngle, setInspectedAngle] = useState<CharacterAngle>("front");
  const [inspectedBehavior, setInspectedBehavior] = useState<CharacterState>("navigating");
  const [behaviorCategory, setBehaviorCategory] = useState<string>("All");
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(soundManager.isMuted());
  const [accessibleText, setAccessibleText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, transcript, interimTranscript]);

  // Press-and-Hold vs Tap hook for HUD voice button
  const { isHolding, bind: voiceButtonBind } = usePressAndHold({
    startOnDown: true,
    onHoldStart: () => {
      if (!isListening) {
        onStartListening();
      }
    },
    onHoldEnd: () => {
      onStopListening();
    },
    onTap: () => {
      onToggleListening();
    },
    holdThresholdMs: 220,
  });

  const isTaskRunning =
    activeTask &&
    ["RUNNING", "COMMITTING", "VALIDATING", "READY"].includes(activeTask.status);

  const isPaused = activeTask?.status === "PAUSED";
  const needsConfirmation =
    activeTask?.status === "WAITING_FOR_APPROVAL" ||
    characterState.toLowerCase() === "needs_confirmation";

  const isWaitingInput =
    activeTask?.status === "WAITING_FOR_INPUT" ||
    characterState.toLowerCase() === "waiting_for_user";

  const currentStep =
    activeTask?.active_plan && activeTask.active_plan.length > 0
      ? activeTask.active_plan[activeTask.current_step_index] ||
        activeTask.active_plan[0]
      : null;

  const totalSteps = activeTask?.active_plan?.length || 0;
  const currentStepNum = Math.min((activeTask?.current_step_index || 0) + 1, totalSteps);

  const handleSelectBehavior = (bId: CharacterState) => {
    setInspectedBehavior(bId);
    soundManager.playSoundForBehavior(bId);
    onSelectBehavior?.(bId);
  };

  const handleSelectAngle = (angId: CharacterAngle) => {
    setInspectedAngle(angId);
    onSelectAngle?.(angId);
  };

  const handleToggleSoundMute = () => {
    const next = soundManager.toggleMute();
    setIsAudioMuted(next);
  };

  const filteredBehaviors = behaviorCategory === "All"
    ? ALL_BEHAVIORS
    : ALL_BEHAVIORS.filter((b) => b.category === behaviorCategory);

  const currentBehaviorSpec = ALL_BEHAVIORS.find((b) => b.id === inspectedBehavior) || ALL_BEHAVIORS[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-24 right-6 z-50 w-[92vw] sm:w-[460px] max-h-[85vh] overflow-y-auto bg-slate-900/95 backdrop-blur-2xl border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col font-sans"
          style={{ boxShadow: "0 20px 45px -12px rgba(0, 0, 0, 0.8), 0 0 35px -8px rgba(6, 182, 212, 0.3)" }}
        >
          {/* Companion Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/60 rounded-t-3xl">
            <div className="flex items-center space-x-3">
              <OrbitMascotCharacter
                state={showBehaviorStudio ? inspectedBehavior : characterState}
                angle={showAngleStudio ? inspectedAngle : undefined}
                size="sm"
              />
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm tracking-tight text-white">
                    Orbit
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono font-medium">
                    Autonomous AI
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 capitalize">
                  {showBehaviorStudio ? `${currentBehaviorSpec.label}` : characterState.replace(/_/g, " ")}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-1.5">
              {/* Behaviors & Sounds Studio Toggle */}
              <button
                type="button"
                onClick={() => {
                  setShowBehaviorStudio(!showBehaviorStudio);
                  if (showAngleStudio) setShowAngleStudio(false);
                }}
                title="Toggle Live Behaviors & Sounds Studio"
                className={`p-1.5 rounded-xl border transition-all ${
                  showBehaviorStudio
                    ? "bg-indigo-500/25 text-indigo-300 border-indigo-400/50 shadow-md shadow-indigo-500/20"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>

              {/* 360° Angle Studio Toggle */}
              <button
                type="button"
                onClick={() => {
                  setShowAngleStudio(!showAngleStudio);
                  if (showBehaviorStudio) setShowBehaviorStudio(false);
                }}
                title="Toggle 360° Angle Turnaround Studio"
                className={`p-1.5 rounded-xl border transition-all ${
                  showAngleStudio
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-md shadow-cyan-500/20"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
              </button>

              {/* Procedural Sound Effects Mute Toggle */}
              <button
                type="button"
                onClick={handleToggleSoundMute}
                title={isAudioMuted ? "Sound effects muted (click to enable)" : "Sound effects active (click to mute)"}
                className={`p-1.5 rounded-xl border transition-all ${
                  !isAudioMuted
                    ? "bg-slate-800 text-cyan-300 border-cyan-500/30 hover:border-cyan-400"
                    : "bg-rose-500/15 text-rose-300 border-rose-500/40"
                }`}
              >
                {!isAudioMuted ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Minimize / Close HUD */}
              <button
                type="button"
                onClick={onClose}
                title="Minimize Companion"
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Interactive Live Behaviors & Sounds Studio Drawer */}
          {showBehaviorStudio && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 py-3 bg-slate-950/95 border-b border-indigo-500/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-indigo-300 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-400" />
                  Live Behaviors & Distinct Sound Studio
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {ALL_BEHAVIORS.length} Verified HD States
                </span>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center space-x-1 overflow-x-auto pb-1 text-[10px]">
                {["All", "Actions", "Expressions", "Workflow", "Alerts"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setBehaviorCategory(cat)}
                    className={`px-2 py-0.5 rounded-lg border transition-all whitespace-nowrap ${
                      behaviorCategory === cat
                        ? "bg-indigo-500/30 border-indigo-400 text-white font-semibold"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Active Hero Behavior Card */}
              <div className="flex items-center space-x-3.5 p-3 rounded-2xl bg-gradient-to-r from-slate-900/90 to-indigo-950/40 border border-indigo-500/30 shadow-lg">
                <div className="shrink-0 flex items-center justify-center p-1 bg-slate-950/80 rounded-2xl border border-indigo-500/30 shadow-inner">
                  <OrbitMascotCharacter
                    state={inspectedBehavior}
                    size="md"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-xs text-white">
                      {currentBehaviorSpec.label}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {currentBehaviorSpec.category}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-300 leading-snug line-clamp-2">
                    {currentBehaviorSpec.visualDesc}
                  </p>
                  <div className="pt-1 flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => soundManager.playSoundForBehavior(currentBehaviorSpec.id)}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/25 hover:bg-indigo-500/40 border border-indigo-400/50 text-[10px] font-semibold text-cyan-200 transition-all shadow-sm shadow-indigo-500/20"
                    >
                      <Volume2 className="w-3 h-3 text-cyan-400" />
                      <span>{currentBehaviorSpec.soundTitle}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid of Behavior Chips */}
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
                {filteredBehaviors.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelectBehavior(b.id)}
                    className={`flex items-center space-x-1.5 px-2 py-1.5 rounded-xl border text-left transition-all ${
                      inspectedBehavior === b.id
                        ? "bg-indigo-500/30 border-indigo-400 text-white shadow-md shadow-indigo-500/20"
                        : "bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
                    }`}
                  >
                    <span className="text-[11px] leading-tight font-medium truncate flex-1">
                      {b.label}
                    </span>
                    <Volume1 className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Interactive 360° Angle Turnaround Studio Bar */}
          {showAngleStudio && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800/80 space-y-2"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-cyan-300 flex items-center space-x-1">
                  <Compass className="w-3 h-3 mr-1" />
                  360° Turnaround Angles
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Inspecting: {inspectedAngle.replace(/_/g, " ")}
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1.5 pt-1">
                {AVAILABLE_ANGLES.map((ang) => (
                  <button
                    key={ang.id}
                    type="button"
                    onClick={() => handleSelectAngle(ang.id)}
                    className={`flex flex-col items-center py-1.5 px-1 rounded-xl border transition-all text-center ${
                      inspectedAngle === ang.id
                        ? "bg-cyan-500/25 border-cyan-400 text-white shadow-md shadow-cyan-500/20"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                    }`}
                  >
                    <span className="text-[10px] font-bold font-mono">{ang.deg}</span>
                    <span className="text-[9px] leading-tight truncate">{ang.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Companion Body */}
          <div className="p-4 space-y-3.5">
            {/* 1. Spoken Transcript & Interactive Conversation Feed */}
            <div className="bg-slate-950/80 rounded-2xl p-3 border border-slate-800/90 shadow-inner space-y-2.5">
              {/* Active Audio Waveform when speaking or holding */}
              {isHolding ? (
                <div className="flex items-center space-x-2 text-cyan-400 bg-cyan-950/40 border border-cyan-800/40 rounded-xl px-3 py-2">
                  <div className="flex space-x-1 items-center">
                    <span className="w-1 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-5 bg-cyan-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-4 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    <span className="w-1 h-6 bg-cyan-200 rounded-full animate-bounce" style={{ animationDelay: "450ms" }} />
                    <span className="w-1 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "600ms" }} />
                  </div>
                  <span className="text-[11px] font-semibold tracking-wide text-cyan-300">
                    Recording voice... Speak now, release to execute
                  </span>
                </div>
              ) : isListening ? (
                <div className="flex items-center space-x-2 text-cyan-400 bg-cyan-950/30 border border-cyan-800/30 rounded-xl px-3 py-1.5">
                  <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                  <span className="text-[11px] font-medium tracking-wide uppercase">
                    Listening to your voice... Tap mic to stop
                  </span>
                </div>
              ) : null}

              {/* Live Voice Hearing Transcript (While speaking or right after button release) */}
              {(interimTranscript || (isListening && transcript)) && (
                <div className="text-xs text-cyan-200 bg-cyan-950/40 px-3 py-2 rounded-xl border border-cyan-800/60 flex items-start space-x-2 animate-pulse">
                  <Mic className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                  <p className="italic font-mono text-[11px]">
                    "{interimTranscript || transcript}"
                  </p>
                </div>
              )}

              {/* Scrollable Conversation Thread */}
              <div className="max-h-56 overflow-y-auto space-y-2.5 pr-1 text-xs">
                {messages.length === 0 ? (
                  <div className="py-2 px-1 text-center space-y-2">
                    <div className="flex items-center justify-center space-x-2 text-slate-300">
                      <OrbitMascotCharacter state="idle" size="xs" />
                      <span className="font-semibold text-xs text-cyan-300">Orbit Voice-First Assistant</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Hold the mic button or speak naturally. Say "Hi", ask Orbit to scan schemas, check database health, or create automations.
                    </p>
                    {/* Quick Starter Chips */}
                    <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                      {[
                        { label: "💬 Say Hello", prompt: "Hello Orbit!" },
                        { label: "🔍 Scan Database", prompt: "Scan the database schema and show me tables" },
                        { label: "🔌 Check Connections", prompt: "Check database connection status" },
                        { label: "🤖 Run Automation", prompt: "What automations are ready to run?" },
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => onSendInstruction?.(chip.prompt)}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors cursor-pointer"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const isUser = msg.role === "user";
                    return (
                      <div
                        key={msg.id || i}
                        className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl px-3.5 py-2 leading-relaxed shadow-sm ${
                            isUser
                              ? "bg-gradient-to-r from-cyan-900/60 to-indigo-900/60 border border-cyan-700/50 text-slate-100 rounded-tr-xs"
                              : "bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-xs"
                          }`}
                        >
                          <div className="flex items-center space-x-1.5 mb-1 text-[10px] font-medium">
                            {isUser ? (
                              <>
                                {msg.is_voice && <Mic className="w-2.5 h-2.5 text-cyan-400" />}
                                <span className="text-cyan-300">You {msg.is_voice ? "(Voice)" : ""}</span>
                              </>
                            ) : (
                              <div className="flex items-center space-x-1 text-indigo-300">
                                <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                                <span className="font-semibold text-indigo-300">Orbit</span>
                              </div>
                            )}
                          </div>
                          <div className="text-xs break-words whitespace-pre-wrap font-normal">
                            {msg.content}
                          </div>

                          {/* Executed Tools Badge */}
                          {msg.tool_calls && msg.tool_calls.length > 0 && (
                            <div className="mt-1.5 pt-1 border-t border-slate-800/80 flex flex-wrap gap-1">
                              {msg.tool_calls.map((tc: any, tIdx: number) => (
                                <span
                                  key={tIdx}
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
                                >
                                  ⚡ {tc.tool || tc.name || "Tool"} executed
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Orbit Thinking Card while formulating response */}
                {isLoading && (
                  <div className="flex items-start space-x-2 pt-1 animate-fadeIn">
                    <div className="shrink-0 pt-0.5">
                      <OrbitMascotCharacter state="thinking" size="xs" />
                    </div>
                    <div className="bg-indigo-950/50 border border-indigo-700/40 rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-indigo-200 space-y-1.5 shadow-md">
                      <div className="flex items-center space-x-2 text-[11px] font-semibold text-indigo-300">
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                        <span>Orbit is thinking & analyzing context...</span>
                      </div>
                      <p className="text-[10px] text-indigo-300/80 italic">
                        Formulating autonomous plan, checking permissions & target schema...
                      </p>
                    </div>
                  </div>
                )}

                {/* Voice Error notice if microphone denied or unavailable */}
                {voiceError && (
                  <div className="text-[11px] text-amber-300 bg-amber-500/10 px-2.5 py-1.5 rounded-xl border border-amber-500/20 flex items-center space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{voiceError}</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 2. Active Operation Status Card */}
            {activeTask && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isTaskRunning
                          ? "bg-cyan-400 animate-ping"
                          : isPaused
                          ? "bg-amber-400"
                          : activeTask.status === "SUCCEEDED"
                          ? "bg-emerald-400"
                          : "bg-rose-400"
                      }`}
                    />
                    <span className="text-xs font-semibold text-slate-200">
                      {activeTask.goal}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    Step {currentStepNum} of {totalSteps || 1}
                  </span>
                </div>

                {currentStep && (
                  <div className="text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded-xl border border-slate-800/80 flex items-center justify-between">
                    <span>{currentStep.label}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                      {currentStep.tool}
                    </span>
                  </div>
                )}

                {/* Progress bar */}
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full transition-all duration-300"
                    style={{
                      width: `${totalSteps > 0 ? (currentStepNum / totalSteps) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* 3. Action Confirmation Card (If Consequential) */}
            {needsConfirmation && (
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-3 space-y-2">
                <div className="flex items-center space-x-2 text-amber-300 text-xs font-medium">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Confirmation requested for step: {currentStep?.label}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onConfirmTask}
                    disabled={isLoading}
                    className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl text-xs transition-colors flex items-center justify-center space-x-1 shadow-md shadow-amber-500/20"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Confirm Action
                  </button>
                  <button
                    type="button"
                    onClick={() => onInterrupt("STOP")}
                    className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* 6. Master Voice & Interruption Control Bar */}
            <div className="pt-1 flex items-center gap-2">
              {/* Primary Voice Action (Press & Hold or Tap to Speak) */}
              <button
                type="button"
                {...voiceButtonBind}
                className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-2xl font-semibold text-xs transition-all shadow-lg select-none touch-none ${
                  isHolding || isListening
                    ? "bg-cyan-500 text-slate-950 shadow-cyan-500/30 ring-4 ring-cyan-500/20 active:scale-[0.98]"
                    : "bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-600/30"
                }`}
              >
                {isHolding ? (
                  <>
                    <MicOff className="w-4 h-4 text-slate-950 animate-pulse" />
                    <span>Recording... Release to Send</span>
                  </>
                ) : isListening ? (
                  <>
                    <MicOff className="w-4 h-4 text-slate-950 animate-pulse" />
                    <span>Listening... Tap to Stop</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Tap (or Hold) to Speak to Orbit</span>
                  </>
                )}
              </button>

              {/* Instant Pause/Resume Button if task is active */}
              {activeTask && isTaskRunning && (
                <button
                  type="button"
                  onClick={() => onInterrupt("PAUSE")}
                  title="Pause active execution"
                  className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-2xl transition-colors"
                >
                  <Pause className="w-4 h-4" />
                </button>
              )}

              {activeTask && isPaused && (
                <button
                  type="button"
                  onClick={onConfirmTask}
                  title="Resume execution"
                  className="p-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-2xl transition-colors"
                >
                  <Play className="w-4 h-4" />
                </button>
              )}

              {/* Instant Stop / Cancel Button */}
              {activeTask && (isTaskRunning || isPaused) && (
                <button
                  type="button"
                  onClick={() => onInterrupt("STOP")}
                  title="Stop and cancel operation immediately"
                  className="p-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-2xl transition-colors"
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 7. Always-Available Instruction Input (Type or Voice Fallback) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (accessibleText.trim() && !isLoading) {
                  onSendInstruction?.(accessibleText.trim());
                  setAccessibleText("");
                }
              }}
              className="pt-1 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={accessibleText}
                onChange={(e) => setAccessibleText(e.target.value)}
                placeholder="Type instruction or speak to Orbit..."
                disabled={isLoading}
                className="flex-1 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 shadow-inner"
              />
              <button
                type="submit"
                disabled={!accessibleText.trim() || isLoading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 rounded-xl transition-all shadow-sm flex items-center space-x-1"
              >
                <span>Send</span>
              </button>
            </form>
          </div>

          {/* Footer Security Policy */}
          <div className="px-4 py-2.5 bg-slate-950/80 border-t border-slate-800/80 rounded-b-3xl flex items-center justify-between text-[10px] text-slate-500">
            <div className="flex items-center space-x-1.5">
              <Shield className="w-3 h-3 text-cyan-400/80" />
              <span>Orbit Guarded Execution: Zero Raw SQL</span>
            </div>
            <span className="font-mono">v2.2-orbit-360</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AgentOperationalHUD;
