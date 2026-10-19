/**
 * Field-plan types and the rules that turn a column + mapping into choices and plain-English
 * explanations. The server (FieldPlanBuilder) validates everything again on save and preview.
 */

export type MappingType =
  | "AI_GENERATED"
  | "FIXED_VALUE"
  | "RELATIONAL_LOOKUP"
  | "DERIVED_SLUG"
  | "RUNTIME_NOW"
  | "LEAVE_EMPTY"
  | "DB_DEFAULT";

export interface Mapping {
  field_name: string;
  mapping_type: MappingType;
  fixed_value?: any;
  source_field?: string | null;
  relation_config?: { referenced_table: string; referenced_column?: string; creation_policy: "CREATE_IF_MISSING" | "REUSE_EXISTING_ONLY" };
  instructions?: string;
}

export interface RelationInfo {
  table: string;
  column: string;
  label_column: string | null;
  entity: string;
  existing_count: number;
  options: string[];
  can_create: boolean;
  create_blocked_reason: string | null;
  protected: boolean;
  parent_required_columns: string[];
}

export interface PlanColumn {
  name: string;
  type: string;
  data_type: string;
  kind: string;
  nullable: boolean;
  required: boolean;
  has_default: boolean;
  default: string | null;
  max_length: number | null;
  enum_values: string[];
  is_unique: boolean;
  is_secret: boolean;
  relation: RelationInfo | null;
  suggested: Mapping;
}

export interface FieldPlan {
  table: string;
  primary_key: string | null;
  title_column: string | null;
  columns: PlanColumn[];
  image_provider?: { provider: string; model: string | null; reason: string };
}

/** UI-level choice; several map to the same mapping_type with different relation policies. */
export type Mode = "AI" | "AI_CREATE" | "AI_REUSE" | "FIXED" | "FIXED_REL" | "SLUG" | "NOW" | "EMPTY" | "DEFAULT";

const TEXT_KINDS = ["title", "summary", "body", "meta_title", "meta_description", "keywords", "text"];

export function modeOf(m: Mapping | undefined, col: PlanColumn): Mode {
  if (!m) return col.has_default ? "DEFAULT" : col.nullable ? "EMPTY" : "FIXED";
  switch (m.mapping_type) {
    case "AI_GENERATED":
      if (col.relation) return m.relation_config?.creation_policy === "REUSE_EXISTING_ONLY" || !col.relation.can_create ? "AI_REUSE" : "AI_CREATE";
      if (col.kind === "slug") return "SLUG";
      return "AI";
    case "RELATIONAL_LOOKUP":
      return "FIXED_REL";
    case "FIXED_VALUE":
      return col.relation ? "FIXED_REL" : "FIXED";
    case "DERIVED_SLUG":
      return "SLUG";
    case "RUNTIME_NOW":
      return "NOW";
    case "LEAVE_EMPTY":
      return "EMPTY";
    default:
      return "DEFAULT";
  }
}

export function modeOptions(col: PlanColumn): { value: Mode; label: string }[] {
  const out: { value: Mode; label: string }[] = [];
  const add = (value: Mode, label: string) => out.push({ value, label });
  if (col.is_secret) return out;
  const r = col.relation;
  if (r) {
    if (!r.protected && r.label_column) {
      if (r.can_create) add("AI_CREATE", `AI picks a ${r.entity} (creates it if new)`);
      if (r.existing_count > 0) add("AI_REUSE", `AI picks one of the existing ${r.entity}s`);
    }
    add("FIXED_REL", `Always use one ${r.entity}`);
    if (col.nullable) add("EMPTY", "Leave empty");
    return out;
  }
  switch (col.kind) {
    case "image":
      add("AI", "Generate an image");
      add("FIXED", "Use a fixed image URL");
      break;
    case "slug":
      add("SLUG", "Build it from the title");
      add("FIXED", "Fixed value");
      break;
    case "datetime":
      add("NOW", "Publication time");
      add("FIXED", "Fixed date and time");
      break;
    case "enum":
      add("FIXED", "Fixed value");
      add("AI", "AI chooses");
      break;
    case "boolean":
      add("FIXED", "Fixed value");
      break;
    case "number":
      add("FIXED", "Fixed number");
      add("AI", "AI writes it");
      break;
    case "url":
    case "contact":
    case "json":
      add("FIXED", "Fixed value");
      break;
    default:
      add("AI", "AI writes it");
      add("FIXED", "Fixed text");
  }
  if (col.nullable) add("EMPTY", "Leave empty");
  if (col.has_default) add("DEFAULT", `Database default${col.default !== null ? ` (${col.default})` : ""}`);
  return out;
}

