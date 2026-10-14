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

## Allowed target operations
- Metadata introspection and narrowly scoped reads needed for schema/allowed reference resolution.
- `INSERT` to approved tables and `UPDATE` of explicitly mapped fields for a validated target record.
- Use parameterized query APIs/query builders; never run AI-generated SQL.
- No target `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, arbitrary DDL, or raw SQL console, even for administrators or test mode.
- Restricted/sensitive tables include auth/password/session/token data, permissions, audit logs, payments, orders, wallets, financial records and any table/column identified by policy. Default deny until reviewed.
- The UI cannot grant a permission that backend policy does not allow.

## Validation and execution
- Validate required fields, types, lengths, nullable values, defaults, enum values, unique constraints, foreign keys, allowed columns and business rules before writes.
- Resolve relationships through explicit configured rules. Never blindly follow every foreign key or write to all related tables.
- For updates require an explicitly identified row/unique target and approved fields; reject ambiguous or multi-row update attempts.
- Use transactions for multi-table writes and rollback all related writes on failure.
- Use idempotency keys and execution records to avoid duplicates after retries/crashes.
- Revalidate the current connection owner, enabled state, schema eligibility and automation status immediately before execution.
- Do not include DB credentials or unredacted row contents in logs. Provide human-readable safe error messages and restricted diagnostic details.
