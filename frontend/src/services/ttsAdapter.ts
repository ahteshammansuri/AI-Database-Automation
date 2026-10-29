/**
 * TTSAdapter - Text-to-Speech Engine with Local Piper/Kokoro & Browser Fallback
 *
 * Provides natural speech synthesis for the Orbit mascot with:
 *  - Default browser `window.speechSynthesis` (zero installation / zero dependencies).
 *  - Configurable local Piper / Kokoro neural TTS HTTP endpoint (for high-fidelity offline voice).
 *  - Instant Barge-In (`stop()`): immediately cancels audio playback when user starts speaking.
 *  - Clean sentence chunking: strips markdown, emojis, code fences, and limits to concise natural speech.
 *  - Seamless fallback: automatically falls back to browser synthesis if the HTTP endpoint is offline.
 */

export type TTSBackend = "browser" | "piper" | "kokoro" | "custom_http";

/** Playback events: drive mouth/lip-sync and tell the UI whether text was really spoken. */
export type TTSEvent =
  | { type: "start"; text: string }
  | { type: "boundary"; charIndex: number; word: string }
  | { type: "end"; text: string }
  | { type: "error"; text: string; reason: string }
  | { type: "cancelled"; text: string };

export interface TTSConfig {
  backend: TTSBackend;
  endpoint: string;
  voice: string;
  speed: number;
}

const DEFAULT_CONFIG: TTSConfig = {
  backend: "browser",
  endpoint: "http://127.0.0.1:5000/v1/audio/speech",
  voice: "en_US-lessac-medium",
  // Calm and clear: a little slower than normal speech, never sluggish.
  speed: 0.95,
};

/** The earlier default rate; a stored copy of it is moved to the current default (no screen ever set it). */
const PREVIOUS_DEFAULT_SPEED = 1.05;

class TTSAdapterService {
  private config: TTSConfig = { ...DEFAULT_CONFIG };
  private activeAudio: HTMLAudioElement | null = null;
  private isSpeakingActive = false;
  private abortController: AbortController | null = null;
  private listeners = new Set<(e: TTSEvent) => void>();
  private currentText = "";

  private speechQueue: Array<{ text: string; onStart?: () => void; onEnd?: () => void }> = [];
  private isProcessingQueue = false;