export function mappingFor(mode: Mode, col: PlanColumn, prev: Mapping | undefined, titleColumn: string | null): Mapping {
  const base: Mapping = { field_name: col.name, mapping_type: "FIXED_VALUE" };
  const rel = col.relation
    ? { referenced_table: col.relation.table, referenced_column: col.relation.column }
    : undefined;
  switch (mode) {
    case "AI":
      return { ...base, mapping_type: "AI_GENERATED", instructions: prev?.instructions };
    case "AI_CREATE":
      return { ...base, mapping_type: "AI_GENERATED", relation_config: { ...rel!, creation_policy: "CREATE_IF_MISSING" } };
    case "AI_REUSE":
      return { ...base, mapping_type: "AI_GENERATED", relation_config: { ...rel!, creation_policy: "REUSE_EXISTING_ONLY" } };
    case "FIXED_REL":
      return { ...base, mapping_type: "RELATIONAL_LOOKUP", fixed_value: prev?.mapping_type === "RELATIONAL_LOOKUP" ? prev.fixed_value : null, relation_config: { ...rel!, creation_policy: "REUSE_EXISTING_ONLY" } };
    case "SLUG":
      return { ...base, mapping_type: "DERIVED_SLUG", source_field: prev?.source_field || titleColumn };
    case "NOW":
      return { ...base, mapping_type: "RUNTIME_NOW" };
    case "EMPTY":
      return { ...base, mapping_type: "LEAVE_EMPTY" };
    case "DEFAULT":
      return { ...base, mapping_type: "DB_DEFAULT" };
    default: {
      let v = prev?.mapping_type === "FIXED_VALUE" ? prev.fixed_value : undefined;
      if (v === undefined) {
        if (col.kind === "enum") v = col.enum_values[0] ?? "";
        else if (col.kind === "boolean") v = 1;
        else if (col.kind === "number") v = 0;
        else v = "";
      }
      return { ...base, mapping_type: "FIXED_VALUE", fixed_value: v };
    }
  }
}

const LENGTH_WORDS: Record<string, string> = { short: "about 350", medium: "about 750", long: "about 1,300" };

