import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveCharacterState } from "./orbitBehavior.ts";

const base = { sending: false, speaking: false };

describe("Orbit character state follows real runtime state", () => {
  test("no success or celebration without a SUCCEEDED task status from the server", () => {
    for (const status of [null, "RUNNING", "QUEUED", "ANSWERED", "WAITING_FOR_INPUT", "FAILED", "PARTIAL_SUCCESS"]) {
      const s = deriveCharacterState({ ...base, taskStatus: status, speechEmotion: "celebrating" });
      assert.notEqual(s, "success", `status ${status}`);
      assert.notEqual(s, "celebrate", `status ${status}`);
    }
    assert.equal(deriveCharacterState({ ...base, taskStatus: "SUCCEEDED" }), "success");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "SUCCEEDED", speechEmotion: "celebrating" }), "celebrate");
  });

  test("thinking only while a turn is actually running; working only during a tool call", () => {
    assert.equal(deriveCharacterState({ ...base, taskStatus: "RUNNING", turnStage: "THINKING" }), "thinking");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "RUNNING", turnStage: "CALLING_TOOL", runningTool: "test_database_connection" }), "working");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "RUNNING", turnStage: "CALLING_TOOL", runningTool: "scan_database_schema" }), "processing");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "ANSWERED", turnStage: "THINKING" }), "idle");
  });

  test("waiting, confirmation, stop and service failure states", () => {
    assert.equal(deriveCharacterState({ ...base, taskStatus: "WAITING_FOR_INPUT" }), "waiting_for_user");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "WAITING_FOR_APPROVAL" }), "needs_confirmation");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "INTERRUPT_REQUESTED" }), "interrupted");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "FAILED", serviceError: true }), "offline");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "FAILED" }), "error");
  });

  test("speaking reflects real playback and never hides an active turn", () => {
    assert.equal(deriveCharacterState({ ...base, taskStatus: "ANSWERED", speaking: true }), "speaking");
    assert.equal(deriveCharacterState({ ...base, taskStatus: "RUNNING", turnStage: "THINKING", speaking: true }), "thinking");
  });
});

import { collapseTimeline } from "./orbitBehavior.ts";

describe("Timeline never spins after the work is done", () => {
  const row = (id: number, status: string, trace?: string, step = "List Database Connections") =>
    ({ id, task_id: 1, step_name: step, status, message: `${status} ${id}`, details: trace ? { trace_id: trace } : null, created_at: "" });

  test("a finished row replaces its running row in place", () => {
    const rows = collapseTimeline([row(1, "succeeded", undefined, "RAG"), row(2, "running", "t1"), row(3, "succeeded", "t1")], true);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].id, 3);
  });

  test("leftover running rows become stopped once the task is no longer active", () => {
    const rows = collapseTimeline([row(1, "running", "t9"), row(2, "running", undefined, "NEW_INSTRUCTION")], false);
    assert.deepEqual(rows.map((r) => r.status), ["stopped", "stopped"]);
  });
});
