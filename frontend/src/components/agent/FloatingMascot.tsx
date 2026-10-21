import React, { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAssistant } from "../../context/AssistantContext";
import { OrbitMascotCharacter, CharacterState } from "./OrbitMascotCharacter";
import { AgentOperationalHUD } from "./AgentOperationalHUD";
import { useVoiceLifecycle } from "../../hooks/useVoiceLifecycle";
import { useMascotTravel, MASCOT_BOX, dockClearance } from "../../hooks/useMascotTravel";
import { usePressAndHold } from "../../hooks/usePressAndHold";
import { Mic, MicOff } from "lucide-react";
import { OrbitSpeechBubble, OrbitSecretChip } from "./OrbitOverlays";
import { orbitStage } from "../../services/orbitStage";

const GESTURE_STATE: Record<string, CharacterState> = {
  tap: "clicking",
  type: "typing",
  point: "pointing",
  inspect: "validating",
  wave: "greeting",
};

/**
 * Orbit, docked in the corner. The body is the primary voice control (hold to talk,
 * tap to toggle). Position, gestures and expression all come from real runtime events.
 */
export const FloatingMascot: React.FC = () => {
  const {
    isOpen, setIsOpen, characterState, setCharacterState, activeTask, interruptTask, handleVoiceTranscript,
    isSpeaking, speech,
  } = useAssistant();
  const reduceMotion = useReducedMotion();
  const placement = useMascotTravel();

  const onTranscript = useCallback((t: string) => {
    void handleVoiceTranscript(t);
  }, [handleVoiceTranscript]);
  const onListeningChange = useCallback((listening: boolean) => {
    setCharacterState(listening ? "listening" : "idle");
  }, [setCharacterState]);

  const voice = useVoiceLifecycle({ onTranscript, onListeningChange });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setIsOpen(true);
        voice.toggleListening();
      } else if (e.key === "Escape" && activeTask && ["QUEUED", "RUNNING"].includes(activeTask.status)) {
        void interruptTask("STOP");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voice, setIsOpen, activeTask, interruptTask]);

  const { isHolding, bind } = usePressAndHold({
    startOnDown: true,
    onHoldStart: () => !voice.isListening && voice.startListening(),
    onHoldEnd: () => voice.stopListening(),
    onTap: () => {
      setIsOpen(true);
      voice.toggleListening();
    },
    holdThresholdMs: 220,
  });

  // Precedence: the user (listening) > real UI activity (travel/gesture) > runtime state.
  const effectiveState: CharacterState = (() => {
    if (voice.isListening) return "listening";
    if (placement.inTransit && !placement.isDocked) return "moving";
    if (placement.gesture) return GESTURE_STATE[placement.gesture] ?? characterState;
    if (isSpeaking && !["needs_confirmation", "waiting_for_user"].includes(characterState)) return "speaking";
    return characterState;
  })();

  // When the panel opens, docked Orbit glances up at it for a moment (idle personality only).
  const [glancingAtPanel, setGlancingAtPanel] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setGlancingAtPanel(isOpen);
  }
  useEffect(() => {
    if (!glancingAtPanel) return;
    const t = setTimeout(() => setGlancingAtPanel(false), 2200);
    return () => clearTimeout(t);
  }, [glancingAtPanel]);
  const panelGlance = isOpen && glancingAtPanel && placement.isDocked
    ? { x: window.innerWidth - 240, y: window.innerHeight - dockClearance() - 140 }
    : null;

  // A soft, slightly floaty flight that settles without overshooting into the target.
  const transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, damping: 26, stiffness: 90, mass: 1, restDelta: 0.5, restSpeed: 2 };

  return (
    <>
      <motion.div
        initial={false}
        animate={{ x: placement.x, y: placement.y }}
        transition={transition}
        onAnimationComplete={() => orbitStage.emit({ type: "arrived", target: placement.targetKey })}
        className="fixed top-0 left-0 z-[70] select-none pointer-events-none"
        style={{ width: MASCOT_BOX.width, height: MASCOT_BOX.height }}
      >
        <div className="relative flex flex-col items-center pointer-events-auto">
          <OrbitSpeechBubble
            align={placement.x + MASCOT_BOX.width >= 252 ? "right" : "left"}
            below={placement.y < 150}
          />
          <button
            type="button"
            {...bind}
            aria-label="Orbit: hold to talk, tap to start or stop listening"
            aria-pressed={voice.isListening}
            className="relative p-0 bg-transparent border-0 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-full cursor-pointer"
          >
            <OrbitMascotCharacter
              state={effectiveState}
              size="md"
              audioLevel={voice.audioLevel ?? 0}
              facing={placement.facing}
              lookAt={placement.lookAt ?? panelGlance}
              emotion={speech?.emotion}
              playSoundOnChange
            />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`-mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border backdrop-blur-xl shadow-lg ${
              isHolding || voice.isListening
                ? "bg-cyan-500 text-slate-950 border-white"
                : "bg-slate-950/90 text-cyan-300 border-cyan-500/30 hover:border-cyan-400"
            }`}
          >
            {voice.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{voice.isListening ? "Listening" : isOpen ? "Hide Orbit" : "Orbit"}</span>
          </button>
        </div>
      </motion.div>

      <OrbitSecretChip />
      <AgentOperationalHUD
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        characterState={effectiveState}
        isListening={voice.isListening}
        transcript={voice.transcript}
        interimTranscript={voice.interimTranscript}
        voiceError={voice.error}
        audioLevel={voice.audioLevel}
        voiceSupported={voice.isSupported}
        usesRemoteRecognition={voice.usesRemoteRecognition}
        onStartListening={voice.startListening}
        onStopListening={voice.stopListening}
        onToggleListening={voice.toggleListening}
      />
    </>
  );
};

export default FloatingMascot;
