# Platform Capabilities & Agent Tools Directory

This catalog documents the complete set of tools, security boundaries, and feature capabilities registered within the AI Database Automation Platform.

---

## 1. Safety & Execution Invariants (ADR-010 Tiered Policy)

1. **SELECT / Aggregates / Schema Questions:** Allowed. Read-only, validated, and strictly limited.
2. **INSERT:** Allowed after preview and confirmation.
3. **UPDATE:** Allowed after preview and confirmation, pinned to exact previewed primary keys in transactions.
4. **DELETE:** Allowed ONLY when the connection owner explicitly sets Access Mode to `read_write_delete`, with recursive foreign-key impact analysis, typed confirmation phrase (voice rejected), transaction rollback, encrypted before-image backup with TTL, and audit.
5. **Permanently Prohibited:** `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `RENAME`, `GRANT`, `REVOKE`, any DDL, and raw LLM-written SQL for writes. No setting enables them.
6. **Raw LLM-Written SELECT:** Allowed only through the validated AST read gate (`sqlglot`), single statement, allowlisted tables/columns, dangerous function denylist (`pg_sleep`, `sleep`), forced LIMIT, and read-only transactions.
7. **Tenant Boundary Isolation:** Every resource (connection, automation, version, execution, change request, audit entry, and RAG document) is derived from the authenticated user session.
8. **Credential Isolation:** Passwords and API keys are encrypted at rest with AES-256-GCM, never logged, never returned to browser, and masked in transcripts.
9. **Circuit Breakers & Timeouts:** Hard bounded loop detection (max 12 iterations per turn) and instant barge-in (`Escape`, Stop button) prevent runaway operations.

---

## 2. Core Tool Registry (`AgentToolRegistry.php`)

Generated from the live registry. UI tools (side effect `ui`) operate the portal on screen through the surface catalog (`laravel/resources/orbit/surfaces.json`); their confirmation comes from each catalog action's `consequential` flag. Backend tools follow the default-autonomy policy shown here.

| Tool | Side effect | Confirm | Secret params (from vault) | Postcondition | Description |
|---|---|---|---|---|---|
| `go_to_page` | ui | per catalog | — | — | Visibly navigate the portal to a page (Orbit taps the sidebar item). Returns which surfaces are now on screen. |
| `open_form` | ui | per catalog | — | — | Navigate if needed and open a form (Orbit taps its opener, e.g. "Connect Database"). Returns its fields, current values and which required fields are still missing. |
| `read_screen` | ui | per catalog | — | — | Read what is on screen now: surfaces with their non-secret field values, errors, list rows (with their ids) and available actions. |
| `fill_fields` | ui | per catalog | — | — | Type values into fields of an on-screen surface (Orbit types them visibly). values is an object of field name to value. Never for secret or file fields. Returns per-field acceptance or validation errors and fields still missing. |
| `choose_option` | ui | per catalog | — | — | Pick an option in a select field using the real loaded options, by option id or visible label. Returns the chosen option, or the candidates if ambiguous. |
| `press` | ui | per catalog | — | — | Press a button on an on-screen surface; the page does exactly what a user click does and the real result is returned. Row actions need row (the item id). Actions marked consequential need the user to confirm first. |
| `ask_secret_in_form` | ui | per catalog | — | — | Point at a password or API-key box in the form and let the user type it there themselves. Then WAIT_FOR_USER; you will be told when they have entered it. You never see the value. |
| `show_me` | ui | per catalog | — | — | Point at and highlight a field, button or the surface itself with a short caption, to guide the user. |
| `list_database_connections` | read | no | — | — | List all connected databases for the authenticated user. |
| `test_database_connection` | platform_metadata | no | password | — | Check whether a database is reachable. Pass connection_id to check the live status of a SAVED connection (updates its stored status). Or pass host, port, database and username to test NEW details before saving; the password is supplied securely by the app, never by you. |
| `save_database_connection` | write | no | password | connection_persisted | Save a new MySQL connection profile for the user. Re-tests connectivity first and refuses to save if the test fails. Requires name, host, database, username (port defaults to 3306). The password is supplied securely by the app. |
| `update_database_connection` | write | yes | password | — | Update connection metadata or credentials for an existing database profile. |
| `disconnect_database_connection` | write | always | — | — | Remove a saved platform database connection profile. Target customer database is completely untouched. |
| `scan_database_schema` | platform_metadata | no | — | schema_snapshot_exists | Introspect database schema and discover eligible tables for content automation. |
| `get_schema_scan_status` | platform_metadata | no | — | — | Retrieve table eligibility classifications and foreign key relationships. |
| `lookup_table_values` | read | no | — | — | Query allowable sample values or lookup references in an eligible target table (e.g. categories, tags, authors). |
| `list_automations` | read | no | — | — | List all configured content generation and publishing workflows for the user. |
| `get_automation_details` | read | no | — | — | Retrieve complete configuration, prompts, schedule, and field mappings of an automation. |
| `create_automation_draft` | write | yes | — | automation_persisted | Configure and persist a new AI content automation workflow with lead-time enforcement. |
| `update_automation` | write | yes | — | — | Update schedule, prompt context, active status, or settings of an existing automation. |
| `remove_automation` | write | always | — | — | Delete an automation configuration record from the platform database. |
| `run_automation_now` | external | yes | — | — | Immediately trigger a scheduled automation execution through the background queue. |
| `preview_automation_content` | read | no | — | — | Generate an ephemeral content preview using the configured AI model without scheduling or inserting into the database. |
| `list_executions` | read | no | — | — | List recent automation executions with status, date, and target table. |
| `get_execution_status` | read | no | — | — | Check detailed status, timeline events, and output of an automation run. |
| `retry_execution` | write | no | — | — | Re-dispatch a failed execution job to background workers. |
| `request_execution_interrupt` | write | no | — | — | Request immediate pause or cancellation of a queued or running execution. |
| `explain_execution_failure` | read | no | — | — | Analyze the latest failed execution and explain the root cause and safe fix. |
| `update_published_record` | external | always | — | — | Perform an audited, scoped UPDATE to a single target customer record (WHERE id = :id). |
| `get_pending_approvals` | read | no | — | — | List content drafts waiting for user approval before publishing. |
| `approve_content_version` | external | yes | — | version_approved | Approve a pending content version draft to proceed to scheduled or immediate publication. |
| `reject_content_version` | write | no | — | — | Reject a pending content draft and trigger regeneration with corrective feedback. |
| `list_ai_providers` | read | no | — | — | List configured AI providers with masked API keys and model preferences. |
| `test_ai_provider` | read | no | api_key | — | Test connectivity and model availability for a specific AI provider. |
| `save_ai_provider` | write | yes | api_key | — | Save or update user-specific AI provider credentials (encrypted at rest). |
| `get_provider_health` | read | no | — | — | Check connectivity to local Ollama or active AI providers. |
| `list_knowledge_documents` | read | no | — | — | List indexed knowledge documents (.pdf, .txt, .md) for the tenant workspace. |
| `query_knowledge_base` | read | no | — | — | Perform semantic search across workspace knowledge documents using vector embeddings. |
| `remove_knowledge_document` | write | always | — | — | Remove a knowledge document and purge its vector embeddings from the index. |
| `get_dashboard_summary` | read | no | — | — | Get overview statistics of connections, automations, executions, and worker health. |
| `list_audit_logs` | read | no | — | — | Retrieve system audit trail records for actions performed in this tenant workspace. |
| `ask_database` | read | no | — | — | Query database schema, count records, find tables, or inspect data using natural language with grounded diagnostics. |
| `find_dummy_data` | read | no | — | — | Analyze table sample for seeded dummy/placeholder accounts, test emails, or burst timestamps with honest confidence. |
| `preview_data_change` | platform_metadata | yes | — | — | Prepare a before/after diff preview for an UPDATE or an impact analysis for a guarded DELETE before execution. |
| `confirm_data_change` | external | always | — | — | Atomically execute a previewed UPDATE (pinned to previewed PKs) or guarded DELETE (requiring typed confirmation phrase). |
| `undo_data_change` | external | always | — | — | Revert an executed UPDATE or DELETE using the stored encrypted before-image. |

Tools not in this table do not exist; Orbit says so instead of improvising. See `docs/orbit-agent/ARCHITECTURE.md`.

## 3. Platform Feature Flags Summary

| Flag | Default | Description |
|---|---|---|
| `FEATURE_DRY_RUN` | `true` | Enables execution simulation without committing customer database writes. |
| `FEATURE_SCHEMA_DRIFT` | `true` | Detects schema alterations between live customer databases and stored snapshots. |
| `FEATURE_UNDO_CENTER` | `true` | Allows safe, tenant-scoped rollback of automated writes within 24 hours. |
| `FEATURE_QUALITY_SCORE` | `true` | Computes readability, SEO structure, and factual grounding metrics. |
| `FEATURE_CONTENT_CALENDAR` | `true` | Visual calendar interface with lead-time safe drag-to-reschedule support. |
| `FEATURE_DB_INSIGHTS` | `true` | Safe read-only operational analytics and publication velocity metrics. |
| `FEATURE_TEMPLATES` | `true` | Automation blueprints for Tech Blogs, Products, FAQs, and Release Notes. |
