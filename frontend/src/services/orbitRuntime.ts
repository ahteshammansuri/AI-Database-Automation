/**
 * Executes on-screen tools requested by the server's agent loop, in order and visibly:
 * Orbit flies to the real element, taps or types, the page's own handler runs, and the
 * real result is acknowledged back to the server (which verifies anything it changed).
 */
import { api } from "./api";
import { actionBridge, ActionExecutionStatus } from "./actionBridge";
import { orbitStage, OrbitGesture } from "./orbitStage";
import { orbitTargets } from "./orbitTargets";
import { actionTarget, catalogField, describeSurface, fieldTarget, matchOption, orbitSurfaces } from "./orbitSurfaces";

export interface UiActionEvent {
  task_id: number;
  correlation_id: string;
  action: string;
  payload: any;
}

interface Outcome {
  status: ActionExecutionStatus;
  result: Record<string, any>;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fly to a registered element and make a gesture; skipped silently if it is not on screen. */
async function visit(target: string | undefined, gesture: OrbitGesture, waitMs = 1200): Promise<HTMLElement | null> {
  if (!target) return null;
  const el = await orbitTargets.waitFor(target, waitMs);
  if (!el) return null;
  orbitStage.emit({ type: "travel", target });
  await sleep(prefersReducedMotion() ? 0 : 520);
  orbitStage.emit({ type: "gesture", gesture, target });
  return el;
}

async function ensureRoute(route: string): Promise<boolean> {
  if (window.location.pathname === route) return true;
  await visit(`nav:${route}`, "tap", 600);
  const res = await actionBridge.dispatchAsync("navigation.navigate", { route });
  if (res.status !== "ok") return false;
  for (let i = 0; i < 60 && window.location.pathname !== route; i++) await sleep(50);
  return window.location.pathname === route;
}

const ok = (result: Record<string, any>): Outcome => ({ status: "ok", result });
const fail = (status: ActionExecutionStatus, message: string, extra: Record<string, any> = {}): Outcome => ({
  status,
  result: { success: false, message, ...extra },
});

async function mountedSurface(id: string) {
  const cat = orbitSurfaces.catalogSurface(id);
  const h = orbitSurfaces.get(id) ?? (await orbitSurfaces.waitFor(id, 1500));
  return { cat, h };
}

async function perform(evt: UiActionEvent): Promise<Outcome> {
  await orbitSurfaces.loadCatalog();
  const p = evt.payload || {};
  const row = p.row !== undefined && p.row !== null && p.row !== "" ? String(p.row) : undefined;

  switch (evt.action) {
    case "surface.go_to_page": {
      if (!(await ensureRoute(p.page))) return fail("error", `Could not open ${p.page}.`);
      await sleep(400);
      return ok({ success: true, page: p.page, surfaces_on_screen: orbitSurfaces.mounted() });
    }

    case "surface.open_form": {
      const cat = orbitSurfaces.catalogSurface(p.surface);
      if (!cat) return fail("error", "Unknown surface.");
      if (!(await ensureRoute(cat.route))) return fail("error", `Could not open ${cat.route}.`);
      const h = await orbitSurfaces.waitFor(p.surface, 3000);
      if (!h) return fail("not_mounted", `${cat.title} is not available on this page.`);
      if (h.isOpen && !h.isOpen()) {
        await visit(h.openTarget, "tap");
        await h.open?.();
        for (let i = 0; i < 40 && !orbitSurfaces.get(p.surface)?.isOpen?.(); i++) await sleep(50);
        await sleep(250);
      }
      return ok({ success: true, message: `${cat.title} is open.`, ...describeSurface(p.surface) });
    }

    case "surface.read_screen": {
      return ok({ success: true, page: window.location.pathname, surfaces: orbitSurfaces.mounted().map(describeSurface) });
    }

    case "surface.fill_fields": {
      const { cat, h } = await mountedSurface(p.surface);
      if (!cat || !h) return fail("not_mounted", "That form is not on screen. Use go_to_page or open_form first.");
      if (h.isOpen && !h.isOpen()) return fail("not_mounted", "That form is closed. Use open_form first.");
      const results: Record<string, any> = {};
      let errors = 0;
      for (const [name, value] of Object.entries(p.values || {})) {
        const meta = catalogField(cat, name);
        const f = h.fields?.[name] ?? (meta?.dynamic ? h.fields?.[meta.name.split(".")[0] + ".*"] : undefined);
        if (!f || !meta || meta.type === "secret" || meta.type === "file") {
          results[name] = { error: "not fillable here" };
          errors++;
          continue;
        }
        const rowOrName = meta.dynamic ? name : row;
        await visit(f.target?.(rowOrName) ?? fieldTarget(p.surface, name, row), "type", 800);
        const err = await f.set(value, rowOrName);
        if (err) {
          results[name] = { error: String(err) };
          errors++;
        } else {
          results[name] = { ok: true };
        }
        await sleep(120);
      }
      await sleep(150);
      const after = describeSurface(p.surface);
      return {
        status: errors ? "validation_error" : "ok",
        result: { success: errors === 0, message: errors ? "Some fields were not accepted." : "Fields filled.", results, missing_required: after.missing_required, fields: after.fields },
      };
    }

    case "surface.choose_option": {
      const { cat, h } = await mountedSurface(p.surface);
      const meta = catalogField(cat, p.field);
      const f = h?.fields?.[p.field] ?? (meta?.dynamic ? h?.fields?.[meta.name.split(".")[0] + ".*"] : undefined);
      const key = meta?.dynamic ? p.field : row;
      if (!cat || !h || !f?.options) return fail("not_mounted", "That dropdown is not on screen.");
      await visit(f.target?.(key) ?? fieldTarget(p.surface, p.field, row), "tap", 800);
      let options = await f.options(key);
      for (let i = 0; i < 20 && options.length === 0; i++) {
        await sleep(100);
        options = await f.options(key);
      }
      const { match, candidates } = matchOption(options, p.choice);
      if (!match) {
        return fail("validation_error", candidates.length ? "More than one option matches; ask which one." : "No option matches.",
          { candidates: (candidates.length ? candidates : options.slice(0, 15)) });
      }
      const err = await f.set(match.value, key);
      if (err) return fail("validation_error", String(err));
      await sleep(150);
      return ok({ success: true, message: `Selected "${match.label}".`, chosen: match });
    }

    case "surface.press": {
      const { cat, h } = await mountedSurface(p.surface);
      const a = h?.actions?.[p.action];
      if (!cat || !h || !a) return fail("not_mounted", "That button is not on screen. Use go_to_page or open_form first.");
      if (a.enabled && !a.enabled(row)) return fail("error", "That button is disabled right now (check required fields).", describeSurface(p.surface));
      await visit(a.target?.(row) ?? actionTarget(p.surface, p.action, row), "tap");
      const outcome = await a.run(row);
      return { status: outcome.success ? "ok" : "error", result: { ...outcome } };
    }

    case "surface.ask_secret_in_form": {
      const { cat, h } = await mountedSurface(p.surface);
      const meta = cat?.fields.find((x) => x.name === p.field);
      if (!cat || !h || !meta) return fail("not_mounted", "That form is not on screen.");
      const target = h.fields?.[p.field]?.target?.() ?? fieldTarget(p.surface, p.field);
      const el = await visit(target, "point");
      if (!el) return fail("not_mounted", `The ${meta.label} field is not visible.`);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement).focus?.({ preventScroll: true });
      orbitStage.emit({ type: "secret_wait", target, taskId: evt.task_id, surface: p.surface, field: p.field, label: meta.label });
      return ok({ success: true, message: `Waiting for the user to type the ${meta.label} in the form.` });
    }

    case "surface.show_me": {
      const { cat, h } = await mountedSurface(p.surface);
      if (!cat || !h) return fail("not_mounted", "That part of the portal is not on screen. Use go_to_page first.");
      const el = p.element
        ? (h.fields?.[p.element] ? (h.fields[p.element].target?.() ?? fieldTarget(p.surface, p.element)) : (h.actions?.[p.element]?.target?.() ?? actionTarget(p.surface, p.element)))
        : (h.target ?? h.openTarget);
      await visit(el, "point");
      orbitStage.emit({ type: "caption", text: String(p.caption || "").slice(0, 160) });
      return ok({ success: true, message: "Shown to the user." });
    }
  }
  return fail("error", `Unsupported UI action ${evt.action}.`);
}

let chain: Promise<void> = Promise.resolve();
const seen = new Set<string>();

/** Queue a server-requested UI action; each runs after the previous one is acknowledged. */
export function runUiAction(evt: UiActionEvent): Promise<void> {
  if (!evt?.correlation_id || seen.has(evt.correlation_id)) return chain;
  seen.add(evt.correlation_id);
  chain = chain.then(async () => {
    let out: Outcome;
    try {
      out = await perform(evt);
    } catch (e: any) {
      out = fail("error", e?.message || "UI action failed");
    }
    try {
      await api.ackAgentUiAction(evt.correlation_id, out.status, out.result);
    } catch {
      // The server times out unacknowledged actions and reports it.
    }
  });
  return chain;
}
