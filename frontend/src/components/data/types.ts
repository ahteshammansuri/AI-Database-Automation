/** Shapes returned by the Data Explorer / Data Manager API (laravel DataExplorerController). */

export interface DataPermissions {
  read: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  reason: string | null;
}

export interface DataTableInfo {
  name: string;
  kind: string;
  rows_estimate: number | null;
  columns: number;
  primary_key: string[];
  class: string;
  blocked: boolean;
  permissions: DataPermissions;
}

export interface DataColumn {
  name: string;
  type: string;
  family: string;
  nullable: boolean;
  default: string | null;
  max_length: number | null;
  enum: string[];
  auto: boolean;
  generated: boolean;
  is_pk: boolean;
  link: { table: string; column: string } | null;
  personal: boolean;
  comment: string;
}

export interface RowsResponse {
  table: string;
  primary_key: string[];
  columns: DataColumn[];
  hidden_columns: string[];
  rows: Record<string, any>[];
  labels: Record<string, Record<string, string>>;
  total: number | null;
  page: number;
  per_page: number;
  sort: string | null;
  dir: "asc" | "desc";
  revealed: boolean;
  permissions: DataPermissions;
}

/** A pending change returned by preview-insert / preview-update / preview-delete / sample-rows. */
export interface ChangePreview {
  success: boolean;
  change_request_id: number;
  action: "insert" | "update" | "delete";
  table: string;
  affected_count: number;
  preview_rows?: Record<string, any>[];
  rows?: Record<string, any>[];
  diff_summary?: Record<string, { before: any; after: any }>;
  impact_analysis?: { child_table: string; foreign_key_column: string; dependent_row_count: number; cascade_action: string }[];
  confirmation_phrase?: string;
  warning_message?: string;
  dropped?: { row: number; errors: Record<string, string> }[];
  problems?: string[];
  model?: string;
}

export interface Autopilot {
  id: number;
  connection_id: number;
  table_name: string;
  name: string;
  rows_per_run: number;
  instructions: string | null;
  frequency: "hourly" | "daily" | "weekly";
  every_hours: number;
  run_time: string;
  weekdays: number[] | null;
  timezone: string;
  is_active: boolean;
  schedule: string;
  ends_on: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: "added" | "failed" | null;
  last_message: string | null;
  last_change_id: number | null;
  runs_count: number;
  rows_added: number;
}

/** A column a person fills when adding or editing a row (the database fills the others). */
export const isEditable = (c: DataColumn, insert: boolean) => !c.generated && !(insert && c.auto) && !(!insert && c.is_pk) && c.family !== "binary";
