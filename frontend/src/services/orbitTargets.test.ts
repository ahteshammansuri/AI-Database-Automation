import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { orbitTargets } from "./orbitTargets.ts";

const fakeEl = (connected = true) => {
  const attrs: Record<string, string> = {};
  return {
    isConnected: connected,
    setAttribute: (k: string, v: string) => (attrs[k] = v),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }),
    attrs,
  } as any;
};

describe("Semantic Orbit targets", () => {
  test("registers by stable key, tags the element, and unregisters", () => {
    const el = fakeEl();
    orbitTargets.register("connections.add", el);
    assert.equal(orbitTargets.get("connections.add"), el);
    assert.equal(el.attrs["data-orbit-target"], "connections.add");
    orbitTargets.unregister("connections.add", el);
    assert.equal(orbitTargets.get("connections.add"), null);
  });

  test("detached elements are never returned as targets", () => {
    orbitTargets.register("connections.save", fakeEl(false));
    assert.equal(orbitTargets.get("connections.save"), null);
  });

  test("waitFor resolves when the target mounts and null when it never does", async () => {
    setTimeout(() => orbitTargets.register("connections.form", fakeEl()), 20);
    assert.ok(await orbitTargets.waitFor("connections.form", 300));
    assert.equal(await orbitTargets.waitFor("never.there", 30), null);
  });

});
