import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POSES, poseFor, applyEmotion, NUMERIC_KEYS } from "./poses.ts";

const REQUIRED = [
  "idle", "curious", "greeting", "resting", "waking", "listening", "transcribing", "thinking", "speaking", "interrupted",
  "planning", "moving", "arriving", "pointing", "clicking", "typing", "inspecting", "waiting", "validating", "working",
  "returning", "success", "partial_success", "needs_input", "needs_confirmation", "warning", "error", "paused", "cancelled", "offline",
];

describe("Orbit pose library", () => {
  test("every required behaviour state has its own articulated pose", () => {
    for (const s of REQUIRED) {
      assert.ok(POSES[s], `missing pose ${s}`);
      for (const k of NUMERIC_KEYS) assert.equal(typeof POSES[s][k], "number", `${s}.${k}`);
    }
  });

  test("states used by the app resolve (aliases) and unknown states fall back to idle", () => {
    assert.equal(poseFor("waiting_for_user"), POSES.needs_input);
    assert.equal(poseFor("executing"), POSES.working);
    assert.equal(poseFor("totally-unknown"), POSES.idle);
  });

  test("gestures are articulated, not a single sprite", () => {
    assert.equal(POSES.pointing.rHand, "point");
    assert.equal(POSES.greeting.rHand, "open");
    assert.ok(POSES.greeting.motions.includes("wave"));
    assert.ok(POSES.clicking.motions.includes("tap"));
    assert.notEqual(POSES.thinking.rShoulder, POSES.idle.rShoulder);
  });

  test("emotion hints only adjust the face and never invent success", () => {
    const p = applyEmotion(POSES.error, "celebrating");
    assert.equal(p.core, POSES.error.core);
    assert.deepEqual(p.motions, POSES.error.motions);
  });
});
