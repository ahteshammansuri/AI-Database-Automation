/**
 * Executes on-screen tools requested by the server's agent loop, in order and visibly:
 * Orbit flies to the real element, taps or types, the page's own handler runs, and the
 * real result is acknowledged back to the server (which verifies anything it changed).
 */
import { api } from "./api";
import { actionBridge, ActionExecutionStatus } from "./actionBridge";
import { orbitStage, OrbitGesture } from "./orbitStage";
import { orbitTargets } from "./orbitTargets";
import { ttsAdapter } from "./ttsAdapter";
import { actionTarget, catalogField, describeSurface, fieldTarget, matchOption, orbitSurfaces, type SurfaceHandle } from "./orbitSurfaces";

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

/**
 * Fly to a registered element, wait until Orbit has really arrived (its flight animation finished),
 * then make the gesture and let it read before the action happens. Skipped if the element is not on screen.
 */
async function visit(target: string | undefined, gesture: OrbitGesture, waitMs = 1200): Promise<HTMLElement | null> {
  if (!target) return null;
  const el = await orbitTargets.waitFor(target, waitMs);
  if (!el) return null;
  const reduced = prefersReducedMotion();
  const arrived = reduced ? Promise.resolve(null) : orbitStage.waitFor((e) => e.type === "arrived" && e.target === target, 2200);
  orbitStage.emit({ type: "travel", target });
  await arrived;
  await sleep(reduced ? 0 : 140); // settle before acting
  orbitStage.emit({ type: "gesture", gesture, target });
  await sleep(reduced ? 0 : gesture === "tap" ? 260 : 120); // the tap is seen before the click lands
  return el;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/**
 * Navigate the way a person does, in step with Orbit: fly to the sidebar link, tap it, then wait until
 * the new page has rendered its sections before anything else happens on it.
 */
async function ensureRoute(route: string): Promise<boolean> {
  if (window.location.pathname === route) return true;
  await visit(`nav:${route}`, "tap", 600);
  const res = await actionBridge.dispatchAsync("navigation.navigate", { route });
  if (res.status !== "ok") return false;
  for (let i = 0; i < 80 && window.location.pathname !== route; i++) await sleep(50);
  if (window.location.pathname !== route) return false;
  const pageSurfaces = (orbitSurfaces.getCatalog()?.surfaces ?? []).filter((s) => s.route === route).map((s) => s.id);
  if (pageSurfaces.length) {
    await Promise.race([...pageSurfaces.map((id) => orbitSurfaces.waitFor(id, 3000)), sleep(3000)]);
  }
  await nextFrame();
  await nextFrame();
  await sleep(prefersReducedMotion() ? 0 : 250); // let the page settle visually
  return true;
}

/** The visible page title, registered on demand so Orbit can stand beside it on any page. */
function pageHeadingTarget(): string | null {
  const el = document.querySelector<HTMLElement>("main h1, main h2");
  if (!el) return null;
  orbitTargets.register("page.heading", el);
  return "page.heading";
}

/** Where Orbit stands to present a surface: its own element, else the page title. */
function presentTarget(id: string): string | null {
  const h = orbitSurfaces.get(id);
  const target = h?.target ?? h?.openTarget;
  return target && orbitTargets.has(target) ? target : pageHeadingTarget();
}

/** After arriving on a page, Orbit moves to its main area so the user sees where it is working. */
async function arriveOnPage(route: string): Promise<void> {
  const ids = (orbitSurfaces.getCatalog()?.surfaces ?? []).filter((s) => s.route === route).map((s) => s.id);
  const target = ids.map((id) => {
    const h = orbitSurfaces.get(id);
    const t = h?.target ?? h?.openTarget;
    return t && orbitTargets.has(t) ? t : null;
  }).find(Boolean) ?? pageHeadingTarget();
  if (target) await visit(target, "point", 400);
}

/** How long a caption stays before Orbit moves on: time to read it, and to finish speaking. */
async function waitUntilReadAndSpoken(text: string): Promise<void> {
  if (prefersReducedMotion()) return;
  await sleep(Math.min(9000, Math.max(2500, 1500 + text.length * 55)));
  for (let i = 0; i < 60 && ttsAdapter.isSpeaking(); i++) await sleep(250);
}

/**
 * Type a value into a text field the way a person would: the page's own setter receives each
 * growing prefix, so validation, previews and derived fields (like a slug) react as for real typing.
 * Intermediate validation messages are ignored; only the final value's result counts.
 */
async function typeInto(set: (v: any) => any, value: any, kind: string | undefined): Promise<string | null> {
  const text = typeof value === "string" ? value : null;
  const typeable = text !== null && (kind === "text" || kind === "textarea" || kind === undefined);
  if (!typeable || prefersReducedMotion() || text!.length < 2) {
    const err = await set(value);
    return err ? String(err) : null;
  }
  const total = text!.length;
  const steps = Math.min(total, kind === "textarea" ? 28 : 18);
  const budgetMs = Math.min(kind === "textarea" ? 2200 : 1400, 220 + total * 32);
  let err: any = null;
  for (let i = 1; i <= steps; i++) {
    err = await set(text!.slice(0, Math.round((total * i) / steps)));
    await sleep(budgetMs / steps);
  }
  return err ? String(err) : null;
}

/**
 * After the user confirmed a consequential action in Orbit's panel, the page shows its own
 * confirmation popup; Orbit flies to its confirm button and presses it in front of the user.
 * Only runs when the server marked the press as user-confirmed.
 */
async function pressConfirmPopupWhenShown(actionDone: Promise<void>, maxWaitMs = 5000): Promise<boolean> {
  // Actions without a popup finish first; stop waiting as soon as they do.
  const el = await Promise.race([orbitTargets.waitFor("dialog.confirm", maxWaitMs), actionDone.then(() => null)]);
  if (!el) return false;
  await sleep(prefersReducedMotion() ? 0 : 350);
  await visit("dialog.confirm", "tap", 800);
  await sleep(prefersReducedMotion() ? 0 : 450);
  if (orbitTargets.get("dialog.confirm") === el) el.click();
  return true;
}

/**
 * Guided tours (give_tour, explain_page): the steps come from the server, which built them from the page
 * explanations stored in the database and dropped anything that could change data. One tour runs at a time;
 * a new message or Stop ends it at once (speech cut, no further steps).
 */
const tour = { active: false, aborted: false, stopped: Promise.resolve(), stop: () => {} };
let tourVoice = false;

/** Whether tour sentences are spoken aloud (the user's "voice replies" setting). */
export function setGuidedTourVoice(enabled: boolean): void {
  tourVoice = enabled;
}

export function abortGuidedTour(): void {
  if (!tour.active) return;
  tour.aborted = true;
  tour.stop();
  ttsAdapter.stop();
}

function beginTour(): void {
  tour.active = true;
  tour.aborted = false;
  tour.stopped = new Promise<void>((r) => (tour.stop = r));
}

/** Say one sentence calmly: caption beside Orbit, spoken when voice replies are on, then a short pause. */
async function narrate(text: string): Promise<void> {
  if (!text || tour.aborted) return;
  orbitStage.emit({ type: "caption", text });
  const readMs = Math.min(12000, Math.max(2200, 900 + text.length * 50));
  if (tourVoice) {
    const spoken = new Promise<void>((resolve) => {
      void ttsAdapter.speak(text);
      // Subscribed after speak() so the cut-off of any previous sentence is not taken for this one's end.
      const off = ttsAdapter.subscribe((e) => {
        if (e.type === "end" || e.type === "error" || e.type === "cancelled") {
          off();
          resolve();
        }
      });
    });
    await Promise.race([spoken, sleep(readMs + 6000), tour.stopped]);
  } else if (!prefersReducedMotion()) {
    await Promise.race([sleep(readMs), tour.stopped]);
  }
  if (!tour.aborted) await sleep(prefersReducedMotion() ? 0 : 350);
}

/** The id of the first row a list surface shows, for steps such as "open the first draft". */
function firstRowId(h: { describe?(): any }): string | undefined {
  const list = h.describe?.();
  const rows = Array.isArray(list) ? list : Array.isArray(list?.rows) ? list.rows : [];
  const id = rows[0]?.id;
  return id !== undefined && id !== null ? String(id) : undefined;
}

/** Close the popup on top with its own Close button, visibly. (Not Escape: that key stops Orbit's task.) */
async function closePopup(): Promise<boolean> {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] [aria-label="Close"], main [aria-label="Close"]'))
    .filter((el) => el.getClientRects().length > 0);
  const btn = buttons[buttons.length - 1];
  if (!btn) return false;
  orbitTargets.register("popup.close", btn);
  await visit("popup.close", "tap", 600);
  btn.click();
  orbitTargets.unregister("popup.close", btn);
  await sleep(prefersReducedMotion() ? 0 : 450);
  return true;
}

