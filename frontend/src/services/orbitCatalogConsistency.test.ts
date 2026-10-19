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
/** Source text of each surface registration (up to the next registration in the same file). */
const registrationText = new Map<string, string>();
for (const file of sources(join(root, "src"))) {
  const text = readFileSync(file, "utf8");
  const matches = [...text.matchAll(/useOrbitSurface\("([^"]+)"/g)];
  matches.forEach((m, i) => {
    registered.add(m[1]);
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    registrationText.set(m[1], (registrationText.get(m[1]) ?? "") + text.slice(m.index, end));
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An object key (`name:` / `"name":`) or a quoted name in a generated list (`["name", "host"].map(...)`). */
const implementsKey = (text: string, key: string) =>
  new RegExp(`(^|[\\s{,])(${escape(key)}|"${escape(key)}")\\s*:`, "m").test(text) || text.includes(`"${key}"`);

describe("Orbit surface catalog consistency", () => {
  test("every page registration is in the server catalog", () => {
    const unknown = [...registered].filter((id) => !catalogIds.has(id));
    assert.deepEqual(unknown, []);
  });

  test("every catalogued field and button is implemented by the page that registers the surface", () => {
    const missing: string[] = [];
    for (const surface of catalog.surfaces) {
      const text = registrationText.get(surface.id) ?? "";
      for (const f of surface.fields ?? []) if (!implementsKey(text, f.name)) missing.push(`${surface.id} field ${f.name}`);
      for (const a of surface.actions ?? []) if (!implementsKey(text, a.id)) missing.push(`${surface.id} action ${a.id}`);
    }
    assert.deepEqual(missing, []);
  });

  test("every catalogued page is a real route of the app (Orbit can navigate to all of them)", () => {
    const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
    const routes = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => "/" + m[1].replace(/^\//, "")));
    const missing = catalog.pages.map((p: any) => p.route).filter((r: string) => !routes.has(r));
    assert.deepEqual(missing, []);
    assert.ok(!/ORBIT_ROUTES\s*=\s*new Set\(\[/.test(app), "no second, hand-kept route list");
  });

  test("every catalogued surface is implemented by a page", () => {
    const missing = [...catalogIds].filter((id) => !registered.has(id));
    assert.deepEqual(missing, []);
  });
});
