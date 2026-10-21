/**
 * Natural lip-sync for Orbit, driven by real speech playback (ttsAdapter events).
 *
 * The text being spoken is split into syllables; each syllable gets a mouth shape from its vowel
 * (a: open, e/i: wide, o/u: round; m/b/p start with closed lips) and a duration. Punctuation adds
 * pauses where the mouth closes into a smile. Every real word-boundary event from the speech engine
 * re-anchors the timeline to that word, so the mouth follows the actual voice instead of drifting.
 * Nothing moves unless audio is really playing. No imports, so the node test runner loads it directly.
 */

export interface Syllable {
  /** Start, seconds from the beginning of the utterance (before re-anchoring). */
  t: number;
  dur: number;
  /** Peak openness 0..1 for this vowel. */
  open: number;
  /** 0 = wide ("ee"), 1 = round ("oo"). */
  round: number;
  /** Starts with closed lips (m, b, p). */
  closedStart: boolean;
  /** First syllable of a word (small head/brow emphasis). */
  stress: boolean;
}

export interface SpeechTimeline {
  syllables: Syllable[];
  /** Word start positions: character index in the text and timeline time. */
  words: { at: number; t: number }[];
  total: number;
  question: boolean;
}

type Vowel = "a" | "e" | "i" | "o" | "u";
const VISEME: Record<Vowel, [open: number, round: number]> = {
  a: [0.95, 0.25],
  e: [0.62, 0.1],
  i: [0.45, 0],
  o: [0.82, 0.92],
  u: [0.52, 1],
};

const SYLLABLE_S = 0.2;
const WORD_GAP_S = 0.05;
const COMMA_S = 0.24;
const STOP_S = 0.42;

type Group = { v: Vowel; closed: boolean; long: boolean };

/** Latin script (English, Hinglish): vowel groups are syllables. */
function latinGroups(word: string): Group[] {
  const w = word.toLowerCase();
  const out: Group[] = [];
  const re = /[aeiouy]+/g;
  let last = 0;
  for (const m of w.matchAll(re)) {
    const idx = m.index ?? 0;
    // A leading "y" before a vowel is a consonant ("yes", "you").
    let g = m[0];
    if (g.length > 1 && g[0] === "y" && idx === 0) g = g.slice(1);
    const onset = w.slice(last, idx);
    const first = g[0] === "y" ? "i" : (g[0] as Vowel);
    out.push({ v: first, closed: /[mbp]/.test(onset), long: g.length >= 2 });
    last = idx + m[0].length;
  }
  // Silent final "e" ("make", "time") is not a syllable of its own.
  if (out.length > 1 && /[^aeiouy]e$/.test(w)) out.pop();
  return out;
}

/** Devanagari: each akshara is a syllable; its vowel sign sets the mouth shape. */
function devanagariGroups(word: string): Group[] {
  const out: Group[] = [];
  let joinNext = false;
  for (const ch of word) {
    const c = ch.codePointAt(0)!;
    if (c === 0x094d) {
      joinNext = true; // virama: the next consonant joins this syllable
      continue;
    }
    if ((c >= 0x0905 && c <= 0x0914) || (c >= 0x0915 && c <= 0x0939) || (c >= 0x0958 && c <= 0x095f)) {
      if (joinNext && out.length) {
        joinNext = false;
        continue;
      }
      const independent: Record<number, Vowel> = { 0x0907: "i", 0x0908: "i", 0x0909: "u", 0x090a: "u", 0x090f: "e", 0x0910: "e", 0x0913: "o", 0x0914: "o" };
      const labial = c === 0x092e || c === 0x092c || c === 0x092d || c === 0x092a || c === 0x092b;
      out.push({ v: independent[c] ?? "a", closed: labial, long: false });
      continue;
    }
    const sign: Record<number, Vowel> = { 0x093e: "a", 0x093f: "i", 0x0940: "i", 0x0941: "u", 0x0942: "u", 0x0947: "e", 0x0948: "e", 0x094b: "o", 0x094c: "o" };
    if (sign[c] && out.length) {
      out[out.length - 1].v = sign[c];
      out[out.length - 1].long = c === 0x093e || c === 0x0940 || c === 0x0942 || c === 0x0948 || c === 0x094c;
    }
  }
  return out;
}

function groupsFor(word: string): Group[] {
  if (/[ऀ-ॿ]/.test(word)) return devanagariGroups(word);
  if (/^\d+$/.test(word)) return Array.from({ length: Math.min(6, word.length) }, (_, i) => ({ v: (i % 2 ? "e" : "a") as Vowel, closed: false, long: false }));
  const g = latinGroups(word);
  if (g.length) return g;
  // Other scripts or vowel-less tokens: about one syllable per two or three letters.
  return Array.from({ length: Math.max(1, Math.round([...word].length / 2.5)) }, () => ({ v: "a" as Vowel, closed: false, long: false }));
}

