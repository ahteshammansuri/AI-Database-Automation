/**
 * Orbit surface registry: the generic layer that lets Orbit operate any catalogued page
 * like a person (open forms, type into fields, pick options, press buttons).
 *
 * The server owns the catalog (GET /api/agent/surfaces): which surfaces, fields and actions
 * exist and which actions are consequential. Pages register *handlers* for catalogued
 * surfaces, bound to their own React state and their own existing click handlers.
 * Registrations that are not in the catalog are refused.
 */

export type FieldType = "text" | "number" | "select" | "searchable_select" | "toggle" | "textarea" | "secret" | "file";

export interface CatalogField { name: string; label: string; type: FieldType; required?: boolean; enum?: string[]; row?: boolean; dynamic?: boolean }

/** Catalog field for a name, including dynamic ones like "col.*" (col.title, col.category_id...). */
export function catalogField(cat: CatalogSurface | undefined, name: string): CatalogField | undefined {
  if (!cat) return undefined;
  const exact = cat.fields.find((f) => f.name === name);
  if (exact) return exact;
  const dyn = cat.fields.find((f) => f.dynamic && f.name.endsWith(".*") && name.startsWith(f.name.slice(0, -1)));
  return dyn ? { ...dyn, name } : undefined;
}
export interface CatalogAction { id: string; label: string; row?: boolean; consequential?: boolean; destructive?: boolean; timeout_s?: number; verifies?: string }
export interface CatalogSurface {
  id: string; route: string; title: string; purpose?: string; openable?: boolean;
  fields: CatalogField[]; actions: CatalogAction[];
}
export interface Catalog { version: number; pages: { route: string; title: string }[]; surfaces: CatalogSurface[] }

export interface Option { value: string | number; label: string }

export interface FieldHandle {
  get(row?: string): any;
  /** Apply a value through the page's controlled state. Return an error message to reject it. */
  set(value: any, row?: string): string | null | void | Promise<string | null | void>;
  options?(row?: string): Option[] | Promise<Option[]>;
  target?(row?: string): string | undefined;
}

export interface ActionOutcome {
  success: boolean;
  message?: string;
  /** What this action created/changed, re-checked on the server (ownership + existence). */
  resource?: { type: string; id: number | string };
  data?: any;
}

export interface ActionHandle {
  run(row?: string): ActionOutcome | Promise<ActionOutcome>;
  target?(row?: string): string | undefined;
  enabled?(row?: string): boolean;
}

export interface SurfaceHandle {
  /** For modal/collapsible surfaces: is it open right now? */
  isOpen?(): boolean;
  /** Open it the way a user would (e.g. the "Connect Database" button). */
  open?(): void | Promise<void>;
  openTarget?: string;
  /** Element representing the whole surface (for show_me). */
  target?: string;
  fields?: Record<string, FieldHandle>;
  actions?: Record<string, ActionHandle>;
  /** Visible list summary (rows with their ids and key facts). */
  describe?(): any;
}

/** Default semantic target keys, so pages and the runtime agree without extra wiring. */
export const fieldTarget = (surface: string, field: string, row?: string) => `${surface}.${field}${row ? `#${row}` : ""}`;
export const actionTarget = (surface: string, action: string, row?: string) => `${surface}.@${action}${row ? `#${row}` : ""}`;

type Getter = () => SurfaceHandle;
type Listener = () => void;

class OrbitSurfaceRegistry {
  private getters = new Map<string, Getter>();
  private listeners = new Set<Listener>();
  private catalog: Catalog | null = null;
  private catalogPromise: Promise<Catalog | null> | null = null;
  private loader: (() => Promise<Catalog>) | null = null;

