# Security Model: AI-Powered Database Automation Platform

## 1. Threat Model & Security Posture

The platform treats both user inputs and AI outputs as untrusted entities. Because users connect external relational databases and configure automated publishing pipelines, the architecture incorporates defense-in-depth controls at every boundary.

```mermaid
flowchart TD
    subgraph Boundary1 ["Boundary 1: Network & Connection"]
        SSRF["SSRF Interceptor (Blocks metadata 169.254.169.254, loopback in production)"]
        EncRest["At-Rest Encryption (Crypt::encryptString for DB passwords & API keys)"]
        EphemeralConn["Ephemeral PDO Instances (Cleaned in finally, zero global state leakage)"]
    end

    subgraph Boundary2 ["Boundary 2: Multi-Tenant Authorization"]
        SanctumAuth["Sanctum Token Authentication"]
        ScopeCheck["Strict Model Scoping (where user_id = auth->id)"]
        IDORDefense["IDOR Prevention on every Route & Action"]
    end

    subgraph Boundary3 ["Boundary 3: AI Output & Schema Validation"]
        JSONOnly["Structured JSON Only (Never Raw SQL)"]
        SchemaReval["Laravel Schema Validator (Types, Lengths, Enums, FKs, Unique Constraints)"]
    end

    subgraph Boundary4 ["Boundary 4: Target Database Execution"]
        BlockedTables["Default-Deny Policy (Blocked: users, auth, tokens, payments, orders, audits)"]
        AllowlistColumns["Strict Column Allowlist Verification"]
        ParamOnly["Parameterized INSERT & Scoped UPDATE Only"]
        ForbiddenSQL["Hard AST Interceptor (Blocks DELETE, DROP, TRUNCATE, ALTER, DDL)"]
        AtomicTx["Atomic Transactions with Rollback"]
    end
```

---

## 2. Dynamic Database Security

### 2.1 SSRF & Network Protections
- **Host Validation:** IP addresses and hostnames are validated.
- **Prohibited Destinations:** Hard blocks on AWS/GCP/Azure link-local metadata endpoints (`169.254.169.254`, `fd00::/8`).
- **Port Allowlist:** Restricts connections to standard relational database ports (e.g. 3306, 3307, 3308).
- **Environment Awareness:** Localhost and private subnet addresses (`127.0.0.1`, `192.168.x.x`, `10.x.x.x`) are permitted strictly when `APP_ENV=local` or `ALLOW_LOCAL_TARGET_CONNECTIONS=true`. In production environments, private subnets are blocked unless explicitly routed via an egress connector.

### 2.2 Credential Protection
- Stored credentials (passwords, cloud API keys) are encrypted using AES-256-CBC via Laravel's `Crypt::encryptString()`.
- API endpoints return only masked secrets (e.g. `********`).
- Passwords and connection strings are excluded from system logs and exception stack traces.

### 2.3 Ephemeral Scoped Connections
- Never modifies the global Laravel `config(['database.connections...'])` in a persistent manner.
- Creates temporary PDO connections per execution request and immediately closes them inside `finally` blocks.

---

## 3. Target Database Execution Policy (Tiered Policy, ADR-010)

Per owner-authorised policy change (2026-10-15):

| Operation | Policy |
|---|---|
| SELECT / COUNT / aggregates / schema questions | Allowed. Read-only, validated, limited. |
| INSERT | Allowed after preview and confirmation. |
| UPDATE | Allowed after preview and confirmation, pinned to the exact previewed primary keys. |
| DELETE | Allowed ONLY if the connection owner enabled access mode `read_write_delete`, with impact analysis, typed confirmation, transaction, backup and audit. |
| DROP / TRUNCATE / ALTER / CREATE / GRANT / any DDL | **Always prohibited.** No setting enables them. |
| Raw LLM-written SQL for writes | **Always prohibited.** Writes go through structured operation plans compiled by backend code. |
| Raw LLM-written SELECT | Only through the validated read gate: AST parse, allowlists, forced LIMIT, timeout, read-only transaction. |

### 3.1 Per-Connection Access Modes
- `read_only` (default): reads only.
- `read_write`: reads + insert/update after confirmation.
- `read_write_delete`: adds delete with impact analysis and typed confirmation.
The backend enforces the access mode regardless of the database user's privileges.

