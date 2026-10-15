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
  speed: 1.05,
};

class TTSAdapterService {
  private config: TTSConfig = { ...DEFAULT_CONFIG };
  private activeAudio: HTMLAudioElement | null = null;
  private isSpeakingActive = false;
  private abortController: AbortController | null = null;

  constructor() {
    // Load persisted settings from localStorage if available
    try {
      const saved = localStorage.getItem("platform_tts_config");
      if (saved) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
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
   * Instant Barge-In: immediately halts active audio playback and aborts pending network fetches.
   */
  public stop(): void {
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
   * Synthesizes and speaks text using the configured backend with instant barge-in safety.
   */
  public async speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> {
    const clean = this.cleanSpokenText(text);
    if (!clean) return;

    // Instant barge-in: stop any currently active utterance or sound before starting
    this.stop();
    this.isSpeakingActive = true;

    if (this.config.backend === "browser") {
      this.speakViaBrowser(clean, onStart, onEnd);
      return;
    }

    // Attempt neural HTTP endpoint (Piper / Kokoro)
    try {
      this.abortController = new AbortController();
      const res = await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
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
        onStart?.();
      };

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.activeAudio = null;
        this.isSpeakingActive = false;
        onEnd?.();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.activeAudio = null;
        this.isSpeakingActive = false;
        onEnd?.();
      };

      await audio.play();
    } catch (err: any) {
      if (err.name === "AbortError") {
        return; // Normal barge-in cancellation
      }
      console.warn("[TTSAdapter] Local neural HTTP TTS unavailable, falling back to browser speech:", err);
      // Graceful fallback to browser speech synthesis
      this.speakViaBrowser(clean, onStart, onEnd);
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
      this.isSpeakingActive = false;
      onEnd?.();
    };

    utterance.onerror = () => {
      this.isSpeakingActive = false;
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
