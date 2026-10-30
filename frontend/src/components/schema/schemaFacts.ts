import type { SchemaColumn, SchemaRelationship, SchemaTable } from "../../types";

/** Facts about a schema table and its columns, worded for people who do not read SQL. */

const NUMERIC = /int|serial|numeric|decimal/i;

/** A numeric primary key is numbered by the database (auto-increment, serial or identity). */
export const isDatabaseNumbered = (col: SchemaColumn): boolean =>
  col.is_primary_key && NUMERIC.test(col.data_type || col.type || "");

const hasDefault = (col: SchemaColumn): boolean => col.default_value !== undefined && col.default_value !== null;

/** Columns a new row cannot be added without. */
export const requiredColumns = (table: SchemaTable): SchemaColumn[] =>
  (table.columns || []).filter((c) => !c.nullable && !hasDefault(c) && !isDatabaseNumbered(c) && c.sensitivity !== "secret");

export type AddRule = { label: string; tone: "rose" | "slate" | "emerald" | "indigo"; title: string };

/** What happens to this column when a row is added. */
export const addRule = (col: SchemaColumn): AddRule => {
  if (isDatabaseNumbered(col)) return { label: "Set by the database", tone: "indigo", title: "The database numbers new rows itself." };
  if (hasDefault(col)) return { label: `Default: ${String(col.default_value)}`, tone: "emerald", title: "Used when no value is given." };
  if (!col.nullable) return { label: "Required", tone: "rose", title: "A new row needs a value here." };
  return { label: "Optional", tone: "slate", title: "Can be left empty." };
};

export interface IncomingLink { table: string; column: string; referenced_column: string; relation: SchemaRelationship }

/** Tables whose rows point at this table (declared, detected or set by the owner). */
export const incomingLinks = (table: SchemaTable, all: SchemaTable[]): IncomingLink[] =>
  all.flatMap((t) =>
    (t.relationships || [])
      .filter((r) => r.referenced_table === table.name)
      .map((r) => ({ table: t.name, column: (r.foreign_key || r.constrained_column) ?? "", referenced_column: r.referenced_column, relation: r })),
  );

/** "blog_categories" -> "blog category" (a friendly singular for sentences). */
export const thingOf = (table: string): string => {
  const words = table.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (/ies$/.test(words)) return words.replace(/ies$/, "y");
  if (/(ses|xes|zes|ches|shes)$/.test(words)) return words.replace(/es$/, "");
  if (/s$/.test(words) && !/ss$/.test(words)) return words.replace(/s$/, "");
  return words;
};

/** Columns named like a link (category_id, authorId) that point nowhere yet: the owner may want to set them. */
export const unlinkedIdColumns = (table: SchemaTable): SchemaColumn[] => {
  const linked = new Set((table.relationships || []).map((r) => r.foreign_key || r.constrained_column));
  return (table.columns || []).filter((c) => !c.is_primary_key && !linked.has(c.name) && /(_id|Id|ID)$/.test(c.name) && c.sensitivity !== "secret");
};

/**
 * What the Data page may do with this table's rows: the table's class (blocked, read_only, writable or an owner
 * override) combined with the connection's access mode (a read_only connection never writes).
 */
export const accessLabel = (dataClass?: string | null, connectionMode?: string | null): { text: string; tone: string; help: string } | null => {
  switch (dataClass) {
    case "blocked":
      return { text: "Hidden everywhere", tone: "da-chip-rose", help: "Credential, token and session tables are never read, shown or changed." };
    case "read_only":
      return { text: "View only", tone: "da-chip-amber", help: "Financial, order, permission and audit tables can be viewed but not changed until the connection owner allows it per table." };
    case "writable":
    case "read_write":
      return connectionMode === "read_only"
        ? { text: "View only", tone: "da-chip-amber", help: "This connection is read-only. Change its access mode on the Connections page to add or edit rows." }
        : { text: "Editable in Data", tone: "da-chip-emerald", help: "Rows can be added and edited on the Data page, each change previewed first and undoable." };
    default:
      return null;
  }
};

export const formatRows = (n?: number | null): string | null => {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  return `≈ ${v >= 10_000 ? `${Math.round(v / 1000)}k` : v.toLocaleString()} row${v === 1 ? "" : "s"}`;
};