/** Syllable timeline for an utterance at the given speaking rate. */
export function speechTimeline(text: string, rate = 1): SpeechTimeline {
  const syllables: Syllable[] = [];
  const words: { at: number; t: number }[] = [];
  let t = 0;
  for (const m of text.matchAll(/[\p{L}\p{M}\p{N}']+|[.,!?;:…।]/gu)) {
    const tok = m[0];
    if (/^[.!?…।]$/.test(tok)) {
      t += STOP_S / rate;
      continue;
    }
    if (/^[,;:]$/.test(tok)) {
      t += COMMA_S / rate;
      continue;
    }
    words.push({ at: m.index ?? 0, t });
    groupsFor(tok).forEach((g, i) => {
      const [open, round] = VISEME[g.v];
      const dur = (SYLLABLE_S / rate) * (g.long ? 1.25 : 1);
      syllables.push({ t, dur, open, round, closedStart: g.closed, stress: i === 0 });
      t += dur;
    });
    t += WORD_GAP_S / rate;
  }
  return { syllables, words, total: t, question: text.trim().endsWith("?") };
}

/** Mouth target at timeline time t (seconds): openness, roundness and word-onset emphasis. */
export function mouthAt(tl: SpeechTimeline, t: number): { open: number; round: number; beat: number } {
  if (t > tl.total) {
    // The voice is still playing past the estimate (slow voice): keep a soft, natural chatter.
    return { open: 0.3 + 0.25 * Math.abs(Math.sin(t * 9)), round: 0.5 + 0.4 * Math.sin(t * 3.3), beat: 0 };
  }
  const list = tl.syllables;
  let lo = 0;
  let hi = list.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const s = hit >= 0 ? list[hit] : null;
  if (!s || t >= s.t + s.dur) return { open: 0, round: s?.round ?? 0.5, beat: 0 }; // pause between words
  const u = (t - s.t) / s.dur;
  const c0 = s.closedStart ? 0.22 : 0.06;
  const x = (u - c0) / (1 - c0 - 0.08);
  const env = x <= 0 || x >= 1 ? 0 : Math.pow(Math.sin(Math.PI * x), 0.6);
  return { open: s.open * env, round: s.round, beat: s.stress ? env : 0 };
}

type SpeechEvent = { type: string; text?: string; charIndex?: number };

/**
 * Lip-sync sampler for a renderer. `sample()` returns the smoothed openness (call once per frame);
 * `round()`, `beat()` and `asking()` describe the current shape, emphasis and question intonation.
 */
export function createLipSync(subscribe: (fn: (e: SpeechEvent) => void) => () => void, now: () => number = () => performance.now()) {
  let tl: SpeechTimeline | null = null;
  let playing = false;
  let anchor = 0;
  let open = 0;
  let round = 0.5;
  let beat = 0;
  let lastSample = 0;

  const unsubscribe = subscribe((e) => {
    if (e.type === "start") {
      tl = speechTimeline(e.text ?? "");
      playing = true;
      anchor = now();
    } else if (e.type === "boundary") {
      if (!tl || typeof e.charIndex !== "number") return;
      // Re-anchor to the word the engine is really saying now.
      let w: { at: number; t: number } | undefined;
      for (const x of tl.words) {
        if (x.at <= e.charIndex) w = x;
        else break;
      }
      if (w) anchor = now() - w.t * 1000;
    } else if (e.type === "end" || e.type === "error" || e.type === "cancelled") {
      playing = false;
    }
  });

  return {
    sample(_time: number, active: boolean): number {
      const ms = now();
      const dt = Math.min(0.1, lastSample ? (ms - lastSample) / 1000 : 0.033);
      lastSample = ms;
      const tg = active && playing && tl ? mouthAt(tl, (ms - anchor) / 1000) : { open: 0, round: 0.5, beat: 0 };
      // Lips open quickly and close a little slower, like real articulation.
      open += (tg.open - open) * (1 - Math.exp(-dt * (tg.open > open ? 32 : 20)));
      round += (tg.round - round) * (1 - Math.exp(-dt * 14));
      beat += (tg.beat - beat) * (1 - Math.exp(-dt * 16));
      return open;
    },
    round(_time?: number): number {
      return round;
    },
    beat(): number {
      return beat;
    },
    /** The utterance is a question (brows lift a little while asking). */
    asking(): boolean {
      return playing && !!tl?.question;
    },
    dispose: unsubscribe,
  };
}
