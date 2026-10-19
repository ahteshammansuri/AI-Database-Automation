import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createBlinker, createIdlePersonality } from "./rigPersonality.ts";

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

  test("idle personality glances or tilts, then settles, and stays still while disabled", () => {
    const p = createIdlePersonality(seq(0, 0.1, 0.9, 0.6));
    const start = performance.now() + 2500;
    assert.deepEqual(p.sample(start - 10, true), { lookX: 0, lookY: 0, headRot: 0, antenna: 0 });
    p.sample(start, true); // begins an action
    const mid = p.sample(start + 500, true);
    assert.ok(Math.abs(mid.lookX) > 0.3 || Math.abs(mid.headRot) > 3, "visible glance or tilt");
    const after = p.sample(start + 5000, true);
    assert.deepEqual(after, { lookX: 0, lookY: 0, headRot: 0, antenna: 0 });
    assert.deepEqual(p.sample(start + 20000, false), { lookX: 0, lookY: 0, headRot: 0, antenna: 0 });
  });
});
