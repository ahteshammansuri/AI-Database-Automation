import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface VoiceInputControlProps {
  onTranscript: (text: string) => void;
  onListeningStateChange?: (isListening: boolean) => void;
  disabled?: boolean;
  isWorking?: boolean;
  className?: string;
}

export const VoiceInputControl: React.FC<VoiceInputControlProps> = ({
  onTranscript,
  onListeningStateChange,
  disabled = false,
  isWorking = false,
  className = "",
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimText, setInterimText] = useState<string>("");
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);

  const recognitionRef = useRef<any>(null);

  // Initialize SpeechRecognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setErrorNotice(null);
        onListeningStateChange?.(true);
      };

      recognition.onresult = (event: any) => {
        let finalStr = "";
        let interimStr = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalStr += event.results[i][0].transcript;
          } else {
            interimStr += event.results[i][0].transcript;
          }
        }

        if (interimStr) {
          setInterimText(interimStr);
        }

        if (finalStr) {
          setInterimText("");
          onTranscript(finalStr.trim());
          stopListening();
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setErrorNotice("Microphone permission denied. Enable microphone in browser settings.");
        } else if (event.error === "no-speech") {
          setErrorNotice("No speech detected.");
        } else {
          setErrorNotice(`Voice input error: ${event.error}`);
        }
        stopListening();
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText("");
        onListeningStateChange?.(false);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn("Failed to initialize speech recognition:", e);
      setIsSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, [onTranscript, onListeningStateChange]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening || disabled) return;
    setErrorNotice(null);
    setInterimText("");
    try {
      recognitionRef.current.start();
    } catch (err) {
      console.warn("Recognition start error:", err);
    }
  }, [isListening, disabled]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {}
    setIsListening(false);
    setInterimText("");
    onListeningStateChange?.(false);
  }, [onListeningStateChange]);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!isSupported) {
    return (
      <div className={`relative ${className}`} title="Speech recognition not supported in this browser. Please type your requests.">
        <button
          type="button"
          disabled
          className="p-2.5 rounded-full text-slate-300 bg-slate-100 cursor-not-allowed transition"
          aria-label="Voice input not supported"
        >
          <MicOff className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* Live Interim Transcript Bubble */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute bottom-12 right-0 z-30 min-w-[220px] max-w-[320px] p-3 bg-slate-900/95 backdrop-blur-md text-white text-xs rounded-xl shadow-xl border border-slate-700 pointer-events-none"
          >
            <div className="flex items-center space-x-2 text-cyan-400 font-medium mb-1">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>{isWorking ? "Listening for correction..." : "Listening..."}</span>
            </div>
            <p className="italic text-slate-200 min-h-[1.2rem]">
              {interimText || "Speak your instruction or correction..."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error alert tooltip */}
      {errorNotice && (
        <div className="absolute bottom-12 right-0 z-30 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg shadow-md max-w-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorNotice}</span>
          <button
            onClick={() => setErrorNotice(null)}
            className="ml-auto font-bold text-rose-500 hover:text-rose-700"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Microphone Toggle Button */}
      <motion.button
        type="button"
        onClick={toggleListening}
        disabled={disabled}
        whileTap={{ scale: 0.92 }}
        className={`relative p-2.5 rounded-full transition-all duration-200 shadow-sm ${
          isListening
            ? "bg-cyan-600 text-white shadow-cyan-400/30 shadow-md ring-4 ring-cyan-100"
            : isWorking
            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title={
          isListening
            ? "Click to stop listening"
            : isWorking
            ? "Speak to interrupt or change instruction"
            : "Click to speak request"
        }
        aria-label={isListening ? "Stop listening" : "Start voice recognition"}
      >
        <Mic className={`w-4 h-4 ${isListening ? "animate-pulse" : ""}`} />

        {/* Pulsing listening waves */}
        {isListening && (
          <span className="absolute -inset-1 rounded-full border-2 border-cyan-400 animate-ping pointer-events-none" />
        )}
      </motion.button>
    </div>
  );
};
