import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createBlinker, createIdlePersonality, createSaccades } from "./rigPersonality.ts";

/** Deterministic random sequence for repeatable timing. */
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe("Orbit idle personality", () => {
  test("blink closes and reopens smoothly instead of snapping", () => {
    const b = createBlinker(seq(0, 0.9));
    const t0 = performance.now() + 2600; // first blink after the minimum gap
    const samples = [0, 35, 70, 100, 160, 260].map((d) => b.lid(t0 + d, true));
    // t0 is a fraction of a millisecond after the blinker's own start time.
    assert.ok(samples[0] < 0.05, `open at the start: ${samples[0]}`);
    assert.ok(samples[1] > 0.3 && samples[1] < 0.7, `half closed at 35 ms: ${samples[1]}`);
    assert.ok(samples[2] > 0.95, "closed");
    assert.ok(samples[4] > 0 && samples[4] < 1, "opening");
    assert.equal(samples[5], 0);
    assert.equal(b.lid(t0 + 35, false), 0, "no blinking when disabled");
  });

  test("idle personality glances, tilts or smiles, then settles, and stays still while disabled", () => {
    const p = createIdlePersonality(seq(0, 0.1, 0.9, 0.6));
    const start = performance.now() + 2500;
    assert.deepEqual(p.sample(start - 10, true), { lookX: 0, lookY: 0, headRot: 0, antenna: 0, smile: 0 });
    p.sample(start, true); // begins an action
    const mid = p.sample(start + 500, true);
    assert.ok(Math.abs(mid.lookX) > 0.3 || Math.abs(mid.headRot) > 3, "visible glance or tilt");
    const after = p.sample(start + 5000, true);
    assert.deepEqual(after, { lookX: 0, lookY: 0, headRot: 0, antenna: 0, smile: 0 });
    assert.deepEqual(p.sample(start + 20000, false), { lookX: 0, lookY: 0, headRot: 0, antenna: 0, smile: 0 });
  });
  test("an occasional smile squeezes the eyes for a moment and then lets go", () => {
    // 0: first act after the minimum delay; 0.9: the smile; 0: shortest duration (1100 ms); 0.5: direction.
    const p = createIdlePersonality(seq(0, 0.9, 0, 0.5, 0.5));
    const start = performance.now() + 2500;
    p.sample(start, true);
    const mid = p.sample(start + 550, true);
    assert.ok(mid.smile > 0.9, `smiling mid-way (${mid.smile})`);
    assert.equal(p.sample(start + 5000, true).smile, 0, "back to normal");
  });
  test("micro-saccades are tiny, change every second or two, and stop when disabled", () => {
    const s = createSaccades(seq(1, 0, 0.5));
    const t0 = 10_000;
    const a = s.sample(t0, true);
    assert.ok(Math.abs(a.x) <= 0.07 && Math.abs(a.y) <= 0.05, "small offsets");
    assert.deepEqual(s.sample(t0 + 300, true), a, "holds between saccades");
    assert.deepEqual(s.sample(t0 + 400, false), { x: 0, y: 0 });
  });
});