  public subscribe(listener: (e: TTSEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: TTSEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(e);
      } catch {
        // listener errors never break playback
      }
    });
  }

  constructor() {
    // Load persisted settings from localStorage if available
    try {
      const saved = localStorage.getItem("platform_tts_config");
      if (saved) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
        if (this.config.speed === PREVIOUS_DEFAULT_SPEED) this.config.speed = DEFAULT_CONFIG.speed;
      }
    } catch {
      // Ignore storage errors
    }
  }

  public configure(options: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...options };
    try {
      localStorage.setItem("platform_tts_config", JSON.stringify(this.config));
    } catch {
      // Ignore storage errors
    }
  }

  public getConfig(): TTSConfig {
    return { ...this.config };
  }

  public isSpeaking(): boolean {
    return this.isSpeakingActive;
  }

  /**
   * Instant Barge-In: immediately halts active audio playback, flushes the queue, and aborts pending network fetches.
   */
  public stop(): void {
    this.speechQueue = [];
    if (this.isSpeakingActive && this.currentText) {
      this.emit({ type: "cancelled", text: this.currentText });
    }
    this.currentText = "";

    // 1. Cancel browser speech synthesis
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // 2. Halt active HTTP audio element
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = "";
      this.activeAudio = null;
    }

    // 3. Abort in-flight network requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.isSpeakingActive = false;
  }

  /**
   * Sanitizes markdown, emojis, code fences, and limits text length for natural vocalization.
   */
  public cleanSpokenText(text: string): string {
    if (!text) return "";

    return text
      .replace(/```[\s\S]*?```/g, "") // Strip code blocks
      .replace(/`([^`]+)`/g, "$1") // Strip inline code backticks
      .replace(/[*_#~]/g, "") // Strip bold, italics, headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Keep link labels only
      .replace(/[🚫⚠️✅ℹ️🎉✨🤖🔥💡]/g, "") // Strip decorative emojis
      .replace(/https?:\/\/\S+/g, "link") // Replace URLs with word 'link'
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();
  }

  /**
   * Synthesizes and speaks text using the configured backend.
   * If speech is already in progress, queues the new utterance so speeches do not overlap or cut each other off.
   */
  public async speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    const clean = this.cleanSpokenText(text);
    if (!clean) {
      onEnd?.();
      return;
    }

    // If already speaking the same text or it is already in the queue, do not repeat
    if (this.currentText === clean || this.speechQueue.some((q) => q.text === clean)) {
      return;
    }

    // If an utterance is currently playing, queue this utterance rather than cutting speech off mid-sentence
    if (this.isSpeakingActive) {
      // Keep queue manageable (max 2 items: drops stale intermediate narrations, keeps latest final response)
      if (this.speechQueue.length >= 2) {
        this.speechQueue.shift();
      }
      this.speechQueue.push({ text: clean, onStart, onEnd });
      return;
    }

    await this.playItem({ text: clean, onStart, onEnd });
  }

  private async playItem(item: { text: string; onStart?: () => void; onEnd?: () => void }): Promise<void> {
    const { text, onStart, onEnd } = item;
    this.isSpeakingActive = true;
    this.currentText = text;

    const wrappedStart = () => {
      this.emit({ type: "start", text });
      onStart?.();
    };

    const wrappedEnd = () => {
      if (this.currentText === text) {
        this.currentText = "";
        this.emit({ type: "end", text });
      }
      this.isSpeakingActive = false;
      onEnd?.();

      // Process next queued utterance
      if (this.speechQueue.length > 0) {
        const next = this.speechQueue.shift()!;
        void this.playItem(next);
      }
    };

    if (this.config.backend === "browser") {
      this.speakViaBrowser(text, wrappedStart, wrappedEnd);
      return;
    }

    // Attempt neural HTTP endpoint (Piper / Kokoro)
    try {
      this.abortController = new AbortController();
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: this.config.voice,
          speed: this.config.speed,
        }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP TTS error (${res.status})`);
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      this.activeAudio = audio;

      audio.onplay = () => {
        wrappedStart();
      };

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.activeAudio = null;
        wrappedEnd();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.activeAudio = null;
        this.currentText = "";
        this.emit({ type: "error", text, reason: "audio playback failed" });
        wrappedEnd();
      };

      await audio.play();
    } catch (err: any) {
      if (err.name === "AbortError") {
        return; // Normal barge-in cancellation
      }
      console.warn("[TTSAdapter] Local neural HTTP TTS unavailable, falling back to browser speech:", err);
      // Graceful fallback to browser speech synthesis
      this.speakViaBrowser(text, wrappedStart, wrappedEnd);
    }
  }

  /**
   * Browser SpeechSynthesis implementation
   */
  private speakViaBrowser(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): void {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      this.isSpeakingActive = false;
      this.currentText = "";
      this.emit({ type: "error", text, reason: "Speech synthesis is not available in this browser." });
      onEnd?.();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.config.speed;
    utterance.pitch = 1.0;
    utterance.lang = navigator.language || "en-US";

    utterance.onstart = () => {
      this.isSpeakingActive = true;
      onStart?.();
    };

    utterance.onend = () => {
      onEnd?.();
    };

    utterance.onboundary = (ev: SpeechSynthesisEvent) => {
      const word = text.slice(ev.charIndex, ev.charIndex + (ev.charLength || 0)) || text.slice(ev.charIndex).split(/\s/)[0];
      this.emit({ type: "boundary", charIndex: ev.charIndex, word });
    };

    utterance.onerror = (ev: SpeechSynthesisErrorEvent) => {
      if (ev.error === "interrupted" || ev.error === "canceled") return; // barge-in, reported as cancelled
      this.currentText = "";
      this.emit({ type: "error", text, reason: ev.error || "speech failed" });
      onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Health probe for configured HTTP TTS endpoint.
   */
  public async probeHttpEndpoint(endpoint: string): Promise<boolean> {
    try {
      const res = await fetch(endpoint, {
        method: "HEAD",
        signal: AbortSignal.timeout(2500),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }
}

export const ttsAdapter = new TTSAdapterService();