### 3.2 Data Classes & Protection
- **Blocked tables:** credentials, tokens, sessions.
- **Read-only tables:** financial, permission, order and audit tables (`payments`, `invoices`, `transactions`, `refunds`, `payouts`, `financial*`, `orders`, `order_items`/`order_lines`, `roles`, `permissions`, `user_roles`, `model_has_roles`, `model_has_permissions`, `role_has_permissions`, `audit_*`) are view only until the connection owner makes a table editable (`PUT /api/connections/{id}/tables/{table}/access`, asked first in the Schema Explorer, audited with before/after). Credential, token and session tables ignore any override. Automations never write a view-only table.
- **Secret columns:** password hashes, tokens, card numbers, national IDs are never returned, never sent to models, and never written.
- **PII columns:** email and phone are masked by default; reveals are permission-checked and audited.
- **Automation eligibility:** the automation engine continues to restrict sensitive tables from automated background writing.

---

## 4. Email Approval Security & Crawler Protection

### 4.1 Token Security
- Approval links utilize cryptographically signed tokens generated with HMAC-SHA256.
- Tokens expire after 24 hours and are strictly single-use.
- Bound to specific `automation_id`, `version_id`, and `user_id`.

### 4.2 Crawler Neutralization
- To prevent enterprise email filters (such as Microsoft Defender and Google Workspace) from automatically clicking links and approving content, email links navigate to a confirmation page:
  `http://localhost:5173/approvals/{token}`
- The user must explicitly view the draft preview and click **Approve** or **Reject**, submitting an HTTP `POST` request.

---

## Orbit agent security

- **Identity:** the user, workspace and every resource ID are checked server-side (`ToolPolicyGate`) right before each side effect. A model-supplied ID that belongs to another user returns `NOT_FOUND`.
- **Only registered tools:** the model's tool name is constrained to the available registry (schema enum) and re-validated. Arguments are validated against the same schema (types, enums, no extra properties). No tool runs SQL, DDL or deletes against customer databases.
- **Secrets:** passwords and API keys go to `SecretVault` (`agent_secure_inputs`, encrypted cast, per task and user, 30-minute TTL, consumed after a verified save). They come from the masked field, or are redacted out of utterances by both the browser and the server. They are injected into tool arguments only at execution time and scrubbed from tool output. They never appear in task plans or slots, messages, tool-call records, UI actions, timeline, live events or model requests; `AgentAutonomousActionTest::assertSecretNowhere` checks this.
- **Confirmation:** `always_confirm` tools (profile/automation/document removal, published-record edits) always wait for an explicit user confirmation. A spoken "yes" counts only for the exact pending call and only after Orbit asked.
- **Retrieved content is untrusted:** RAG passages and database text are delimited as reference data in the model request and cannot change policy. Retrieval is limited to product docs plus the requesting user's own partition.
- **Browser actions** are allowlisted (`UiActionCoordinator::ALLOWED_ACTIONS`, registered routes only). The model cannot send code or selectors. Visible "press" actions never call the API themselves.


---

## Automation writes: relations, images and review (2026-10-16)
- **Parent creation** only under an explicit `CREATE_IF_MISSING` column policy, never in sensitive, blocked or read-only tables, never with secret columns, never by guessing another foreign key. The child row is written in the same transaction, after its parent.
- **No silent fallbacks:** an unresolvable foreign key, a missing required column, an invalid enum value or a non-unique value is an error before any write. Over-long text is shortened (multibyte-safe) and reported.
- **Secret columns** (`ColumnClassifier`) are never written by automations, previews or manual publishing. The classifier now matches whole tokens, so `company_name`, `panel` or `passenger_count` are no longer misclassified, while `pan`, `pan_number`, `password_hash` and `remember_token` still are.
- **Lookup lists** of parent records never use e-mail columns as labels and refuse blocked tables.
- **Images:** provider keys are the user's own (encrypted at rest, sent per request to the internal AI service, never stored there). Every image is decoded and re-encoded before storage, so the stored file is a valid image of a known type. Uploads are limited to JPEG/PNG/WebP/GIF ≤ 10 MB and checked again by magic bytes.
- **Review links** are single-use, bound to one version, refused once the run has finished, and never written to logs or the audit trail. Approval tokens are no longer returned by the executions API. Email delivery failures are recorded as `APPROVAL_EMAIL_FAILED`, never reported as sent.
- **Publishing** is idempotent per execution (`publish_exec_{id}`), never acts on a finished run, and can never publish a rejected or invalid version ("Publish now" refuses them).
- **Rendered previews** never use `innerHTML`: Markdown is parsed into React elements, and HTML is rebuilt from an allowlist (links limited to http/https/mailto).

## Orbit Remote (phone pairing), 2026-10-21

