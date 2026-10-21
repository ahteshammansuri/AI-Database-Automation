import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { orbitStage } from "./orbitStage.ts";

describe("Orbit stage events", () => {
  test("an action waits for Orbit's real arrival at its own target", async () => {
    const waiting = orbitStage.waitFor((e) => e.type === "arrived" && e.target === "nav:/security", 1000);
    orbitStage.emit({ type: "arrived", target: "nav:/connections" }); // a different target does not count
    orbitStage.emit({ type: "arrived", target: "nav:/security" });
    assert.deepEqual(await waiting, { type: "arrived", target: "nav:/security" });
  });

  test("waiting gives up after the timeout so a lost animation never blocks Orbit", async () => {
    const started = Date.now();
    assert.equal(await orbitStage.waitFor((e) => e.type === "arrived", 60), null);
    assert.ok(Date.now() - started < 500);
  });
});
