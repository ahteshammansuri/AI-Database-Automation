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
  /** Real microphone input level 0..1, or null when it cannot be measured. */
  audioLevel: number | null;
  lastSpokenText: string;
  error: string | null;
  /**
   * The browser's built-in recognizer (Chrome/Edge webkitSpeechRecognition) sends audio
   * to the browser vendor's speech service. Surfaced so the UI can disclose it.
   */
  usesRemoteRecognition: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  clearTranscripts: () => void;
}

const SILENCE_DISPATCH_MS = 1200;

export const useVoiceLifecycle = ({
  onTranscript,
  onListeningChange,
  voiceResponsesEnabled = true,
}: VoiceLifecycleOptions): VoiceLifecycleReturn => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(ttsAdapter.isSpeaking());
  const [transcript, setTranscript] = useState<string>("");
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  const [lastSpokenText, setLastSpokenText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Callbacks live in refs so the recognizer is created once and never torn down mid-utterance
  // just because a parent re-rendered with new function identities.
  const onTranscriptRef = useRef(onTranscript);
  const onListeningChangeRef = useRef(onListeningChange);
  onTranscriptRef.current = onTranscript;
  onListeningChangeRef.current = onListeningChange;

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isListeningRef = useRef<boolean>(false);
  const latestSpeechRef = useRef<string>("");
  const dispatchedRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<any>(null);

  const usesRemoteRecognition =
    typeof window !== "undefined" && !(window as any).SpeechRecognition && !!(window as any).webkitSpeechRecognition;

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopAudioAnalysis = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setAudioLevel(null);
  };

  const setListening = (v: boolean) => {
    isListeningRef.current = v;
    setIsListening(v);
    onListeningChangeRef.current?.(v);
  };

  /** Send the captured utterance exactly once per listening session. */
  const dispatch = (text: string) => {
    const clean = text.trim();
    if (!clean || dispatchedRef.current) return;
    dispatchedRef.current = true;
    clearSilenceTimer();
    setTranscript(clean);
    setInterimTranscript("");
    onTranscriptRef.current(clean);
  };

  // Track real playback state from the single TTS channel.
  useEffect(() => {
    return ttsAdapter.subscribe((e) => {
      if (e.type === "start") setIsSpeaking(true);
      if (e.type === "end" || e.type === "error" || e.type === "cancelled") setIsSpeaking(false);
    });
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      setError("Voice input is not supported in this browser. Use \"Type instead\".");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      setError(null);
      dispatchedRef.current = false;
      setListening(true);
    };

    recognition.onresult = (event: any) => {
      let finalTxt = "";
      let interimTxt = "";
      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item?.[0]) {
          if (item.isFinal) finalTxt += item[0].transcript + " ";
          else interimTxt += item[0].transcript + " ";
        }
      }
      finalTxt = finalTxt.trim();
      interimTxt = interimTxt.trim();
      const active = [finalTxt, interimTxt].filter(Boolean).join(" ").trim();
      if (active) latestSpeechRef.current = active;

      // Released already (press-and-hold): send as soon as text arrives.
      if (!isListeningRef.current && active) {
        stopAudioAnalysis();
        dispatch(active);
        return;
      }

      setInterimTranscript(active);
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        if (latestSpeechRef.current && !dispatchedRef.current) {
          try {
            recognition.stop();
          } catch {
            // already stopping
          }
          setListening(false);
          stopAudioAnalysis();
          dispatch(latestSpeechRef.current);
        }
      }, SILENCE_DISPATCH_MS);
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      if (event.error === "no-speech") {
        if (!latestSpeechRef.current) setError("I didn't hear anything. Hold the button and speak, or type instead.");
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow it in the browser, or type instead.");
      } else if (event.error === "network") {
        setError("Speech recognition needs a network connection in this browser. Type instead, or try again.");
      } else if (event.error === "audio-capture") {
        setError("No microphone was found. Type instead.");
      } else if (event.error !== "aborted") {
        setError(`Voice input problem (${event.error}). You can type instead.`);
      }
      stopAudioAnalysis();
      setListening(false);
    };

    recognition.onend = () => {
      clearSilenceTimer();
      stopAudioAnalysis();
      if (isListeningRef.current) setListening(false);
      if (latestSpeechRef.current && !dispatchedRef.current) dispatch(latestSpeechRef.current);
    };

    recognitionRef.current = recognition;
    return () => {
      clearSilenceTimer();
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      stopAudioAnalysis();
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAudioAnalysis = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isListeningRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setAudioLevel(Math.min(1, sum / data.length / 128));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setAudioLevel(null); // level unavailable; never faked
    }
  };

  const startListening = useCallback(() => {
    clearSilenceTimer();
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    latestSpeechRef.current = "";
    dispatchedRef.current = false;

    // Barge-in: Orbit stops talking the moment the user starts.
    ttsAdapter.stop();

    if (!recognitionRef.current) {
      setError("Voice input is unavailable here. Type instead.");
      return;
    }
    setListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      try {
        recognitionRef.current.abort();
        recognitionRef.current.start();
      } catch (err: any) {
        setListening(false);
        setError("Could not start the microphone: " + (err?.message || "unknown error"));
        return;
      }
    }
    void startAudioAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    setListening(false);
    if (latestSpeechRef.current) dispatch(latestSpeechRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    stopAudioAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  const speak = useCallback(
    (text: string) => {
      if (!voiceResponsesEnabled || !text) return;
      const clean = ttsAdapter.cleanSpokenText(text);
      if (!clean) return;
      setLastSpokenText(clean);
      void ttsAdapter.speak(clean);
    },
    [voiceResponsesEnabled]
  );

  const stopSpeaking = useCallback(() => ttsAdapter.stop(), []);

  const clearTranscripts = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setLastSpokenText("");
    latestSpeechRef.current = "";
    dispatchedRef.current = false;
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
    usesRemoteRecognition,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    clearTranscripts,
  };
};
