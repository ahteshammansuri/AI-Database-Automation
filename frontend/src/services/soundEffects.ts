/**
 * Orbit Mascot Distinct Procedural Sound Synthesizer
 * Uses the Web Audio API for zero-latency, cross-platform, dependency-free audio effects.
 *
 * Each behavior and action has its own distinct frequency signature and musical timbre:
 * - listening: Friendly two-tone ping-pong chime (880Hz -> 1174Hz)
 * - thinking: Rhythmic gentle curiosity hum / oscillating low-frequency harmonic sweep
 * - thought_process: Cybernetic calculation flutter (rapid micro-arpeggio 523, 659, 784, 1046Hz)
 * - understanding: Clean ascending fifth acknowledgment (440Hz -> 659Hz)
 * - planning: Holographic blueprint projector resonance (350Hz sweep to 950Hz)
 * - flying / moving: Aero-levitation whoosh (filtered pink noise + smooth pitch rise)
 * - navigating: Crisp interface radar blip (800Hz bell ping)
 * - clicking / interacting: Tactile cybernetic mechanical-digital click (1200Hz pop)
 * - typing / entering_data: Cybernetic micro-keyboard chirps (rapid tiny key clicks 900-1400Hz)
 * - processing / loading: Gyroscopic orbital ring resonance (phased dual-oscillator 440Hz + 444Hz)
 * - validating: High-precision harmonic check (clean octave ping 587Hz -> 1174Hz)
 * - success / complete: Warm triumphal major triad chime (C-E-G chord: 523Hz + 659Hz + 783Hz)
 * - celebration / excited: Upbeat fanfare arpeggio (major pentatonic sparkle shimmer)
 * - error / attention: Alert chord (descending minor interval 440Hz -> 330Hz with gentle buzz)
 * - warning / oops: Puzzled double-tone caution chime (587Hz -> 440Hz triangle wave)
 * - interrupted / stop: Brake halt blip (instant drop 600Hz -> 200Hz)
 * - offline: Gentle power-down descent (440Hz -> 110Hz soft decay)
 */

class SoundEffectManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private volume: number = 0.35;
  private activeLoops: Map<string, { stop: () => void }> = new Map();

  constructor() {
    // Read persisted audio preference
    if (typeof window !== "undefined") {
      const storedMute = localStorage.getItem("orbit_mascot_muted");
      if (storedMute !== null) {
        this.muted = storedMute === "true";
      }
      const storedVol = localStorage.getItem("orbit_mascot_volume");
      if (storedVol !== null) {
        this.volume = Math.max(0.05, Math.min(1.0, parseFloat(storedVol) || 0.35));
      }
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== "undefined") {
      localStorage.setItem("orbit_mascot_muted", String(muted));
    }
    if (muted) {
      this.stopAllLoops();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1.0, vol));
    if (typeof window !== "undefined") {
      localStorage.setItem("orbit_mascot_volume", String(this.volume));
    }
  }

  public stopAllLoops(): void {
    this.activeLoops.forEach((loop) => loop.stop());
    this.activeLoops.clear();
  }

  // --- 0. IDLE / READY CHIME (Soft, friendly robotic wake chime: C5 -> E5) ---
  public playIdleSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.35;
    master.connect(ctx.destination);

    // Tone 1: C5 (523.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.6, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.24);

    // Tone 2: E5 (659.25Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.1);
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.7, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.38);
  }

  // --- 1. LISTENING CHIME (High friendly ping-pong) ---
  public playListeningSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.4;
    master.connect(ctx.destination);

    // Note 1: A5 (880Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.7, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Note 2: D6 (1174Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1174, now + 0.08);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.6, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.38);
  }

  // --- 2. THINKING HUM (Gentle rhythmic curiosity hum) ---
  public playThinkingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.3;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.linearRampToValueAtTime(320, now + 0.2);
    osc.frequency.linearRampToValueAtTime(280, now + 0.45);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(600, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.52);
  }

  // --- 3. THOUGHT PROCESS (Cybernetic arpeggio calculation flutter) ---
  public playThoughtProcessSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.28;
    master.connect(ctx.destination);

    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    freqs.forEach((freq, idx) => {
      const t = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.6, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(t + 0.14);
    });
  }

  // --- 4. UNDERSTANDING (Clean ascending fifth acknowledgment) ---
  public playUnderstandingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.38;
    master.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(440, now); // A4
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5

    osc2.frequency.setValueAtTime(880, now);
    osc2.frequency.exponentialRampToValueAtTime(1318.5, now + 0.12);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.38);
    osc2.stop(now + 0.38);
  }

  // --- 5. PLANNING (Holographic projector resonance sweep) ---
  public playPlanningSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.32;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(440, now + 0.25);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
    filter.Q.value = 4.0;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  // --- 6. FLYING / MOVING (Aero-propulsion jet slide) ---
  public playFlyingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.35;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.18);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.35);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.65, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  // --- 7. NAVIGATING (Crisp radar blip) ---
  public playNavigatingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.3;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  // --- 8. CLICKING / INTERACTING (Tactile mechanical-digital snap) ---
  public playClickingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.45;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.055);
  }

  // --- 9. TYPING / ENTERING DATA (Cybernetic micro-keyboard chirps) ---
  public playTypingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.25;
    master.connect(ctx.destination);

    // Sequence of 3 rapid subtle chirps
    [0, 0.045, 0.09].forEach((delay, idx) => {
      const t = now + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      const f = 950 + idx * 180 + (Math.random() * 80 - 40);
      osc.frequency.setValueAtTime(f, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(t + 0.045);
    });
  }

  // --- 10. PROCESSING / LOADING (Orbital ring gyroscopic hum) ---
  public playProcessingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.3;
    master.connect(ctx.destination);

    // Dual-oscillator binaural pulsation (440Hz + 444Hz)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.setValueAtTime(440, now);
    osc2.frequency.setValueAtTime(444, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.65);
    osc2.stop(now + 0.65);
  }

  // --- 11. VALIDATING (High-precision harmonic check ping) ---
  public playValidatingSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.35;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(1174.66, now + 0.08); // D6

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  // --- 12. SUCCESS / COMPLETE (Warm triumphal C-E-G major triad) ---
  public playSuccessSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.42;
    master.connect(ctx.destination);

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  // --- 13. CELEBRATION / EXCITED (Upbeat major fanfare arpeggio) ---
  public playCelebrationSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.4;
    master.connect(ctx.destination);

    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5, E5, G5, C6, E6
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.65, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(master);

      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  // --- 14. ERROR / ATTENTION (Descending minor warning alert) ---
  public playErrorSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.42;
    master.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "sine";

    osc1.frequency.setValueAtTime(380, now);
    osc1.frequency.linearRampToValueAtTime(290, now + 0.25);

    osc2.frequency.setValueAtTime(190, now);
    osc2.frequency.linearRampToValueAtTime(145, now + 0.25);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.38);
    osc2.stop(now + 0.38);
  }

  // --- 15. WARNING / OOPS (Puzzled double-tone caution chime) ---
  public playWarningSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.35;
    master.connect(ctx.destination);

    // Tone 1
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.5, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Tone 2 (Lower drop)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(440, now + 0.1);
    gain2.gain.setValueAtTime(0.5, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.32);
  }

  // --- 16. INTERRUPTED (Brake / stop blip) ---
  public playInterruptedSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.4;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  // --- 17. OFFLINE (Gentle power-down descent) ---
  public playOfflineSound(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.3;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.4);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.48);
  }

  /**
   * Play sound dynamically matched to character behavior or action string
   */
  public playSoundForBehavior(behavior: string): void {
    if (this.muted) return;
    const key = (behavior || "").toLowerCase().trim();

    switch (key) {
      case "idle":
      case "ready":
      case "activation":
        this.playIdleSound();
        break;

      case "listening":
      case "listen":
      case "transcribing":
      case "speaks":
      case "user_speaks":
        this.playListeningSound();
        break;

      case "thinking":
        this.playThinkingSound();
        break;

      case "thought_process":
      case "thought_processing":
      case "thought":
        this.playThoughtProcessSound();
        break;

      case "understanding":
      case "intent":
      case "response":
        this.playUnderstandingSound();
        break;

      case "planning":
      case "plan":
      case "retrieving_context":
        this.playPlanningSound();
        break;

      case "flying":
      case "moving":
      case "floating":
        this.playFlyingSound();
        break;

      case "navigating":
      case "pointing":
        this.playNavigatingSound();
        break;

      case "clicking":
      case "interacting":
      case "click":
        this.playClickingSound();
        break;

      case "typing":
      case "entering_data":
      case "data_entry":
        this.playTypingSound();
        break;

      case "processing":
      case "loading":
      case "working":
      case "executing":
        this.playProcessingSound();
        break;

      case "validating":
      case "verifying":
        this.playValidatingSound();
        break;

      case "success":
      case "complete":
      case "completed":
      case "succeeded":
        this.playSuccessSound();
        break;

      case "celebrate":
      case "celebration":
      case "excited":
        this.playCelebrationSound();
        break;

      case "error":
      case "failed":
      case "failure":
        this.playErrorSound();
        break;

      case "warning":
      case "oops":
      case "needs_confirmation":
      case "waiting_for_user":
        this.playWarningSound();
        break;

      case "interrupted":
      case "interrupting":
      case "cancelled":
      case "paused":
      case "stop":
        this.playInterruptedSound();
        break;

      case "offline":
      case "sleeping":
        this.playOfflineSound();
        break;

      default:
        // Default soft interaction tap
        this.playNavigatingSound();
        break;
    }
  }
}

// Global Singleton Export
export const soundManager = new SoundEffectManager();

export default soundManager;
