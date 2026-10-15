import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { faceKey } from "./faceTexture.ts";
import { chooseRenderer } from "./rendererChoice.ts";

const base = { eyes: "open" as const, mouth: "smile" as const, lookX: 0, lookY: 0, lid: 0, mouthOpen: 0, blush: true, eyeScale: 1 };

describe("3D Orbit", () => {
  test("face texture is only redrawn when something visible changes", () => {
    assert.equal(faceKey(base), faceKey({ ...base, lookX: 0.01 }), "imperceptible gaze change: no redraw");
    assert.notEqual(faceKey(base), faceKey({ ...base, lookX: 0.3 }));
    assert.notEqual(faceKey(base), faceKey({ ...base, eyes: "happy" }));
    assert.notEqual(faceKey(base), faceKey({ ...base, lid: 1 }), "blink redraws");
    assert.notEqual(faceKey({ ...base, mouth: "talk", mouthOpen: 0.1 }), faceKey({ ...base, mouth: "talk", mouthOpen: 0.6 }));
  });

  test("real-time 3D for the main character, SVG for tiny avatars and without WebGL", () => {
    assert.equal(chooseRenderer("md", true), "3d");
    assert.equal(chooseRenderer("xl", true), "3d");
    assert.equal(chooseRenderer("sm", true), "svg");
    assert.equal(chooseRenderer("md", false), "svg");
  });
});