| Threat | Control |
| --- | --- |
| QR code photographed or leaked | Single use, valid 3 minutes, stored as SHA-256; carried in the URL `#fragment` (not sent in request lines, not in server or proxy logs); the address bar is cleared after claiming. |
| Phone token stolen | Hashed at rest; accepted only by `/api/orbit-remote/device/*` (not Sanctum, no portal API); ends on disconnect from either side, a new pairing, sign-out of the pairing tab, 2 h idle, 12 h total. |
| Acting as another user / tab | Every computer endpoint and the `orbit-remote.{id}` channel check ownership; the phone's socket auth only signs its own channel; requests carry the target tab instance and the server lets one tab take them (late or duplicate acknowledgements are refused). |
| Secrets via voice | Passwords/API keys are refused on the phone and on the server; the secure field stays on the computer. Live "listening" words are redacted before they are shown. |
| Unwanted actions | The phone sends a request; the computer runs it through Orbit's normal gate (permissions, confirmations by the panel Confirm button). Requests are refused when the computer is offline or when they reach it more than 30 s late (server clock). Rate limits: claim 12/min per IP, requests 20/min per phone. |
| Phone page running portal actions | `/orbit/remote` is routed outside the portal providers, so it never heartbeats or runs Orbit UI actions even if the same browser is signed in. |
| Audit | `ORBIT_REMOTE_PAIRING_CREATED`, `ORBIT_REMOTE_PAIRED`, `ORBIT_REMOTE_COMMAND` (id, kind, length), `ORBIT_REMOTE_ENDED`. |

## Admin panel, 2026-10-21

| Threat | Control |
| --- | --- |
| A customer reaching admin functions | Separate `admins` table and session guard `admin`; Sanctum tokens and the `web` guard never authenticate `/admin`. No default admin: the first one is created on the server (`php artisan admin:create`). Inactive admins are refused (403). Optional authenticator-app 2FA with recovery codes (secrets encrypted at rest). |
| Over-broad admin access | 23 permissions (view / manage per area). Every resource, page and action checks them on the server (deny by default when a permission is missing). Only super admins manage super admins; the last active super admin cannot be deleted; nobody changes their own roles or deactivates themselves. |
| Secrets shown in the panel | Connection passwords, provider keys, device tokens and pairing codes are never displayed ("stored encrypted, never shown"). Failed jobs show only the job name and the first line of the error (no payload, no stack trace with arguments). *System › Health* lists server settings with secrets as "Set (never shown)". |
| Settings used to weaken safety | The data policy (ADR-010: no DDL, previews, pinned updates, delete mode per connection) is code, not a setting. Settings are validated on the server with ranges and cross-checks; secrets (`APP_KEY`, database and mail credentials, `AI_SERVICE_KEY`) cannot be set from the panel. Public endpoints expose only settings marked public. |
| Untraceable changes | Admin activity log (who, what, before → after; secret fields recorded only as "changed") for settings, content, admins, roles, customer actions, Orbit knowledge, failed-job actions and sign-ins. Actions on a customer's account or resources (suspend, reactivate, sign out everywhere, force read-only, pause, resume) are also written to that customer's audit log; deleting an account is recorded in the admin activity log. |
| Admin edits to Orbit's knowledge | Guides are retrieval context only: Orbit's permissions are decided by the gate in Laravel, never by guide text. Guide names are slugs (validated in Laravel and the AI service) and are written only inside the AI service's own storage. |
| Suspended or deleted customers | Suspension revokes all tokens, ends the paired phone and blocks sign-in and every API call (403 `suspended`); deletion signs out, removes knowledge vectors and files, then the account and its owned data. |

## Portal, data and audit additions (2026-10-23)
| Risk | Control |
| :--- | :--- |
| Audit noise hiding real refusals | Showing what the Data page may do uses `DataAccessPolicy::writeRefusal()` (no logging); only real write attempts are refused through `assertCanWrite()` and recorded. |
| Secrets or personal data in the audit trail | `AuditLog::changes()` keeps before → after only for fields that changed; secret fields (passwords, keys, tokens) are stored as "(hidden)"; personal data is masked the same way the portal masks it; long values are shortened. API keys are never recorded, only that a new one was saved. |
| Spreadsheet formula injection from exports | Customer audit CSV and the admin activity exports prefix any cell starting with `=`, `+`, `-`, `@`, tab or carriage return with `'`. Exports are themselves recorded. |
| Account takeover through profile changes | Changing the email or the password needs the current password; a password change signs out the other sessions by default; a session can be signed out from Account settings (never the current one through that path). |
| Orbit acting out of sight | With the portal open, run now, pause/resume, retry/cancel/pause a run, approve and send back are carried out on screen by pressing the page's own buttons; the server then checks the real state (for example that the automation is really paused) and never repeats a pressed action in the background. |
| Orbit knowledge tampering through files | Orbit's product guides live only in the platform database, edited by admins with the `orbit_knowledge.manage` permission; the AI service indexes what Laravel publishes and keeps no guide files. |
| Interrupting a finished run | The Orbit interrupt tool follows the portal's rules: a published run cannot be cancelled and a stopped run keeps its real outcome. |