type TourStep = { do: string; surface?: string; field?: string; action?: string; row?: string; say?: string };

/** One step of a detailed page explanation. Returns whether it was shown; a step whose part is not on screen is skipped. */
async function tourStep(step: TourStep): Promise<{ shown: boolean; popup?: boolean }> {
  const say = String(step.say || "");
  if (step.do === "say") {
    await narrate(say);
    return { shown: true };
  }
  if (step.do === "close_popup") {
    await narrate(say);
    return { shown: await closePopup(), popup: false };
  }
  const id = String(step.surface || "");
  const h = orbitSurfaces.get(id) ?? (await orbitSurfaces.waitFor(id, 1500));
  if (!h) return { shown: false };

  if (step.do === "open") {
    if (h.isOpen && !h.isOpen()) {
      await visit(h.openTarget, "tap");
      await h.open?.();
      for (let i = 0; i < 40 && !orbitSurfaces.get(id)?.isOpen?.(); i++) await sleep(50);
      await sleep(250);
    }
    await visit(presentTarget(id) ?? undefined, "point", 600);
    await narrate(say);
    return { shown: true, popup: true };
  }

  if (step.do === "press") {
    const a = step.action ? h.actions?.[step.action] : undefined;
    if (!a) return { shown: false };
    const row = step.row === "first" ? firstRowId(h) : undefined;
    if (step.row && !row) return { shown: false }; // the list is empty: nothing to open
    const target = a.target?.(row) ?? actionTarget(id, step.action!, row);
    if (a.enabled && !a.enabled(row)) {
      // Explain the button without pressing it (for example no table chosen, or the connection is view only).
      await visit(target, "point", 800);
      await narrate(say);
      return { shown: true };
    }
    await visit(target, "point", 800);
    await narrate(say); // say what will happen, then press
    if (tour.aborted) return { shown: false };
    await visit(target, "tap", 400);
    const out = await a.run(row);
    await sleep(prefersReducedMotion() ? 0 : 600); // let the window open before the next sentence
    return { shown: out.success !== false, popup: out.success !== false && step.action !== "cancel" };
  }

  // point: a field, a button, or the whole part of the page
  const target = step.field
    ? (h.fields?.[step.field]?.target?.() ?? fieldTarget(id, step.field))
    : step.action
      ? (h.actions?.[step.action]?.target?.() ?? actionTarget(id, step.action))
      : presentTarget(id);
  const reached = await visit(target ?? undefined, "point", 1200);
  if (!reached) await visit(presentTarget(id) ?? undefined, "point", 400);
  await narrate(say);
  return { shown: true };
}

