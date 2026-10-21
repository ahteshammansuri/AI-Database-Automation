import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLipSync, mouthAt, speechTimeline } from "./lipSync.ts";

/** A fake speech engine and clock, so playback events and time are under the test's control. */
function rig() {
  let listener: (e: any) => void = () => {};
  let clock = 1000;
  const lip = createLipSync((fn) => {
    listener = fn;
    return () => {};
  }, () => clock);
  const advance = (ms: number, frames = 10) => {
    let v = 0;
    for (let i = 0; i < frames; i++) {
      clock += ms / frames;
      v = lip.sample(0, true);
    }
    return v;
  };
  return { lip, emit: (e: any) => listener(e), advance, at: () => clock };
}

describe("Orbit lip-sync", () => {
  test("syllables follow the words: vowel shapes, closed lips for m/b/p, pauses at punctuation", () => {
    const tl = speechTimeline("Hello, moon!");
    // hel-lo, moon  (the comma adds a pause before "moon")
    assert.equal(tl.syllables.length, 3);
    assert.equal(tl.words.length, 2);
    assert.ok(tl.syllables[2].closedStart, "m starts with closed lips");
    assert.ok(tl.syllables[2].round > 0.8, "oo is round");
    assert.ok(tl.syllables[0].round < 0.3, "e is wide");
    const gap = tl.syllables[2].t - (tl.syllables[1].t + tl.syllables[1].dur);
    assert.ok(gap > 0.2, `pause at the comma (${gap})`);
    assert.ok(speechTimeline("Is it ready?").question);
    assert.equal(speechTimeline("time").syllables.length, 1, "silent final e");
  });

  test("the mouth opens within a syllable and is closed between words", () => {
    const tl = speechTimeline("ba ba");
    const s = tl.syllables[0];
    assert.equal(mouthAt(tl, s.t + s.dur * 0.1).open, 0, "b: lips still closed");
    assert.ok(mouthAt(tl, s.t + s.dur * 0.55).open > 0.8, "a: wide open mid-syllable");
    assert.equal(mouthAt(tl, s.t + s.dur + 0.02).open, 0, "closed in the gap between words");
  });

  test("Hindi (Devanagari) words get syllables and vowel shapes too", () => {
    const tl = speechTimeline("नमस्ते दोस्त");
    // न-म-स्ते  and  दो-स्त
    assert.equal(tl.words.length, 2);
    assert.ok(tl.syllables.length >= 4 && tl.syllables.length <= 6, `${tl.syllables.length}`);
    assert.ok(tl.syllables.some((s) => s.round > 0.8), "दो has a round o");
  });

  test("nothing moves until audio really starts, and the mouth settles closed after it ends", () => {
    const { emit, advance } = rig();
    assert.equal(advance(300), 0, "no speech: closed");
    emit({ type: "start", text: "Hi there, all done." });
    let peak = 0;
    for (let i = 0; i < 20; i++) peak = Math.max(peak, advance(40, 4));
    assert.ok(peak > 0.4, `talking opens the mouth (${peak})`);
    emit({ type: "end", text: "" });
    assert.ok(advance(400) < 0.02, "closed after the end event");
  });

  test("a word boundary re-anchors the mouth to the word really being spoken", () => {
    const { lip, emit, advance } = rig();
    const text = "one two three four";
    emit({ type: "start", text });
    advance(50);
    // The engine is slow: it reports "four" long after the estimate expected it.
    advance(3000);
    emit({ type: "boundary", charIndex: text.indexOf("four"), word: "four" });
    let peak = 0;
    let roundest = 0;
    for (let i = 0; i < 6; i++) {
      peak = Math.max(peak, advance(30, 3));
      roundest = Math.max(roundest, lip.round());
    }
    assert.ok(peak > 0.3, `speaking "four" right after its boundary (${peak})`);
    assert.ok(roundest > 0.6, `"ou" in four is round (${roundest})`);
  });
});
