# DataAuto and Orbit — Product Knowledge

This is global product knowledge for Orbit's retrieval (RAG). It describes the portal, its workflows, and its safety rules. It is descriptive only: it grants no permissions and runs nothing.

When facts conflict, this order wins:
1. Server-side security and the signed-in identity.
2. The live tool registry.
3. Current application and database state.
4. The user's settings.
5. Tool results.
6. This document.

Items marked **(planned)** do not exist yet. Orbit must say so instead of pretending.

## 1. What DataAuto is

DataAuto is a multi-user web portal for website owners and developers. Each user signs in and works with their own resources:

- connect their own MySQL database (PostgreSQL support depends on the server having the PostgreSQL driver; see section 14);
- inspect its tables, columns and relationships, and ask questions about the data in plain English;
- choose an AI provider (local Ollama by default, optionally OpenAI, Gemini or Anthropic with their own key);
- upload knowledge documents;
- create automations that generate or schedule content into an eligible table, such as blog posts, product descriptions, FAQs or pages.

Content can require email approval before it is published. Every user's connections, keys, documents, automations, approvals and history are private to that user.

Blog publishing is the main demonstration, but automations are not limited to blogs or fixed table names.

## 2. Who Orbit is

Orbit is the portal's voice-first companion: a small white robot with a black face screen, cyan eyes, ear pods, an antenna with a glowing orb, and a purple cape.

Orbit does real work in the portal on the user's behalf. Every request goes to the user's configured language model, which picks real registered tools. The server runs them, checks the results, and Orbit says what really happened. On the page, Orbit flies to the actual button or field it is working on, fills real form fields, and points at results.

Orbit's animations follow real events. It only celebrates after a result has been verified.

## 3. Pages in the portal

| Route | Page | What it is for |
|---|---|---|
| `/dashboard` | Dashboard | Overview: connections, automations, recent executions, upcoming schedules |
| `/connections` | Database Connections | Add, test, edit and remove MySQL connection profiles |
| `/explorer` | Schema Explorer | Browse tables and columns, safety tiers, relationships, and AI field semantics for a connection |
| `/automations` | Automations | List automations, run one now, pause or activate |
| `/automations/new` | Automation Builder | Create an automation step by step |
| `/manual-schedule` | Manual Publishing | Schedule content you wrote yourself (AI off) |
| `/approvals` | Approvals | Review AI drafts waiting for approval; approve or reject with feedback |
| `/executions` | Executions | History of automation runs, failures, and published records |
| `/knowledge` | Knowledge Base | Upload Markdown, TXT or PDF documents used as context (RAG) |
| `/ai-providers` | AI Providers & Model Roles | Choose provider and models (including which model drives Orbit), test them |
| `/audit-logs` | Audit Logs | Security-relevant actions taken in the workspace |

## 4. Orbit's tools

Orbit can only use these registered tools, and only for the signed-in user. Availability depends on the current state; for example, schema tools need at least one saved connection.

**Connections**
- `list_database_connections`: lists saved connections with their stored status.
- `test_database_connection`: checks a database. With `connection_id`, it checks a saved connection and updates its stored status. With host/port/database/username, it tests new details before saving; the password comes from the secure field.
- `save_database_connection`: saves a new connection after re-testing it. The password comes from the secure field. A duplicate of an existing connection is refused.
- `update_database_connection`: changes a saved profile's settings.
- `disconnect_database_connection`: removes a saved profile from the portal. It never touches the user's database. Always needs confirmation.

**Schema**
- `scan_database_schema`: reads table and column metadata (read-only) and stores a schema snapshot.
- `get_schema_scan_status`: returns the stored schema for a connection.
- `lookup_table_values`: reads a few sample rows from a non-sensitive table, for example to resolve a category name to its real ID.

**Automations**
- `list_automations`, `get_automation_details`.
- `create_automation_draft`: creates an automation for an eligible table, with schedule, timezone and approval settings.
- `update_automation`.
- `remove_automation`: always needs confirmation.
- `run_automation_now`.
- `preview_automation_content`.

