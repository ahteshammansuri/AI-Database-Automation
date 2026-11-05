/**
 * Linked rows and value choices, as the API returns them (LinkedRecords on the server), and the value a linked
 * column holds in a form: an existing row's id, nothing, or a new row added together with this one.
 */

/** Where the picker reads from: the Data page (Data Manager rules) or publishing/automations (publishing rules). */
export interface LinkScope {
  connectionId: number;
  context: "data" | "publish";
}

/** A new linked row, created first when the row is saved: its values (with the name) and the name to show. */
export interface NewLink {
  $new: Record<string, any>;
  label: string;
  /** An uploaded image (media tables): its address on the platform, shown as a thumbnail. */
  preview?: string;
}

export interface LinkOption {
  id: string | number;
  label: string | null;
}

export interface CreateInfo {
  allowed: boolean;
  reason: string | null;
  /** name: the name is all a new row needs; details: other required values are asked for in a small form;
   *  upload: the linked table keeps files (a media table): a new row is an uploaded image. */
  mode: "name" | "details" | "upload";
  label_column: string | null;
  required: string[];
  automatic: string[];
}

export interface LinkOptions {
  table: string;
  column: string;
  ref_table: string;
  ref_column: string;
  thing: string;
  source: "declared" | "detected" | "owner" | "ai";
  enforced: boolean;
  reason: string | null;
  none: { allowed: boolean; value: number | null };
  label_column: string | null;
  options: LinkOption[];
  total: number | null;
  selected: LinkOption | null;
  create: CreateInfo;
  /** The column keeps images as rows of a media table. */
  media?: boolean;
  blocked?: boolean;
}

export interface ValueChoice {
  value: string | number;
  count: number | null;
  label: string | null;
}

export interface ValueChoices {
  table: string;
  column: string;
  kind: "enum" | "boolean" | "values";
  family: string;
  complete: boolean;
  nullable: boolean;
  default: string | null;
  values: ValueChoice[];
}

export const isNewLink = (v: unknown): v is NewLink => !!v && typeof v === "object" && "$new" in (v as any);

/** A new media-table row for an uploaded image (the server fills its columns from the AI's reading of the table). */
export const newUpload = (asset: { id: number; url: string }, fileName: string): NewLink => ({
  $new: { $media: { asset_id: asset.id, name: fileName } },
  label: fileName,
  preview: asset.url,
});

export const blankValue = (v: unknown) => v === undefined || v === null || v === "";

/** A new linked row named `label` (the name goes into the table's name column when it is known). */
export const newLink = (label: string, labelColumn: string | null, details: Record<string, any> = {}): NewLink => ({
  $new: { ...details, ...(labelColumn ? { [labelColumn]: label } : {}) },
  label,
});

/** "category_id" -> "Category", "meta_title" -> "Meta title", "customerId" -> "Customer". */
export const humanize = (name: string): string => {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(_id|Id|ID)$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
};

/** How a link was found, in a few words. */
export const linkSourceText = (source?: string): string =>
  source === "declared" ? "Declared in the database" : source === "owner" ? "Set by you" : source === "ai" ? "Read by your AI model" : "Detected from the name";

/** The text a value of a status-like column is shown with: its name ("Published") or the stored value. */
export const valueText = (value: unknown, labels?: Record<string, string> | null): string => {
  if (value === null || value === undefined || value === "") return "";
  const named = labels?.[String(value)];
  return named ? named : String(value);
};

/** True when `text` can be stored in a column of this family (a new value typed into a choice list). */
export const fitsFamily = (text: string, family: string): boolean => {
  const t = text.trim();
  if (t === "") return false;
  if (family === "integer") return /^-?\d{1,18}$/.test(t);
  if (family === "decimal") return /^-?\d+(\.\d+)?$/.test(t);
  return true;
};