const ok = (result: Record<string, any>): Outcome => ({ status: "ok", result });
const fail = (status: ActionExecutionStatus, message: string, extra: Record<string, any> = {}): Outcome => ({
  status,
  result: { success: false, message, ...extra },
});

async function mountedSurface(id: string) {
  const cat = orbitSurfaces.catalogSurface(id);
  const h = orbitSurfaces.get(id) ?? (await orbitSurfaces.waitFor(id, 1500));
  return { cat, h: h ? await settled(id, h) : h };
}

/**
 * The surface's live handle once it has finished loading what its fields depend on (`busy`), e.g. the tables of a
 * newly chosen connection. Re-read before every step: a handle read before the previous step changed the page
 * would act on that page's old state.
 */
async function settled(id: string, fallback: SurfaceHandle, timeoutMs = 10000): Promise<SurfaceHandle> {
  const until = Date.now() + timeoutMs;
  let h = orbitSurfaces.get(id) ?? fallback;
  while (h.busy?.() && Date.now() < until) {
    await sleep(100);
    h = orbitSurfaces.get(id) ?? h;
  }
  return h;
}

async function perform(evt: UiActionEvent): Promise<Outcome> {
  await orbitSurfaces.loadCatalog();
  const p = evt.payload || {};
  const row = p.row !== undefined && p.row !== null && p.row !== "" ? String(p.row) : undefined;

  switch (evt.action) {
    case "surface.go_to_page": {
      const title = orbitSurfaces.getCatalog()?.pages.find((pg) => pg.route === p.page)?.title ?? p.page;
      const already = window.location.pathname === p.page;
      if (!(await ensureRoute(p.page))) return fail("error", `Could not open ${title} (${p.page}).`);
      if (!already) await arriveOnPage(p.page);
      return ok({ success: true, message: already ? `Already on ${title}.` : `Opened ${title}.`, page: p.page, surfaces_on_screen: orbitSurfaces.mounted() });
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
      // In the form's own order (as a person fills it), so a field that decides another's options (connection, then
      // table) is applied first, whatever order the values came in.
      const order = (name: string) => {
        const i = cat.fields.findIndex((f) => f.name === name || (f.dynamic && name.startsWith(f.name.split(".")[0] + ".")));
        return i < 0 ? cat.fields.length : i;
      };
      const entries = Object.entries(p.values || {}).sort(([a], [b]) => order(a) - order(b));
      for (const [name, value] of entries) {
        const meta = catalogField(cat, name);
        const live = await settled(p.surface, h);
        const f = live.fields?.[name] ?? (meta?.dynamic ? live.fields?.[meta.name.split(".")[0] + ".*"] : undefined);
        if (!f || !meta || meta.type === "secret" || meta.type === "file") {
          results[name] = { error: "not fillable here" };
          errors++;
          continue;
        }
        const rowOrName = meta.dynamic ? name : row;
        await visit(f.target?.(rowOrName) ?? fieldTarget(p.surface, name, row), "type", 800);
        let err = await typeInto((v) => f.set(v, rowOrName), value, meta.type);
        if (err && f.options && (meta.type === "select" || meta.type === "searchable_select" || meta.dynamic)) {
          // A dropdown given a visible label instead of its value: pick the matching real option.
          const { match } = matchOption(await f.options(rowOrName), String(value));
          if (match) err = (await f.set(match.value, rowOrName)) ?? null;
        }
        if (err) {
          results[name] = { error: String(err) };
          errors++;
        } else {
          results[name] = { ok: true };
        }
        await sleep(120);
      }
      await sleep(150);
      await settled(p.surface, h); // report the page as it is once the last change has loaded
      const after = describeSurface(p.surface);
      const filled = Object.keys(results).filter((k) => results[k].ok);
      const rejected = Object.entries(results).filter(([, r]) => r.error).map(([k, r]) => `${k} (${r.error})`);
      const message = [filled.length ? `Filled ${filled.join(", ")}.` : "", rejected.length ? `Not accepted: ${rejected.join("; ")}.` : ""].filter(Boolean).join(" ");
      return {
        // Partly filled is progress: the accepted fields stay filled and the result says which were not.
        status: filled.length ? "ok" : "validation_error",
        result: { success: filled.length > 0, message, results, not_accepted: rejected, missing_required: after.missing_required, fields: after.fields },
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
      let actionFinished!: () => void;
      const actionDone = new Promise<void>((r) => (actionFinished = r));
      const confirmClick = p.user_confirmed === true ? pressConfirmPopupWhenShown(actionDone) : null;
      let outcome: Awaited<ReturnType<typeof a.run>>;
      try {
        outcome = await a.run(row);
      } finally {
        actionFinished();
      }
      const popupConfirmed = confirmClick ? await confirmClick : false;
      return {
        status: outcome.success ? "ok" : "error",
        result: { ...outcome, ...(popupConfirmed ? { confirmed_in_popup: true } : {}) },
      };
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
        : presentTarget(p.surface);
      const reached = await visit(el ?? undefined, "point");
      if (!reached) await visit(presentTarget(p.surface) ?? undefined, "point", 400); // element not on screen: present from the page title
      const caption = String(p.caption || "").slice(0, 160);
      orbitStage.emit({ type: "caption", text: caption });
      await waitUntilReadAndSpoken(caption); // never rush on to the next page
      return ok({ success: true, message: caption ? `Showed ${cat.title}: ${caption.slice(0, 90)}` : `Pointed at ${cat.title}.` });
    }

    case "surface.give_tour": {
      const pages: { route: string; title: string; say: string }[] = Array.isArray(p.pages) ? p.pages : [];
      const shown: string[] = [];
      beginTour();
      try {
        for (const pg of pages) {
          if (tour.aborted) break;
          if (!(await ensureRoute(pg.route))) continue;
          await arriveOnPage(pg.route);
          await narrate(pg.say);
          if (!tour.aborted) shown.push(pg.title);
        }
      } finally {
        tour.active = false;
      }
      if (tour.aborted) {
        return fail("error", `The user stopped the tour after ${shown.length} of ${pages.length} pages.`, { stopped_by_user: true, pages_shown: shown });
      }
      return {
        status: shown.length ? "ok" : "error",
        result: { success: shown.length > 0, message: `Showed ${shown.length} of ${pages.length} pages: ${shown.join(", ")}.`, pages_shown: shown },
      };
    }

    case "surface.explain_page": {
      const title = String(p.title || p.route || "this page");
      const steps: TourStep[] = p.depth === "detailed" && Array.isArray(p.steps) ? p.steps : [];
      let shown = 0;
      const skipped: string[] = [];
      let popupOpen = false;
      beginTour();
      try {
        if (!(await ensureRoute(String(p.route || "")))) return fail("error", `Could not open ${title}.`);
        await arriveOnPage(p.route);
        await narrate(String(p.overview || ""));
        for (const step of steps) {
          if (tour.aborted) break;
          const r = await tourStep(step);
          if (r.popup !== undefined) popupOpen = r.popup;
          if (r.shown) shown++;
          else skipped.push([step.surface, step.field ?? step.action].filter(Boolean).join(" › ") || step.do);
        }
        if (popupOpen && !tour.aborted) await closePopup(); // never leave a window the tour opened
      } finally {
        tour.active = false;
      }
      if (tour.aborted) {
        return fail("error", `The user stopped the explanation of ${title} after ${shown} of ${steps.length} steps.`, { stopped_by_user: true });
      }
      const detail = steps.length
        ? ` Showed ${shown} of ${steps.length} parts${skipped.length ? `; not on screen right now: ${skipped.slice(0, 8).join(", ")}` : ""}.`
        : "";
      return ok({ success: true, message: `Explained ${title}.${detail}`, depth: steps.length ? "detailed" : "overview", steps_shown: shown, not_on_screen: skipped });
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