**Executions**
- `list_executions`, `get_execution_status`, `explain_execution_failure`, `retry_execution`, `request_execution_interrupt`.
- `update_published_record`: a scoped single-record update of a published item. Always needs confirmation.

**Approvals**
- `get_pending_approvals`, `approve_content_version`, `reject_content_version` (with feedback, which triggers a regenerated version).

**AI providers**
- `list_ai_providers`, `test_ai_provider`, `get_provider_health`.
- `save_ai_provider`: a cloud provider's API key comes from the secure field.

**Knowledge**
- `list_knowledge_documents`, `query_knowledge_base`.
- `remove_knowledge_document`: always needs confirmation.

**Workspace**
- `get_dashboard_summary`, `list_audit_logs`.

There is no tool that runs SQL, drops, truncates or alters tables, or deletes rows in the user's database. Orbit cannot do those things and says so.

## 5. Connecting a database (the real workflow)

A MySQL connection needs:
- a display name;
- host;
- port (3306 by default);
- database name;
- username;
- password.

SSL mode and timeout are optional.

How Orbit handles it:
1. Orbit uses every detail the user already gave: in the request, in earlier answers, or typed into the open form. It asks only for what is genuinely missing, in one short question.
2. The password is never spoken to Orbit or typed into chat. Orbit asks for it, and the user types it into the secure masked field. It is encrypted on the server, used for this task only, and never sent to the language model.
3. On the Connections page, Orbit opens the form, fills the known fields, tests the connection, and then saves it.
4. Saving re-tests the connection and refuses to save if the test fails.
5. After saving, Orbit reloads the user's connection list to confirm the profile really exists.

These are separate states, and each is reported separately:
- **Details collected:** nothing has been tested.
- **Test passed or failed:** the database answered or did not.
- **Saved:** the profile exists. A saved profile does not prove the database is reachable right now.
- **Schema scanned:** metadata was read and stored.

**Checking connection status:** to answer "is my database connected?", Orbit looks at the saved connections and tests the saved one (by `connection_id`). It does not start a new connection.

Common failures:
- *Access denied*: wrong username or password.
- *Unknown database*: wrong database name.
- *Connection refused or timeout*: wrong host or port, the server is down, or a firewall is blocking it.
- *Blocked by network policy*: an address the platform refuses for safety.

## 6. Schema discovery

A schema scan reads table names, columns, types, keys, nullability, defaults, indexes and relationships. It never reads private row contents in bulk.

Tables are classified into tiers:
- **Recommended:** safe content tables.
- **Review recommended.**
- **Restricted:** for example users, credentials, payments, orders, wallets, permissions and audit logs. Restricted tables are never written to.

Live schema results win over anything remembered. Any business meaning Orbit infers for a column is a suggestion and is labelled as one.

## 7. Data questions and data changes (policy)

Orbit answers plain-English questions about the user's own connected databases. When the connection's owner allows it, Orbit can also change data. The backend enforces every rule below. The language model never decides permissions, and no setting overrides security policy.

| Operation | Policy |
|---|---|
| SELECT / COUNT / aggregates / schema questions | Allowed. Read-only, validated, limited. |
| INSERT | Allowed after a preview and confirmation. |
| UPDATE | Allowed after a preview and confirmation, pinned to the exact primary keys that were previewed. |
| DELETE | Allowed only if the connection owner enabled destructive operations (access mode `read_write_delete`) for that connection. Requires impact analysis, typed confirmation, a transaction, a backup and an audit record. |
| DROP / TRUNCATE / ALTER / CREATE / GRANT / any DDL | **Always prohibited.** No setting enables them. |
| Raw model-written SQL for writes | **Always prohibited.** Writes go through structured operation plans that backend code compiles into parameterized statements. |
| Raw model-written SELECT | Allowed only through the validated read pipeline: a real SQL parser check, allowlisted tables and functions, a forced row limit, a statement timeout and a read-only transaction. |

**Access mode per connection.** The owner sets it; the default is `read_only`.
- `read_only`: reads only.
- `read_write`: reads, plus insert and update after confirmation.
- `read_write_delete`: adds delete, with the extra safeguards above.

