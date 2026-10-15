import { useState, useEffect, useRef, useCallback } from "react";
import { ttsAdapter } from "../services/ttsAdapter";

export interface VoiceLifecycleOptions {
  onTranscript: (transcript: string) => void;
  onListeningChange?: (isListening: boolean) => void;
  voiceResponsesEnabled?: boolean;
}

export interface VoiceLifecycleReturn {
  isSupported: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  interimTranscript: string;
  audioLevel: number;
  lastSpokenText: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  clearTranscripts: () => void;
}

export const useVoiceLifecycle = ({
  onTranscript,
  onListeningChange,
  voiceResponsesEnabled = true,
}: VoiceLifecycleOptions): VoiceLifecycleReturn => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [lastSpokenText, setLastSpokenText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isListeningRef = useRef<boolean>(false);
  const latestSpeechRef = useRef<string>("");
  const hasDispatchedTranscriptRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<any>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Initialize SpeechRecognition on mount
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      setError("Speech recognition is not natively supported in this browser. You can type directly in the box below.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
      setError(null);
      hasDispatchedTranscriptRef.current = false;
      onListeningChange?.(true);
    };

    recognition.onresult = (event: any) => {
      let finalTxt = "";
      let interimTxt = "";

      // Accumulate across ALL results in current recognition session to prevent dropped words
      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0]) {
          if (item.isFinal) {
            finalTxt += item[0].transcript + " ";
          } else {
            interimTxt += item[0].transcript + " ";
          }
        }
      }

      finalTxt = finalTxt.trim();
      interimTxt = interimTxt.trim();
      const activeText = (finalTxt ? (finalTxt + (interimTxt ? " " + interimTxt : "")) : interimTxt).trim();

      if (activeText) {
        latestSpeechRef.current = activeText;
      }

      // If user has already released the hold button, dispatch speech as soon as results arrive
      if (!isListeningRef.current && activeText && !hasDispatchedTranscriptRef.current) {
        hasDispatchedTranscriptRef.current = true;
        setTranscript(activeText);
        setInterimTranscript("");
        clearSilenceTimer();
        stopAudioAnalysis();
        onTranscript(activeText);
        return;
      }

      if (interimTxt) {
        setInterimTranscript(interimTxt);
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          if (latestSpeechRef.current && !hasDispatchedTranscriptRef.current) {
            hasDispatchedTranscriptRef.current = true;
            const textToDispatch = latestSpeechRef.current;
            setTranscript(textToDispatch);
            setInterimTranscript("");
            setIsListening(false);
            isListeningRef.current = false;
            onListeningChange?.(false);
            try {
              recognition.stop();
            } catch {}
            stopAudioAnalysis();
            onTranscript(textToDispatch);
          }
        }, 1200);
      }

      if (finalTxt && !interimTxt) {
        clearSilenceTimer();
        setTranscript(finalTxt);
        setInterimTranscript("");
        hasDispatchedTranscriptRef.current = true;
        setIsListening(false);
        isListeningRef.current = false;
        onListeningChange?.(false);
        try {
          recognition.stop();
        } catch {}
        stopAudioAnalysis();
        onTranscript(finalTxt);
      }
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      // Only display no-speech error if no transcript was captured at all
      if (event.error === "no-speech") {
        if (!latestSpeechRef.current && !hasDispatchedTranscriptRef.current) {
          setError("No speech detected. Hold or tap the button and speak clearly.");
        }
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission needed. You can also type your instruction directly in the box below.");
      } else if (event.error !== "aborted") {
        setError(`Speech notice: ${event.error}. You can also type directly in the box below.`);
      }
      stopAudioAnalysis();
      setIsListening(false);
      isListeningRef.current = false;
      onListeningChange?.(false);
    };

    recognition.onend = () => {
      clearSilenceTimer();
      stopAudioAnalysis();
      setIsListening(false);
      isListeningRef.current = false;
      onListeningChange?.(false);

      // If speech ended with captured text that wasn't dispatched yet, dispatch it immediately
      const pendingText = latestSpeechRef.current.trim();
      if (pendingText && !hasDispatchedTranscriptRef.current) {
        hasDispatchedTranscriptRef.current = true;
        setTranscript(pendingText);
        setInterimTranscript("");
        onTranscript(pendingText);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      clearSilenceTimer();
      try {
        recognition.abort();
      } catch {
        // Ignore abort on unmount
      }
      stopAudioAnalysis();
    };
  }, [onTranscript, onListeningChange, clearSilenceTimer]);

  // Audio volume analyzer for dynamic pulse
  const startAudioAnalysis = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(1.0, avg / 128);
        setAudioLevel(normalized);
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch {
      setAudioLevel(0.25); // Fallback soft pulse
    }
  };

  const stopAudioAnalysis = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  const startListening = useCallback(() => {
    clearSilenceTimer();
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    latestSpeechRef.current = "";
    hasDispatchedTranscriptRef.current = false;

    if (!recognitionRef.current) {
      setError("Speech recognition unavailable in this environment.");
      return;
    }

    try {
      // Instant Barge-In: Halt speech synthesis immediately when user starts speaking
      ttsAdapter.stop();
      setIsSpeaking(false);

      setIsListening(true);
      isListeningRef.current = true;
      onListeningChange?.(true);

      recognitionRef.current.start();
      startAudioAnalysis();
    } catch {
      // If already started or transitioning, abort and start cleanly
      try {
        recognitionRef.current.abort();
        recognitionRef.current.start();
        startAudioAnalysis();
      } catch (err: any) {
        setError("Could not start microphone: " + (err?.message || "Unknown error"));
      }
    }
  }, [onListeningChange, clearSilenceTimer]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    isListeningRef.current = false;
    setIsListening(false);
    onListeningChange?.(false);

    // Immediately dispatch any captured speech on release
    if (latestSpeechRef.current && !hasDispatchedTranscriptRef.current) {
      hasDispatchedTranscriptRef.current = true;
      const text = latestSpeechRef.current;
      setTranscript(text);
      setInterimTranscript("");
      onTranscript(text);
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore already stopped
      }
    }
    stopAudioAnalysis();
  }, [onListeningChange, onTranscript, clearSilenceTimer]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  // Clean, concise speech synthesis (TTS) with instant barge-in & neural HTTP fallback
  const speak = useCallback(
    (text: string) => {
      if (!voiceResponsesEnabled || !text) return;

      const cleanText = ttsAdapter.cleanSpokenText(text);
      if (!cleanText) return;

      setLastSpokenText(cleanText);

      ttsAdapter.speak(
        cleanText,
        () => setIsSpeaking(true),
        () => setIsSpeaking(false)
      );
    },
    [voiceResponsesEnabled]
  );

  const stopSpeaking = useCallback(() => {
    ttsAdapter.stop();
    setIsSpeaking(false);
  }, []);

  const clearTranscripts = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setLastSpokenText("");
    latestSpeechRef.current = "";
    hasDispatchedTranscriptRef.current = false;
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    isSpeaking,
    transcript,
    interimTranscript,
    audioLevel,
    lastSpokenText,
    error,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    clearTranscripts,
  };
};
