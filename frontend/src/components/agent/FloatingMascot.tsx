import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAssistant } from "../../context/AssistantContext";
import { OrbitMascotCharacter, CharacterAngle } from "./OrbitMascotCharacter";
import { AgentOperationalHUD } from "./AgentOperationalHUD";
import { useVoiceLifecycle } from "../../hooks/useVoiceLifecycle";
import { useMascotTravel } from "../../hooks/useMascotTravel";
import { usePressAndHold } from "../../hooks/usePressAndHold";
import { Mic, MicOff, Volume2, Sparkles, RefreshCw, X } from "lucide-react";

const ANGLES_SEQUENCE: CharacterAngle[] = [
  "front",
  "front_three_quarter",
  "side",
  "rear_three_quarter",
  "back",
  "left",
];

export const FloatingMascot: React.FC = () => {
  const navigate = useNavigate();
  const {
    isOpen,
    setIsOpen,
    toggleOpen,
    characterState,
    setCharacterState,
    activeTask,
    timelineEvents,
    activeAnchor,
    activeRoute,
    lastSpokenSpeech,
    voiceResponsesEnabled,
    toggleVoiceResponses,
    handleVoiceTranscript,
    interruptTask,
    confirmTask,
    submitSecureCredentials,
    isLoading,
  } = useAssistant();

  const prevRouteRef = useRef<string | null>(null);
  const [currentAngleIndex, setCurrentAngleIndex] = useState<number>(0);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const dragStartXRef = useRef<number>(0);

  // Voice lifecycle integration
  const {
    isSupported,
    isListening,
    isSpeaking,
    transcript,
    interimTranscript,
    audioLevel,
    lastSpokenText,
    error: voiceError,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
  } = useVoiceLifecycle({
    onTranscript: (t) => {
      handleVoiceTranscript(t);
    },
    onListeningChange: (listening) => {
      if (listening) {
        setCharacterState("listening");
      } else {
        setCharacterState(activeTask ? "executing" : "idle");
      }
    },
    voiceResponsesEnabled,
  });

  // Mascot dynamic viewport travel
  const coords = useMascotTravel(activeAnchor);

  // Route synchronization
  useEffect(() => {
    if (activeRoute && activeRoute !== prevRouteRef.current) {
      prevRouteRef.current = activeRoute;
      navigate(activeRoute);
    }
  }, [activeRoute, navigate]);

  // Voice Speech: Speak aloud whenever assistant responds
  useEffect(() => {
    if (lastSpokenSpeech && voiceResponsesEnabled) {
      speak(lastSpokenSpeech);
    }
  }, [lastSpokenSpeech, voiceResponsesEnabled, speak]);

  // Global Keyboard shortcuts: Cmd+J / Ctrl+J activates voice, Escape stops task
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleListening();
        setIsOpen(true);
      } else if (e.key === "Escape" && activeTask) {
        interruptTask("STOP");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleListening, setIsOpen, activeTask, interruptTask]);

  // Interactive horizontal drag to spin Orbit 360°
  const handlePointerDownDrag = (e: React.PointerEvent) => {
    dragStartXRef.current = e.clientX;
  };

  const handlePointerMoveDrag = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const deltaX = e.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) > 28) {
      const step = deltaX > 0 ? 1 : -1;
      setCurrentAngleIndex((prev) => (prev + step + ANGLES_SEQUENCE.length) % ANGLES_SEQUENCE.length);
      dragStartXRef.current = e.clientX;
    }
  };

  // Rotate to next angle on click
  const rotateNextAngle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentAngleIndex((prev) => (prev + 1) % ANGLES_SEQUENCE.length);
  }, []);

  // Press-and-Hold vs Tap hook
  const { isHolding, bind: mascotPressBind } = usePressAndHold({
    startOnDown: false,
    onHoldStart: () => {
      if (!isListening) {
        startListening();
      }
    },
    onHoldEnd: () => {
      stopListening();
    },
    onTap: () => {
      if (!isOpen) {
        setIsOpen(true);
      } else {
        toggleListening();
      }
    },
    holdThresholdMs: 400,
  });

  // Effective character state & angle:
  // When travelling across screen, face in motion direction
  const effectiveAngle: CharacterAngle = ((): CharacterAngle => {
    if (!coords.isDocked) return "front_three_quarter";
    return ANGLES_SEQUENCE[currentAngleIndex];
  })();

  const effectiveState = ((): any => {
    if (isListening) return "listening";
    if (isSpeaking) return "speaking";
    if (!coords.isDocked) return "moving";
    return characterState;
  })();

  const isWorking =
    activeTask &&
    ["RUNNING", "COMMITTING", "VALIDATING", "READY"].includes(activeTask.status);

  return (
    <>
      {/* 1. Orbit Free-Floating Companion with Spring Physics */}
      <motion.div
        initial={false}
        animate={{
          x: coords.x,
          y: coords.y,
        }}
        transition={{
          type: "spring",
          damping: 24,
          stiffness: 240,
        }}
        className="fixed top-0 left-0 z-50 pointer-events-auto select-none"
        style={{
          width: 120,
          height: 152,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onPointerDown={handlePointerDownDrag}
        onPointerMove={handlePointerMoveDrag}
      >
        <div className="relative flex flex-col items-center">
          {/* Angle Rotation Indicator Chips (Visible on Hover) */}
          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                className="absolute -top-7 flex items-center space-x-1 bg-slate-950/90 backdrop-blur-md px-2 py-0.5 rounded-full border border-cyan-500/30 shadow-lg text-[9px] font-mono text-cyan-300 z-20"
              >
                <button
                  type="button"
                  onClick={rotateNextAngle}
                  title="Click to spin Orbit angle (or drag horizontally)"
                  className="hover:text-white flex items-center space-x-1"
                >
                  <RefreshCw className="w-2.5 h-2.5 animate-spin-slow" />
                  <span>{effectiveAngle.replace(/_/g, " ")}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Interactive Character Body */}
          <motion.button
            type="button"
            {...mascotPressBind}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            aria-label="Orbit AI Mascot: Tap to open HUD / speak, hold to talk"
            className="relative flex flex-col items-center justify-center p-0 bg-transparent border-0 outline-none focus:outline-none cursor-grab active:cursor-grabbing"
          >
            {/* Real 3D Orbit Mascot Character */}
            <OrbitMascotCharacter
              state={effectiveState}
              angle={effectiveAngle}
              size="md"
              audioLevel={audioLevel}
              playSoundOnChange={true}
            />
          </motion.button>

          {/* Floating Action Pill under Orbit's Hover Feet */}
          <motion.button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!isOpen) {
                setIsOpen(true);
              }
              toggleListening();
            }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            className={`-mt-1 flex items-center space-x-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border backdrop-blur-xl shadow-lg transition-all duration-300 ${
              isHolding || isListening
                ? "bg-cyan-500 text-slate-950 border-white shadow-cyan-500/40 animate-pulse ring-2 ring-cyan-400"
                : effectiveState === "error" || effectiveState === "failed"
                ? "bg-rose-500/25 text-rose-300 border-rose-500/40 shadow-rose-500/20"
                : effectiveState === "warning" || effectiveState === "oops"
                ? "bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-amber-500/20"
                : effectiveState === "success" || effectiveState === "celebrate" || effectiveState === "completed"
                ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-emerald-500/20"
                : isSpeaking
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-500/20"
                : isWorking
                ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/40 shadow-indigo-500/20"
                : "bg-slate-950/90 text-cyan-300 border-cyan-500/30 hover:border-cyan-400 shadow-slate-950/70"
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-3.5 h-3.5 animate-pulse" />
                <span>Listening...</span>
              </>
            ) : effectiveState === "error" || effectiveState === "failed" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                <span>Orbit Alert</span>
              </>
            ) : effectiveState === "warning" || effectiveState === "oops" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span>Orbit Warning</span>
              </>
            ) : effectiveState === "success" || effectiveState === "celebrate" || effectiveState === "completed" ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                <span>Task Verified</span>
              </>
            ) : isSpeaking ? (
              <>
                <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                <span>Orbit Speaking</span>
              </>
            ) : isWorking ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                <span>Executing...</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-cyan-400" />
                <span>Speak to Orbit</span>
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* 2. Voice-First Operational HUD with 360° Angle Studio */}
      <AgentOperationalHUD
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        characterState={effectiveState}
        activeTask={activeTask}
        timelineEvents={timelineEvents}
        isListening={isListening}
        isSpeaking={isSpeaking}
        transcript={transcript}
        interimTranscript={interimTranscript}
        lastSpokenText={lastSpokenSpeech || lastSpokenText}
        voiceError={voiceError}
        voiceResponsesEnabled={voiceResponsesEnabled}
        onToggleVoiceResponses={toggleVoiceResponses}
        onStartListening={startListening}
        onStopListening={stopListening}
        onToggleListening={toggleListening}
        onInterrupt={interruptTask}
        onConfirmTask={confirmTask}
        onSubmitSecureInput={submitSecureCredentials}
        onSendInstruction={handleVoiceTranscript}
        onSelectBehavior={(st) => {
          setCharacterState(st);
          setCurrentAngleIndex(0);
        }}
        onSelectAngle={(ang) => {
          const idx = ANGLES_SEQUENCE.indexOf(ang);
          if (idx !== -1) setCurrentAngleIndex(idx);
          setCharacterState("idle");
        }}
        isLoading={isLoading}
      />
    </>
  );
};

export default FloatingMascot;
