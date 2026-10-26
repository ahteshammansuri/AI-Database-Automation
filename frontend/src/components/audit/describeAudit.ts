import { humanStatus } from "../common/statusText";

/** Audit entries in plain sentences, a category for each, and where in the portal the related item lives. */

export interface AuditEntry {
  id: number;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, any> | null;
  ip_address?: string | null;
  created_at: string;
}

export const CATEGORY_LABEL: Record<string, string> = {
  connections: "Connections",
  automations: "Automations",
  approvals: "Approvals",
  data: "Data",
  ai: "AI & knowledge",
  account: "Account",
  orbit: "Orbit",
};

export const categoryOf = (action: string): string => {
  if (/^data\./.test(action)) return "data";
  if (/^(VERSION_APPROVED|VERSION_REJECTED|APPROVAL_|CONTENT_AUTO_APPROVED)/.test(action)) return "approvals";
  if (/^(ORBIT_|AGENT_)/.test(action)) return "orbit";
  if (/^(CONNECTION_|SCHEMA_)/.test(action)) return "connections";
  if (/^(AUTOMATION_|SCHEDULED_RUN_|EXECUTION_|VERSION_GENERATED|TARGET_RECORD_|MANUAL_PUBLISH|PUBLISHED_RECORD_)/.test(action)) return "automations";
  if (/^(AI_PROVIDER_|MODEL_ROLE_|KNOWLEDGE_|MEDIA_)/.test(action)) return "ai";
  return "account";
};

const ROLE: Record<string, string> = { planner: "Orbit and planning", generator: "Writing content" };
const rows = (n: any) => `${n ?? 0} row${Number(n) === 1 ? "" : "s"}`;
const q = (v: any) => (v ? `“${v}”` : "");

/** One sentence for an entry; unknown actions fall back to their name in plain case. */
export const describe = (e: AuditEntry): string => {
  const m = e.metadata ?? {};
  const changed = m.changes ? Object.keys(m.changes) : [];
  switch (e.action) {
    case "USER_REGISTERED": return "You created your account";
    case "USER_LOGIN": return "Signed in";
    case "PROFILE_UPDATED": return `Updated your profile${changed.length ? `: ${changed.join(", ")}` : ""}`;
    case "PASSWORD_CHANGED": return "Changed your password";
    case "ACCOUNT_SUSPENDED": return "An administrator suspended your account";
    case "ACCOUNT_REACTIVATED": return "An administrator reactivated your account";
    case "AUDIT_LOG_EXPORTED": return "Exported the audit log";
    case "CONNECTION_CREATED": return `Added the connection ${q(m.name)}${m.database ? ` (${m.database}${m.host ? ` on ${m.host}` : ""})` : ""}`;
    case "CONNECTION_UPDATED": return `Changed the connection ${q(m.name)}${changed.length ? `: ${changed.join(", ")}` : ""}`.replace("connection :", "connection:");
    case "CONNECTION_DELETED": return "Removed a connection";
    case "CONNECTION_TABLE_ACCESS_CHANGED": return `Set ${m.table} to ${m.after === "writable" ? "editable" : m.after === "read_only" ? "view only" : m.after}${m.choice === "default" ? " (its default)" : ""}`;
    case "AUTOMATION_CREATED": return `Created the automation ${q(m.name)}${m.table ? ` for ${m.table}` : ""}`;
    case "AUTOMATION_UPDATED": return `Changed the automation ${q(m.name) || `#${e.resource_id}`}${changed.length ? `: ${changed.join(", ")}` : ""}`;
    case "AUTOMATION_DELETED": return `Deleted automation #${e.resource_id}`;
    case "AUTOMATION_TRIGGERED": return `Started run #${e.resource_id} now`;
    case "AUTOMATION_SCHEDULE_COMPLETED": return "An automation's schedule reached its end date";
    case "SCHEDULED_RUN_MISSED": return `A scheduled run${m.run_date ? ` on ${m.run_date}` : ""} was missed`;
    case "EXECUTION_RETRIED": return `Retried run #${e.resource_id}`;
    case "VERSION_GENERATED": return `Draft version ${m.version_number ?? ""} was written${m.requires_approval ? " and is waiting for approval" : ""}`;
    case "APPROVAL_EMAIL_SENT": return m.error ? `The approval email to ${m.recipient} could not be sent` : `Sent the approval email to ${m.recipient}`;
    case "VERSION_APPROVED": return `Approved draft version ${m.version_number ?? ""}${m.changes ? " with your edits" : ""}${m.publish_now ? " and published it right away" : ""}`;
    case "VERSION_REJECTED": return `Sent draft version ${m.version_number ?? ""} back for a rewrite${m.feedback ? `: “${String(m.feedback).slice(0, 80)}${String(m.feedback).length > 80 ? "…" : ""}”` : ""}`;
    case "CONTENT_AUTO_APPROVED_TIMEOUT": return "Nobody decided by the publication time, so the draft was published automatically";
    case "TARGET_RECORD_PUBLISHED": return `Published row #${m.record_id} to ${m.target_table}`;
    case "PUBLISHED_RECORD_UPDATED": return `Edited published row #${m.record_id} in ${m.target_table}`;
    case "MANUAL_PUBLISH_EXECUTED": return `Published row #${m.record_id} to ${m.table} manually${m.parents_created ? " (a linked row was added first)" : ""}`;
    case "data.read_executed": return `Ran a read-only question (${rows(m.row_count)})${m.pii_revealed ? ", personal data revealed" : ""}`;
    case "data.insert_executed": return `Added ${rows(m.affected_count)} to ${m.table}`;
    case "data.update_executed": return `Updated ${rows(m.affected_count)} in ${m.table}`;
    case "data.delete_executed": return `Deleted ${rows(m.affected_count)} from ${m.table}`;
    case "data.insert_undone": return `Undid adding ${rows(m.removed)} to ${m.table}`;
    case "data.update_undone": case "data.delete_undone": return `Undid a change in ${m.table}`;
    case "data.write_refused": return `A ${m.operation ?? "write"} on ${m.table} was refused (${humanStatus(String(m.reason ?? ""))})`;
    case "data.delete_refused": return `A delete on ${m.table} was refused (${humanStatus(String(m.reason ?? ""))})`;
    case "data.delete_confirmation_mismatch": return "A delete was not confirmed (the typed phrase did not match)";
    case "data.pii_revealed": return `Revealed personal data in ${m.table ?? "a table"}`;
    case "AI_PROVIDER_CONFIGURED": return `Set up ${m.provider_type}${m.model_name ? ` (${m.model_name})` : ""}${m.api_key_replaced ? " with a new API key" : ""}`;
    case "MODEL_ROLE_UPDATED": return `Chose ${m.provider} ${m.model_name} for “${ROLE[m.role] ?? m.role}”`;
    case "KNOWLEDGE_DOC_INDEXED": return `Added ${q(m.title)} to the knowledge base${m.chunks ? ` (${m.chunks} passages)` : ""}`;
    case "MEDIA_UPLOADED": return `Uploaded an image${m.bytes ? ` (${Math.round(m.bytes / 1024)} KB)` : ""}`;
    case "ORBIT_REMOTE_PAIRING_CREATED": return "Started pairing a phone with Orbit";
    case "ORBIT_REMOTE_PAIRED": return `Paired a phone with Orbit${m.device ? ` (${typeof m.device === "string" ? m.device : m.device?.name ?? "device"})` : ""}`;
    case "ORBIT_REMOTE_ENDED": return "Ended the phone session";
    case "ORBIT_REMOTE_COMMAND": return `Sent a ${m.kind ?? ""} command to Orbit from the phone`;
    case "AGENT_CONNECTION_SAVED": return `Orbit added the connection ${q(m.name)}`;
    case "AGENT_CONNECTION_DELETED": return "Orbit removed a connection";
    case "AGENT_AUTOMATION_CREATED": return `Orbit created the automation ${q(m.name)}${m.target_table ? ` for ${m.target_table}` : ""}`;
    case "AGENT_AUTOMATION_DELETED": return "Orbit deleted an automation";
    default: return humanStatus(e.action.replace(/^data\./, "data "));
  }
};

