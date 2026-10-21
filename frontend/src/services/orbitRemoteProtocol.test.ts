import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildRemoteState, codeFromHash, createThrottle, formatCountdown, gazeChanged, gazeFromRect, isLoopbackHost, micNeedsHttps,
  pairingLink, remoteFaceState, remoteGazeDirection, remoteStatusLine,
} from "./orbitRemoteProtocol.ts";

const CODE = "A".repeat(43);

describe("Orbit Remote protocol", () => {
  test("the phone watches the web Orbit: flight looks curious, hands-on work looks focused, the rest is mirrored", () => {
    assert.equal(remoteFaceState("moving"), "curious");
    assert.equal(remoteFaceState("navigating"), "curious");
    assert.equal(remoteFaceState("clicking"), "working");
    assert.equal(remoteFaceState("typing"), "working");
    assert.equal(remoteFaceState("validating"), "inspecting");
    for (const s of ["thinking", "speaking", "listening", "success", "error", "needs_confirmation", "idle"]) assert.equal(remoteFaceState(s), s);
    assert.equal(remoteFaceState(undefined), "idle");
  });

  test("eyes follow the web Orbit while it is away or busy, and relax when it rests in its corner", () => {
    const left = remoteGazeDirection({ x: 0.1, y: 0.3, docked: false, moving: true }, "moving");
    assert.ok(left && left.x < -0.7 && left.y < 0);
    const corner = { x: 0.95, y: 0.9, docked: true, moving: false };
    assert.equal(remoteGazeDirection(corner, "idle"), null);
    const busy = remoteGazeDirection(corner, "thinking");
    assert.ok(busy && busy.x > 0.8 && busy.y > 0.6);
    assert.equal(remoteGazeDirection({ x: Number.NaN, y: 0, docked: false, moving: true }, "moving"), null);
    const g = gazeFromRect({ left: 940, top: 600, width: 120, height: 152 }, 1000, 800, true, false);
    assert.deepEqual(g, { x: 1, y: 0.845, docked: true, moving: false });
    assert.equal(gazeChanged(g, { ...g, x: 0.997 }), false);
    assert.equal(gazeChanged(g, { ...g, x: 0.9 }), true);
    assert.equal(gazeChanged(g, { ...g, moving: true }), true);
  });

  test("the state the tab sends is bounded and spells out what needs the computer", () => {
    const s = buildRemoteState({
      face: "Thinking", statusText: "Thinking", speaking: false, working: true, narration: "Opening Connections",
      taskStatus: "RUNNING", taskGoal: "connect my blog", pageTitle: "Dashboard", lastUserText: "connect my blog",
    });
    assert.equal(s.face, "thinking");
    assert.equal(s.caption, "Opening Connections");
    assert.equal(s.caption_kind, "narration");
    assert.equal(s.needs, null);
    const working = buildRemoteState({ face: "thinking", statusText: "Thinking", speaking: false, working: true, speechText: "Earlier reply", lastUserText: "open approvals" });
    assert.equal(working.caption, "open approvals");
    assert.equal(working.caption_kind, "user");
    assert.equal(buildRemoteState({ face: "idle", statusText: "Ready", speaking: false, working: false, speechText: "All done." }).caption, "All done.");
    const long = buildRemoteState({ face: "speaking", statusText: "Speaking", speaking: true, working: false, speechText: "word ".repeat(400) });
    assert.ok((long.caption ?? "").length <= 600 && long.caption!.endsWith("…"));
    assert.equal(buildRemoteState({ face: "needs_confirmation", statusText: "", speaking: false, working: false, taskStatus: "WAITING_FOR_APPROVAL" }).needs, "confirm");
    assert.equal(buildRemoteState({ face: "waiting_for_user", statusText: "", speaking: false, working: false, taskStatus: "WAITING_FOR_INPUT", secureInput: true }).needs, "secret");
    assert.equal(buildRemoteState({ face: "<b>", statusText: "", speaking: false, working: false }).face, "b");
  });

  test("status line under the phone face", () => {
    const base = buildRemoteState({ face: "idle", statusText: "Ready", speaking: false, working: false });
    assert.equal(remoteStatusLine(base, { desktopOnline: true, holding: true, sending: false }), "Listening… release to send");
    assert.equal(remoteStatusLine(base, { desktopOnline: false, holding: false, sending: false }), "Your computer is not connected");
    assert.equal(remoteStatusLine({ ...base, needs: "confirm" }, { desktopOnline: true, holding: false, sending: false }), "Confirm on your computer to continue");
    assert.equal(remoteStatusLine({ ...base, needs: "secret" }, { desktopOnline: true, holding: false, sending: false }), "Type the password or key on your computer");
    assert.equal(remoteStatusLine(base, { desktopOnline: true, holding: false, sending: false }), "Ready");
  });

  test("pairing link: configured address, this address, or this machine's Wi-Fi address instead of localhost", () => {
    const base = { protocol: "http:", port: "5173", code: CODE, lanAddresses: ["192.168.1.20", "10.0.0.5"] };
    assert.deepEqual(pairingLink({ ...base, hostname: "localhost" }), {
      url: `http://192.168.1.20:5173/orbit/remote#code=${CODE}`, reach: "lan", host: "192.168.1.20:5173",
    });
    assert.equal(pairingLink({ ...base, hostname: "127.0.0.1", preferredHost: "10.0.0.5" }).host, "10.0.0.5:5173");
    assert.equal(pairingLink({ ...base, hostname: "localhost", lanAddresses: [] }).reach, "local");
    assert.equal(pairingLink({ ...base, hostname: "192.168.1.20" }).reach, "same");
    const pub = pairingLink({ ...base, hostname: "localhost", publicUrl: "https://app.example.com/" });
    assert.equal(pub.url, `https://app.example.com/orbit/remote#code=${CODE}`);
    assert.equal(pub.reach, "public");
    assert.equal(codeFromHash(`#code=${CODE}`), CODE);
    assert.equal(codeFromHash("#code=short"), null);
    assert.equal(codeFromHash(""), null);
  });

  test("helpers", () => {
    assert.ok(isLoopbackHost("localhost") && isLoopbackHost("127.0.0.1") && isLoopbackHost("[::1]"));
    assert.ok(!isLoopbackHost("192.168.1.2"));
    assert.ok(micNeedsHttps("http:", "192.168.1.2"));
    assert.ok(!micNeedsHttps("https:", "192.168.1.2"));
    assert.ok(!micNeedsHttps("http:", "localhost"));
    assert.equal(formatCountdown(161), "2:41");
    assert.equal(formatCountdown(-3), "0:00");
  });

  test("throttle delivers the first call now and the last call of a burst later", async () => {
    let t = 0;
    const calls: number[] = [];
    const th = createThrottle(100, () => t);
    th.run(() => calls.push(1));
    th.run(() => calls.push(2));
    th.run(() => calls.push(3));
    assert.deepEqual(calls, [1]);
    t = 100;
    await new Promise((r) => setTimeout(r, 130));
    assert.deepEqual(calls, [1, 3]);
    th.cancel();
  });
});
