import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { orbitSurfaces, describeSurface, matchOption, fieldTarget, actionTarget } from "./orbitSurfaces.ts";

orbitSurfaces.setCatalog({
  version: 1,
  pages: [{ route: "/connections", title: "Connections" }],
  surfaces: [{
    id: "connections.form", route: "/connections", title: "Connect database form", openable: true,
    fields: [
      { name: "host", label: "Host", type: "text", required: true },
      { name: "password", label: "Password", type: "secret", required: true },
      { name: "ssl_mode", label: "SSL", type: "select" },
    ],
    actions: [{ id: "save", label: "Save", consequential: false }],
  }],
});

describe("Orbit surface registry", () => {
  test("refuses surfaces that are not in the server catalog", () => {
    orbitSurfaces.register("evil.surface", () => ({}));
    assert.equal(orbitSurfaces.get("evil.surface"), null);
  });

  test("never reads secret values back; reports missing required fields by label", () => {
    let host = "";
    const off = orbitSurfaces.register("connections.form", () => ({
      fields: {
        host: { get: () => host, set: (v) => { host = v; } },
        password: { get: () => "hunter2-secret", set: () => "user types it" },
      },
      actions: { save: { run: () => ({ success: true }) } },
    }));
    const d = describeSurface("connections.form");
    assert.ok(!JSON.stringify(d).includes("hunter2-secret"));
    assert.deepEqual(d.fields.find((f: any) => f.name === "password"), { name: "password", label: "Password", type: "secret", required: true, present: true });
    assert.deepEqual(d.missing_required, ["Host"]);
    off();
  });

  test("options are matched by stable id or label, and ambiguity is reported", () => {
    const opts = [{ value: 3, label: "Blog DB" }, { value: 4, label: "Blog DB Staging" }, { value: 5, label: "Shop" }];
    assert.equal(matchOption(opts, "3").match?.value, 3);
    assert.equal(matchOption(opts, "shop").match?.value, 5);
    assert.equal(matchOption(opts, "blog db").match?.value, 3);
    const amb = matchOption(opts, "blog");
    assert.equal(amb.match, undefined);
    assert.equal(amb.candidates.length, 2);
  });

  test("target keys are deterministic", () => {
    assert.equal(fieldTarget("connections.form", "host"), "connections.form.host");
    assert.equal(actionTarget("connections.list", "test", "7"), "connections.list.@test#7");
  });
});
