---
trigger: always_on
description: Dynamic customer database connections, schema discovery, safe writes, and network security.
---
# Dynamic Database Connections and Execution Safety

## Dynamic connection flow
- Users must be able to add their own MySQL host, port, database, username, password and optional SSL settings in the portal. Values must not be prefilled from one shared target DB.
- Implement connection testing, saving, updating/rotating credentials, disabling, and schema refresh.
- Store connection credentials encrypted at rest and keep each connection owned by its user/workspace.
- Never mutate a single global Laravel connection configuration in a way that can leak one user's credentials/connection into another concurrent request. Use a scoped connection manager/factory and release connections in `finally`/cleanup paths.
- Keep platform DB access and customer/target DB access separate in code and configuration.
- For each connection, introspect schema metadata only by default. Do not crawl all table rows or dump customer content.

## SSRF and network safety
The service accepts user-supplied hostnames and ports, which can become an SSRF or network-scanning risk if the application is hosted for multiple users.
- Validate host, port, database type and SSL settings; apply connection timeouts and bounded retries.
- Prevent access to cloud metadata endpoints and other explicitly prohibited infrastructure destinations.
- Resolve and validate addresses at connection time, and defend against DNS rebinding/time-of-check-to-time-of-use issues as far as practical.
- Do not expose a generic port scanner or let users submit arbitrary connection strings/driver options.
- For a local developer demo, permit explicitly user-authorized localhost/private-network DB connections only under a clearly defined local/development mode. Do not silently use permissive development rules in a hosted production deployment.
- If hosted deployment cannot securely support arbitrary user-supplied database hosts, document the network boundary and require egress policies, connection allowlisting, or a local-agent connector for that mode. Do not claim unrestricted secure production connectivity without implementing it.

## Allowed target operations (policy updated 2026-10-15, ADR-010)

| Operation | Policy |
|---|---|
| SELECT / COUNT / aggregates / schema questions | Allowed. Read-only, validated, limited. |
| INSERT | Allowed after preview and confirmation. |
| UPDATE | Allowed after preview and confirmation, pinned to exact primary keys. |
| DELETE | Allowed only in access mode `read_write_delete`, with impact analysis, typed confirmation, a transaction, a backup and an audit record. |
| DROP / TRUNCATE / ALTER / CREATE / GRANT / any DDL | Always prohibited. No setting enables them. |
| Raw model-written SQL for writes | Always prohibited. Writes go through structured operation plans that backend code compiles. |
| Raw model-written SELECT | Only through the validated read pipeline: AST parse, allowlists, forced LIMIT, timeout, read-only transaction. |

**Access modes.**
- Per-connection `access_mode` is `read_only` (default), `read_write` or `read_write_delete`.
- The UI recommends a database user restricted to the same mode. The backend enforces the mode regardless and never assumes the database user is restricted.

**Table and column classes.** These are default-deny until the owner reviews them.
- **Blocked tables:** credentials, tokens, sessions.
- **Read-only tables:** financial, permission, order and audit tables.
- **Secret columns** (password hashes, tokens, card numbers, national IDs) are never returned, never sent to a model, and never written.
- **PII columns** (email, phone) are masked by default; revealing them is permission-checked and audited.

**Hard rules.**
- Parameterized queries only. Identifiers are checked against the live schema allowlist and quoted per dialect.
- No raw SQL console, even for administrators or test mode.
- The UI cannot grant a permission that backend policy does not allow.

## Validation and execution
- Validate required fields, types, lengths, nullable values, defaults, enum values, unique constraints, foreign keys, allowed columns and business rules before writes.
- Resolve relationships through explicit configured rules. Never blindly follow every foreign key or write to all related tables.
- For updates and deletes, resolve the target rows first and pin execution to their exact primary keys:
  - A singular request that matches several rows must ask which one.
  - A multi-row change needs explicit count confirmation.
  - If the affected count differs from the preview, roll back.
- Use transactions for multi-table writes and rollback all related writes on failure.
- Use idempotency keys and execution records to avoid duplicates after retries/crashes.
- Revalidate the current connection owner, enabled state, schema eligibility and automation status immediately before execution.
- Do not include DB credentials or unredacted row contents in logs. Provide human-readable safe error messages and restricted diagnostic details.