export function explain(col: PlanColumn, m: Mapping | undefined, ctx: { titleColumn: string | null; length: string; format: string; manual: boolean }): string {
  const mode = modeOf(m, col);
  const r = col.relation;
  if (col.is_secret) return "Protected column: automations never read or write it.";
  switch (mode) {
    case "AI":
      if (col.kind === "image") {
        // Same name rules as the server (ImageFieldService::roleFor).
        const n = col.name.toLowerCase();
        const size = /(og_|social|share|meta_img|meta_image|seo_image|twitter)/.test(n) ? "1200×630 social card" : /(thumb|avatar|icon|square|logo)/.test(n) ? "800×800 square" : "1600×900 banner";
        return `An image (${size}) is created from the generated title and summary, stored, and its URL saved here.`;
      }
      if (col.kind === "title") return `AI writes the headline${col.max_length ? ` (max ${col.max_length} characters)` : ""}.`;
      if (col.kind === "body") return `AI writes the full body in ${ctx.format === "html" ? "HTML" : "Markdown"}, ${LENGTH_WORDS[ctx.length] ?? "about 750"} words.`;
      if (col.kind === "summary") return `AI writes a 1–2 sentence summary${col.max_length ? ` (max ${col.max_length} characters)` : ""}.`;
      if (col.kind === "meta_title") return "AI writes an SEO title (about 60 characters).";
      if (col.kind === "meta_description") return "AI writes an SEO description (about 155 characters).";
      if (col.kind === "keywords") return "AI writes 5–8 comma-separated keywords.";
      if (col.kind === "enum") return `AI chooses one of: ${col.enum_values.join(", ")}.`;
      return `AI writes a value for this column${col.max_length ? ` (max ${col.max_length} characters)` : ""}.`;
    case "AI_CREATE":
      return `AI picks the best ${r!.entity} from your ${r!.existing_count} existing one${r!.existing_count === 1 ? "" : "s"}${r!.options.length ? ` (${r!.options.slice(0, 4).join(", ")}${r!.options.length > 4 ? ", …" : ""})` : ""}. If none fits, it first creates a new ${r!.entity} in “${r!.table}”${r!.parent_required_columns.length ? ` (also filling ${r!.parent_required_columns.join(", ")})` : ""}, then stores its new id here. Both happen in one transaction.`;
    case "AI_REUSE":
      return `AI picks the closest of your ${r!.existing_count} existing ${r!.entity}${r!.existing_count === 1 ? "" : "s"}. New ${r!.entity}s are never created.${r!.create_blocked_reason ? ` (Creating is not possible: ${r!.create_blocked_reason}.)` : ""}`;
    case "FIXED_REL":
      return m?.fixed_value
        ? `Every new row uses ${r!.entity} #${m.fixed_value}.`
        : `Choose which ${r!.entity} every new row should use.`;
    case "SLUG":
      return `Built from “${m?.source_field || ctx.titleColumn || "title"}” and made unique automatically (my-title, my-title-2, …).`;
    case "NOW":
      return "Set to the exact moment the row is published.";
    case "EMPTY":
      return "Left empty (NULL).";
    case "DEFAULT":
      return `Not sent, so the database default applies${col.default !== null ? ` (${col.default})` : ""}.`;
    default:
      return m?.fixed_value === "" || m?.fixed_value === null || m?.fixed_value === undefined
        ? (col.kind === "image" ? "Paste the image URL to use for every row." : "Enter the value to use for every row.")
        : `Always “${String(m.fixed_value).slice(0, 60)}”.`;
  }
}

/** Blocking problems the user must fix before continuing. */
export function mappingProblems(plan: FieldPlan | null, mappings: Record<string, Mapping>, manual: boolean): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!plan) return problems;
  for (const col of plan.columns) {
    if (col.is_secret) continue;
    const m = mappings[col.name];
    const mode = modeOf(m, col);
    if (manual && (mode === "AI" || mode === "AI_CREATE" || mode === "AI_REUSE")) {
      problems[col.name] = "AI is off for this automation; choose a fixed value.";
      continue;
    }
    if (col.required && (mode === "EMPTY" || (mode === "DEFAULT" && !col.has_default))) {
      problems[col.name] = "This column is required (NOT NULL, no default).";
      continue;
    }
    if (mode === "FIXED_REL" && (m?.fixed_value === null || m?.fixed_value === undefined || m?.fixed_value === "") && !col.nullable) {
      problems[col.name] = `Choose a ${col.relation?.entity ?? "record"}.`;
      continue;
    }
    if (mode === "FIXED" && col.kind === "image" && m?.fixed_value && !/^https?:\/\//i.test(String(m.fixed_value))) {
      problems[col.name] = "Use an http(s) image URL.";
      continue;
    }
    if (mode === "FIXED" && col.required && !TEXT_KINDS.includes(col.kind) && (m?.fixed_value === "" || m?.fixed_value === null || m?.fixed_value === undefined)) {
      problems[col.name] = "Enter a value.";
    }
  }
  return problems;
}

/** Mappings sent to the API: one entry per non-secret column. */
export function serializeMappings(plan: FieldPlan | null, mappings: Record<string, Mapping>): Mapping[] {
  if (!plan) return Object.values(mappings);
  return plan.columns
    .filter((c) => !c.is_secret && mappings[c.name])
    .map((c) => mappings[c.name]);
}

export function groupColumns(plan: FieldPlan, mappings: Record<string, Mapping>) {
  const content: PlanColumn[] = [];
  const relations: PlanColumn[] = [];
  const other: PlanColumn[] = [];
  const secret: PlanColumn[] = [];
  for (const c of plan.columns) {
    if (c.is_secret) secret.push(c);
    else if (c.relation) relations.push(c);
    else if (["title", "summary", "body", "image", "slug", "meta_title", "meta_description", "keywords"].includes(c.kind) || modeOf(mappings[c.name], c) === "AI") content.push(c);
    else other.push(c);
  }
  return { content, relations, other, secret };
}