/** A portal page for the entry's subject, when there is one. */
export const linkFor = (e: AuditEntry): { to: string; label: string } | null => {
  const m = e.metadata ?? {};
  switch (e.resource_type) {
    case "AutomationExecution": return { to: `/executions?id=${e.resource_id}`, label: `Open run #${e.resource_id}` };
    case "Automation": return e.action === "AUTOMATION_DELETED" ? null : { to: `/executions?automation=${e.resource_id}`, label: "Runs of this automation" };
    case "ContentVersion": return m.execution_id ? { to: `/executions?id=${m.execution_id}`, label: `Open run #${m.execution_id}` } : { to: "/approvals", label: "Approvals" };
    case "DbConnection": return e.action.endsWith("DELETED") ? null : { to: m.table ? `/explorer?connectionId=${e.resource_id}&table=${encodeURIComponent(m.table)}` : "/connections", label: m.table ? `Open ${m.table}` : "Connections" };
    case "db_connections": return m.table ? { to: `/data?connection=${e.resource_id}&table=${encodeURIComponent(m.table)}`, label: `Open ${m.table} in Data` } : null;
    case "KnowledgeDocument": return { to: "/knowledge", label: "Knowledge base" };
    case "AiProvider": case "ModelRole": return { to: "/ai-providers", label: "AI providers" };
    default: return null;
  }
};

export const toneOf = (action: string): string =>
  /refused|FAIL|ERROR|DENIED|BLOCK|SUSPENDED|MISSED|mismatch/i.test(action) ? "da-chip-rose"
    : /DELETE|REMOVE|REJECT|undone|ENDED/i.test(action) ? "da-chip-amber"
      : /PUBLISH|APPROV|executed|CREATED|SAVED|PAIRED|INDEXED/i.test(action) ? "da-chip-emerald"
        : "da-chip-slate";
