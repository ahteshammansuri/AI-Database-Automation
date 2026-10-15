import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { actionBridge } from "./actionBridge.ts";

describe("ActionBridge reports real outcomes", () => {
  test("returns not_mounted (never ok) when no page handles the action", async () => {
    const res = await actionBridge.dispatchAsync("ui.focus_target", { target: "x" }, { mountTimeoutMs: 50 });
    assert.equal(res.status, "not_mounted");
  });

  test("rejects actions that are not allowlisted", async () => {
    const res = await actionBridge.dispatchAsync("run_arbitrary_js", { code: "alert(1)" });
    assert.equal(res.status, "error");
  });

  test("waits for a handler that mounts shortly after (e.g. after navigation)", async () => {
    setTimeout(() => {
      actionBridge.on("navigation.navigate", () => ({ status: "ok", data: { opened: true } }));
    }, 30);
    const res = await actionBridge.dispatchAsync("navigation.navigate", { route: "/connections" }, { mountTimeoutMs: 500 });
    assert.equal(res.status, "ok");
    assert.deepEqual(res.data, { opened: true });
  });

  test("passes through validation errors from the real handler", async () => {
    const off = actionBridge.on("ui.focus_target", () => ({ status: "validation_error", errors: { port: "Port must be 1-65535." } }));
    const res = await actionBridge.dispatchAsync("ui.focus_target", { target: "port" });
    assert.equal(res.status, "validation_error");
    off();
  });

  test("times out a handler that never finishes", async () => {
    const off = actionBridge.on("ui.focus_target", () => new Promise(() => {}));
    const res = await actionBridge.dispatchAsync("ui.focus_target", {}, { timeoutMs: 40 });
    assert.equal(res.status, "timeout");
    off();
  });
});