  /** Provide how to fetch the catalog (kept injectable for tests). */
  setLoader(loader: () => Promise<Catalog>): void {
    this.loader = loader;
  }

  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    // Drop any registration that turned out not to be catalogued.
    for (const id of Array.from(this.getters.keys())) {
      if (!this.catalogSurface(id)) {
        console.warn(`[Orbit] surface '${id}' is not in the catalog; ignoring it.`);
        this.getters.delete(id);
      }
    }
    this.notify();
  }

  async loadCatalog(): Promise<Catalog | null> {
    if (this.catalog) return this.catalog;
    if (!this.catalogPromise && this.loader) {
      this.catalogPromise = this.loader()
        .then((c) => {
          this.setCatalog(c);
          return c;
        })
        .catch(() => {
          this.catalogPromise = null;
          return null;
        });
    }
    return this.catalogPromise ?? null;
  }

  catalogSurface(id: string): CatalogSurface | undefined {
    return this.catalog?.surfaces.find((s) => s.id === id);
  }

  getCatalog(): Catalog | null {
    return this.catalog;
  }

  register(id: string, getter: Getter): () => void {
    if (this.catalog && !this.catalogSurface(id)) {
      console.warn(`[Orbit] refusing to register uncatalogued surface '${id}'.`);
      return () => {};
    }
    this.getters.set(id, getter);
    this.notify();
    return () => {
      if (this.getters.get(id) === getter) {
        this.getters.delete(id);
        this.notify();
      }
    };
  }

  get(id: string): SurfaceHandle | null {
    const g = this.getters.get(id);
    return g ? g() : null;
  }

  mounted(): string[] {
    return Array.from(this.getters.keys());
  }

  waitFor(id: string, timeoutMs = 3000): Promise<SurfaceHandle | null> {
    const now = this.get(id);
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        resolve(null);
      }, timeoutMs);
      const check = () => {
        const h = this.get(id);
        if (h) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve(h);
        }
      };
      this.listeners.add(check);
    });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const orbitSurfaces = new OrbitSurfaceRegistry();

const isEmpty = (v: any) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * What Orbit (and the model) sees about a surface: fields with non-secret values, which
 * required fields are still missing, available actions, and the visible list.
 * Secret fields are never read back: only whether something has been typed.
 */
export function describeSurface(id: string): any {
  const cat = orbitSurfaces.catalogSurface(id);
  const h = orbitSurfaces.get(id);
  if (!cat || !h) return { surface: id, on_screen: false };

  const fields = cat.fields
    .filter((f) => !f.row && !f.dynamic && h.fields?.[f.name])
    .map((f) => {
      const raw = h.fields![f.name].get();
      if (f.type === "secret") return { name: f.name, label: f.label, type: f.type, required: !!f.required, present: !isEmpty(raw) };
      if (f.type === "file") return { name: f.name, label: f.label, type: f.type, chosen: !isEmpty(raw) ? String(raw).slice(0, 120) : null };
      const value = typeof raw === "string" ? raw.slice(0, 200) : raw;
      return { name: f.name, label: f.label, type: f.type, required: !!f.required, value: value ?? null };
    });
  const missing = cat.fields
    .filter((f) => f.required && !f.row && h.fields?.[f.name])
    .filter((f) => isEmpty(h.fields![f.name].get()))
    .map((f) => f.label);

  return {
    surface: id,
    title: cat.title,
    on_screen: true,
    open: h.isOpen ? h.isOpen() : true,
    fields,
    missing_required: missing,
    actions: cat.actions.map((a) => ({
      id: a.id,
      label: a.label,
      row: !!a.row,
      consequential: !!a.consequential,
      enabled: a.row ? undefined : (h.actions?.[a.id]?.enabled?.() ?? !!h.actions?.[a.id]),
    })),
    list: h.describe ? h.describe() : undefined,
  };
}

/** Resolve a user's choice against the real loaded options: exact id, exact label, then partial label. */
export function matchOption(options: Option[], choice: string): { match?: Option; candidates: Option[] } {
  const c = String(choice).trim().toLowerCase();
  const byId = options.find((o) => String(o.value).toLowerCase() === c);
  if (byId) return { match: byId, candidates: [] };
  const exact = options.filter((o) => o.label.trim().toLowerCase() === c);
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  const partial = options.filter((o) => o.label.toLowerCase().includes(c) || c.includes(o.label.toLowerCase()));
  if (partial.length === 1) return { match: partial[0], candidates: [] };
  return { candidates: (exact.length ? exact : partial).slice(0, 12) };
}
