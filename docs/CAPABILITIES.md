# Platform Capabilities & Agent Tools Directory

This catalog documents the complete set of tools, security boundaries, and feature capabilities registered within the AI Database Automation Platform.

---

## 1. Safety & Execution Invariants

1. **Zero Destructive SQL:** Target customer `DELETE` (except bounded compensation), `DROP`, `TRUNCATE`, `ALTER`, `CREATE TABLE`, `RENAME`, `GRANT`, `REVOKE`, and arbitrary raw SQL execution are strictly prohibited.
2. **Strictly Parameterized Allowlisted Operations:** Only allowlisted `INSERT` and scoped `UPDATE` operations are permitted on non-sensitive tables.
3. **Tenant Boundary Isolation:** Every resource (connection, automation, version, execution, audit entry, and RAG document) is derived from the authenticated user session.
4. **Credential Isolation:** Passwords and API keys are encrypted at rest with AES-256-GCM, never logged, and masked in UI transcripts.
5. **Circuit Breakers & Timeouts:** Hard bounded loop detection (max 12 iterations per turn) and instant barge-in (`Escape`, Stop button) prevent runaway operations.

---

## 2. Core Tool Registry (`AgentToolRegistry.php`)

### Database Connection Management
- `list_database_connections`: List all connected databases for the authenticated user.
- `test_database_connection`: Tests network reachability, SSRF safety, and MySQL handshake.
- `save_database_connection`: Persists an encrypted database profile with tenant ownership.
- `delete_database_connection`: Safely removes a connection profile (does NOT drop customer DB).

### Schema Intelligence & Discovery
- `scan_database_schema`: Triggers live introspection of tables, columns, constraints, and foreign keys.
- `get_schema_details`: Retrieves table profiles, data types, nullability, and primary/foreign keys.
- `annotate_table_profile`: Annotates workspace notes and eligibility tier overrides for a table.
- `detect_schema_drift`: Compares live customer database against latest stored baseline snapshot (`FEATURE_SCHEMA_DRIFT`).

### Automation Management
- `list_automations`: Lists all configured automated publishing pipelines.
- `get_automation_details`: Inspects target table, operation mode, schedule, lead time, and deadline policy.
- `create_automation`: Configures a new automation definition with verified 30+ min lead time.
- `update_automation`: Updates scheduling parameters, reviewer settings, or deadline policy.
- `toggle_automation`: Enables or pauses an automation without destroying its configuration.
- `propose_automation_plan`: Generates an intelligent mapping plan based on discovered table profiles.
- `create_from_template`: Instantiates an automation from predefined blueprints (`FEATURE_TEMPLATES`).

### Content Generation & Simulation
- `generate_content`: Triggers real structured AI generation using live schema constraints and RAG passages.
- `simulate_dry_run`: Simulates end-to-end execution, field mappings, and novelty checks with zero DB writes (`FEATURE_DRY_RUN`).
- `evaluate_content_quality`: Computes Flesch-Kincaid ease, grade, SEO metrics, and factual grounding (`FEATURE_QUALITY_SCORE`).
- `check_content_novelty`: Evaluates candidate titles against recent publications via semantic embeddings.

### Approvals & Review
- `list_pending_approvals`: Lists drafts awaiting review with single-use cryptographic tokens.
- `review_content_version`: Records approval or rejection with feedback for automated revision.
- `publish_approved_execution`: Atomically publishes an approved draft to the target MySQL database.

### Compensation & Operational Safety
- `compensate_execution`: Safely rolls back a published execution within a 24-hour window (`FEATURE_UNDO_CENTER`).
- `get_calendar_events`: Retrieves scheduled publications and execution history (`FEATURE_CONTENT_CALENDAR`).
- `reschedule_automation`: Reschedules publishing deadline enforcing 30-minute lead time policy.
- `get_database_insights`: Safe read-only metrics and 30-day velocity analytics (`FEATURE_DB_INSIGHTS`).

### Knowledge Base & AI Providers
- `list_knowledge_documents`: Lists indexed RAG sources (Markdown, TXT, PDF).
- `delete_knowledge_document`: Deletes document and re-indexes FAISS vector store.
- `list_ai_providers`: Lists configured AI providers (Ollama local inference, OpenAI, Gemini, Claude).
- `test_ai_provider`: Tests provider reachability and model availability.
- `list_model_roles`: Lists specialized model role assignments (planner, generator, classifier, summarizer).
- `update_model_role`: Reassigns specific tasks to different models or providers.

---

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
