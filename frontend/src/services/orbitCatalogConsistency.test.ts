import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const catalog = JSON.parse(readFileSync(join(root, "..", "laravel", "resources", "orbit", "surfaces.json"), "utf8"));
const catalogIds = new Set<string>(catalog.surfaces.map((s: any) => s.id));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []);
}

const registered = new Set<string>();
for (const file of sources(join(root, "src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/useOrbitSurface\("([^"]+)"/g)) registered.add(m[1]);
}

describe("Orbit surface catalog consistency", () => {
  test("every page registration is in the server catalog", () => {
    const unknown = [...registered].filter((id) => !catalogIds.has(id));
    assert.deepEqual(unknown, []);
  });

  test("every catalogued surface is implemented by a page", () => {
    const missing = [...catalogIds].filter((id) => !registered.has(id));
    assert.deepEqual(missing, []);
  });
});
