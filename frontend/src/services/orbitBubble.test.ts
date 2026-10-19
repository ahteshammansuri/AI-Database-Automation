import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bubbleText, pickBubble, type BubbleInput } from "./orbitBubble.ts";

const idle: BubbleInput = {
  caption: null, taskId: 7, status: "ANSWERED", awaitingConfirmationTool: null, speech: null,
  narration: null, runningStep: null, queue: null,
};

describe("bubbleText", () => {
  test("strips markdown but keeps identifiers and signs exact", () => {
    const r = bubbleText("## Done\n**Blog DB** is `connected`, see [history](/executions).\n- table blog_posts\n-5 rows");
    assert.equal(r.text, "Done Blog DB is connected, see history. table blog_posts -5 rows");
    assert.equal(r.truncated, false);
  });
  test("cuts long text at a word boundary", () => {
    const r = bubbleText("word ".repeat(60), 40);
    assert.ok(r.truncated);
    assert.ok(r.text.endsWith("…"));
    assert.ok(!r.text.includes("wor…"));
  });
});

describe("pickBubble", () => {
  test("nothing to say when idle without speech", () => {
    assert.equal(pickBubble(idle), null);
  });
  test("a pending confirmation wins over work and replies, and opens the panel", () => {
    const b = pickBubble({ ...idle, status: "WAITING_FOR_APPROVAL", awaitingConfirmationTool: "press",
      speech: { messageId: 3, text: "Remove Blog DB? This does not touch your tables.", isServiceError: false } });
    assert.equal(b?.kind, "confirm");
    assert.equal(b?.action, "Open to confirm");
    assert.match(b!.text, /Remove Blog DB/);
    assert.equal(b?.ttlMs, undefined, "stays until answered");
  });
  test("while working it shows Orbit's own narration, else the running step, else the real queue", () => {
    const run = { ...idle, status: "RUNNING" };
    assert.equal(pickBubble({ ...run, narration: "Opening the connection form.", runningStep: "Open form" })?.text, "Opening the connection form.");
    assert.equal(pickBubble({ ...run, runningStep: "Fill name, host" })?.text, "Fill name, host");
    assert.equal(pickBubble({ ...run, status: "QUEUED", queue: { ahead: 2, worker_alive: true } })?.text, "Queued: 2 request(s) ahead of yours.");
    assert.equal(pickBubble({ ...run, status: "QUEUED", queue: { ahead: 0, worker_alive: false } })?.text, "Waiting for the Orbit worker to start.");
    assert.equal(pickBubble(run), null, "no invented progress");
  });
  test("questions and replies come from the model's speech; long replies offer the panel", () => {
    const q = pickBubble({ ...idle, status: "WAITING_FOR_INPUT", speech: { messageId: 9, text: "Which table?", isServiceError: false } });
    assert.deepEqual([q?.kind, q?.action], ["question", "Reply"]);
    const long = pickBubble({ ...idle, speech: { messageId: 10, text: "x ".repeat(200), isServiceError: false } });
    assert.deepEqual([long?.kind, long?.action], ["reply", "Read more"]);
    assert.ok((long?.ttlMs ?? 0) <= 14000);
    const err = pickBubble({ ...idle, status: "FAILED", speech: { messageId: 11, text: "The AI service is down.", isServiceError: true } });
    assert.equal(err?.kind, "error");
  });
  test("a show-me caption has top priority", () => {
    const b = pickBubble({ ...idle, status: "RUNNING", narration: "x", caption: { key: "caption:1", text: "This is the schedule." } });
    assert.equal(b?.kind, "caption");
  });
});