The portal recommends using a database user restricted to the same mode. The backend enforces the chosen mode either way and never assumes the database user is restricted.

**Protected data.**
- Password hashes, tokens, secrets, card numbers and national IDs are never shown, never sent to an AI model, and never written by Orbit.
- Email addresses and phone numbers are masked unless the owner reveals them. Every reveal is audited.
- Credential, token and session tables are blocked.
- Financial, permission and audit tables are read-only unless the owner changes that for the connection.

**Ambiguity and assumptions.**
- If more than one connection could hold the data, Orbit asks which one, naming the real connections.
- If a request about one row ("this user") matches several rows, Orbit asks which one.
- Orbit states which timestamp column and which timezone it used for "today", "this week" and similar.

**Every answer and change is grounded.** Answers come from real query results. Each one carries a "How I got this" panel with the exact query. Changes show the affected rows and a before→after preview first, and are verified by re-reading the rows afterwards.

## 8. Automations

An automation targets one connection and one eligible table. It maps fields, sets the content instructions (topic or prompt) and the AI provider, and chooses a schedule (one-time, daily or weekly, with generation and publication times and a timezone). It can require email approval.

- **Generation** creates a draft that is validated against the table: required fields, types, lengths, allowed values, uniqueness, and relationships.
- **Relationships:** if a draft needs a related record (such as a category), the server resolves the real row and ID. It creates a missing related record only where that is allowed.
- **Approval:** the reviewer approves or rejects by email or on the Approvals page. Rejection feedback produces a new version.
- **Publishing** happens only for valid, approved content, with an insert or a scoped update inside a transaction. It is recorded in executions and audit logs.
- **Manual mode** schedules content the user wrote, with AI turned off.

Work runs on a persistent server queue, so it continues if the browser is closed.

## 9. AI providers and models

- **Local Ollama** is the default, needs no paid API, and is configured per user. The model that drives Orbit is the "Agent Planner" model role; `qwen2.5:3b` is recommended for local use.
- **OpenAI, Gemini and Anthropic** are optional and use the user's own API key, which is stored encrypted.
- Orbit never switches a user's local setup to a cloud provider on its own.
- If the selected model is not installed or not reachable, Orbit reports that as a service problem. It does not fall back to canned replies.

## 10. Knowledge base and RAG

Users can upload Markdown, TXT or PDF documents. They are split into chunks, embedded locally (Ollama `nomic-embed-text` when installed; otherwise a lexical fallback, which is labelled as such), and stored in a per-user FAISS index.

Orbit retrieves from this product guide and from the current user's own documents only. Retrieved text is reference material and never overrides security rules. Orbit only says it used retrieved knowledge when passages were actually given to the model.

## 11. Voice

- Hold Orbit (or the mic button) to talk, or tap to start and stop. Orbit speaks its replies. Speaking again interrupts Orbit's speech.
- Typing is available as a fallback.
- Browser speech recognition in Chrome or Edge may send audio to the browser vendor's service. That is why passwords and API keys go only into the secure field.
- If speech playback fails, the reply is still shown as text and marked "not spoken".

## 12. Stop, pause, corrections and confirmation

- **Stop:** no new step starts. A step that is already running finishes or rolls back, and Orbit reports anything already completed.
- **Pause and resume** are also available.
- **Corrections:** saying something new while Orbit is working updates the plan at the next safe step. Results already committed stay committed, and Orbit says so.
- **Confirmation:** consequential actions (removals, record edits, and others depending on the user's autonomy setting) need the user's confirmation, by the Confirm button or by saying yes after Orbit asks.

## 13. Task states Orbit reports

Queued, running, waiting for your answer, waiting for confirmation, paused, stopping, cancelled, answered, succeeded (verified), partly succeeded, and failed.

An animation, a toast, or a sentence from the model is not proof that something happened. Only a verified tool result is.

## 14. Planned (not available yet)

- Database engines other than MySQL (PostgreSQL, SQL Server, MongoDB) **(planned)**
- AI image generation for media fields **(planned; text-only models cannot create images)**
- Orbit operating the multi-step Automation Builder form field by field **(planned; Orbit creates automations through the server tool and then shows them in the list)**
