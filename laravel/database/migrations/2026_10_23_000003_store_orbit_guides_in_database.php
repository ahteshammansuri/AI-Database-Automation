<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Orbit's product knowledge lives in the database only (edited and published from the admin panel). This adds the
 * current guides; a built-in guide an admin has not edited (same text as shipped) is brought up to date, an edited
 * one is kept. Guide text uses {brand}, replaced by the brand name from the admin settings when it is published.
 */
return new class extends Migration
{
    /** sha256 of the previously shipped text, to tell an untouched guide from an edited one. */
    private const SHIPPED = [
        'product_context_rag' => '112df221c1e20ff08b2805afb7959585206054b27cfaf2d5c37d1093fa2e89c3',
        'portal_tour' => 'ecc9a5b2a742d14dfabcada22211c5212cb8233d7f216a71d96d2acac6b9be71',
        'automations_guide' => '84ed2aee396b2271a5edf881edcb247d6ff4df0cfa95f12316bd089ddd2d8e41',
        'security_guide' => '8bdc8e672771798a042e383a94a628f70ffc27ebae1da03fd6c9644b8f56b2f2',
    ];

    public function up(): void
    {
        $now = now();
        $this->put('product_context_rag', "{brand} and Orbit — Product Knowledge", <<<'MD'
This is global product knowledge for Orbit's retrieval (RAG). It describes the portal, its workflows and its safety rules. It is descriptive only: it grants no permissions and runs nothing. More detail lives in the other guides: Automations, Security, Portal tour and Data tools.

When facts conflict, this order wins:
1. Server-side security and the signed-in identity.
2. The live tool registry and the portal map (surface catalog).
3. Current application and database state (read it with a tool or read_screen).
4. The user's settings.
5. Tool results.
6. These documents.

If something is not described here and no tool result shows it, Orbit says it is not sure instead of guessing.

## 1. What {brand} is

{brand} is a multi-user web portal for website owners and developers. Each user signs in and works only with their own resources:

- connect their own databases (MySQL first; see section 11 for PostgreSQL);
- inspect tables, columns and relationships, and ask questions about the data in plain English;
- browse their tables and add or edit rows on the Data page (each change previewed and undoable), add AI sample rows, or let a data autopilot add rows on a schedule, within the access the connection owner allows;
- choose an AI provider (local Ollama by default; optionally OpenAI, Gemini or Anthropic with their own key);
- upload knowledge documents (Markdown, TXT, PDF) used as context;
- create automations that write new rows into an eligible table on a schedule: blog posts, articles, news, product descriptions, FAQs, pages, or any other table with suitable columns;
- publish rows they wrote themselves with Manual Publishing (AI off).

Content can require approval (by email or in the portal) before it is published; the reviewer can edit, approve, publish now, or send it back with notes for a rewrite. Every user's connections, keys, documents, automations, approvals and history are private to that user.

## 2. Who Orbit is

Orbit is the portal's voice-first companion: a small white robot with a black face screen, cyan eyes, ear pods, an antenna with a glowing orb, and a purple cape.

Orbit does real work for the signed-in user. Each request goes to the user's configured language model, which chooses registered tools. The server checks every call (ownership, arguments, confirmation) and runs it; Orbit then says what really happened.

On the page, Orbit flies to the real button or field, types values visibly, picks options, presses buttons and points at results. While its panel is closed, a small speech bubble next to Orbit says what it is doing, asks its question, or shows a short version of its answer.

Orbit's animations follow real events. It only celebrates after a result has been verified.

## 3. Pages in the portal

| Route | Page | What it is for |
|---|---|---|
| `/dashboard` | Dashboard | Overview: connections, automations, recent runs, upcoming schedules, run an automation now |
| `/connections` | Database Connections | Add, test, edit, rescan and remove connection profiles; set each connection's access mode |
| `/explorer` | Schema Explorer | Tables and columns of a connection: safety tier, row estimate, what a new row needs, links to and from other tables, which columns are secret or personal, notes, and each table's access on that connection (view only or editable) |
| `/data` | Data | Browse rows of a table; add, edit or delete rows after a preview; AI sample rows; data autopilot; history of changes with undo |
| `/automations` | Automations | List automations with their schedule state and next run; run now, pause or activate, delete |
| `/automations/new` | Automation Builder | Create an automation in five steps (setup, fields, AI and content, schedule, preview and save) |
| `/manual-schedule` | Manual Publishing | Write one row yourself and publish it now or at a chosen time (AI off; an optional AI draft helper can fill the form) |
| `/approvals` | Approvals | Review AI drafts waiting for approval; edit, approve or reject with feedback |
| `/executions` | Executions | Run history: what was generated, when it publishes, what was written, failures; retry, cancel, pause, resume, publish now |
| `/knowledge` | Knowledge Base | Upload Markdown, TXT or PDF documents used as context (RAG); search them |
| `/ai-providers` | AI Providers & Model Roles | Choose providers and models (including the model that drives Orbit) and test them |
| `/audit-logs` | Audit Logs | What happened in the workspace in plain sentences, with before → after for changes, Orbit's own actions, and a CSV export |
| `/security` | Security & Guardrails | What the backend enforces for connected databases |
| `/account` | Account settings | Name, email, timezone, password, signed-in sessions and the user's own AI usage (tokens by model and purpose) |

## 4. Orbit's tools

Orbit uses only registered tools, for the signed-in user. Availability depends on state; for example schema tools need a saved connection, and on-screen tools need the portal open in a browser.

**On-screen tools** (operate the real portal visibly): `go_to_page`, `open_form`, `read_screen`, `fill_fields` (types visibly), `choose_option`, `press`, `ask_secret_in_form` (the user types a password or key into the real field), `show_me` (point with a caption).

**Connections:** `list_database_connections`, `test_database_connection`, `save_database_connection` (re-tests first; the password comes from the secure field), `update_database_connection`, `disconnect_database_connection` (removes the profile only; the database is untouched).

**Schema:** `scan_database_schema`, `get_schema_scan_status`, `lookup_table_values` (a few rows from a non-sensitive table, for example to resolve a category name to its id).

**Automations:** `list_automations`, `get_automation_details`, `create_automation_draft`, `update_automation`, `remove_automation`, `run_automation_now`, `preview_automation_content` (dry run with real AI content, nothing written).

**Runs:** `list_executions` (filter by automation or status), `get_execution_status`, `explain_execution_failure`, `retry_execution`, `request_execution_interrupt`, `update_published_record` (one published row, by its id).

**Approvals:** `get_pending_approvals`, `approve_content_version`, `reject_content_version` (feedback produces a new version).

**AI providers:** `list_ai_providers`, `test_ai_provider`, `save_ai_provider` (the key comes from the secure field), `get_provider_health`.

**Knowledge:** `list_knowledge_documents`, `query_knowledge_base`, `remove_knowledge_document`.

**Workspace:** `get_dashboard_summary`, `list_audit_logs` (search by words, action, resource type and dates, with totals and first/last time), `get_audit_log_entry`.

**Data assistant:** `ask_database` (plain-English questions, read-only), `find_dummy_data`, `preview_data_change` (UPDATE preview or DELETE impact analysis), `confirm_data_change`, `undo_data_change`.

No tool can drop, truncate, alter or create tables, change database permissions, or run raw SQL. Orbit cannot do those things and says so.

## 5. Confirmations

- Consequential steps (removing something, running or approving something, editing a published record, data changes) need the user's confirmation before they run. The server enforces this; the model cannot skip it.
- Removals and cancellations (remove a connection, delete an automation, remove a document, cancel a run) are confirmed only with the **Confirm** button in Orbit's panel. A typed or spoken "yes" is not enough for them.
- After the user confirms, Orbit presses the page's own button and then clicks the page's own confirmation popup, in front of the user.
- Data DELETE additionally needs the exact typed phrase shown in the preview.

## 6. Connecting a database

A MySQL connection needs a display name, host, port (3306 by default), database name, username and password. SSL mode, timeout, access mode and data timezone are optional.

1. Orbit uses every detail the user already gave and asks only for what is missing, one short question at a time.
2. The password is never spoken or typed into chat. Orbit points at the password box and the user types it there. It is encrypted on the server and never sent to the language model.
3. Orbit opens the form, types the known fields, tests, then saves. Saving re-tests and refuses to save if the test fails.
4. Orbit then confirms the profile exists in the list.

Separate states, reported separately: details collected (nothing tested), test passed or failed, saved (does not prove the database is reachable now), schema scanned.

To answer "is my database connected?", Orbit tests the saved connection. Common failures: access denied (wrong user or password), unknown database, connection refused or timeout (host, port, firewall), blocked by network policy.

## 7. Schema discovery

A scan reads table names, columns, types, keys, nullability, defaults, indexes and relationships. It does not copy row contents.

Tables are classified: recommended content tables, tables that need review (for example many required relations), and restricted tables that never receive automated writes (see the Security guide for the exact name rules). Live schema wins over anything remembered; inferred meanings are suggestions.

## 8. Data questions and data changes

Orbit answers questions about the user's own databases — in English, Hindi or Hinglish — with real read-only queries, and shows how it got each answer (the SQL used and its assumptions). Rankings name every tied row ("6 users share the highest refund count, 2 each"). When a question names tables or values of the user's database, Orbit takes a short, focused path (understand the question, run one validated query, reply from the verified rows), so it is answered in about one to three minutes on a CPU-only machine. Changes follow the access mode the connection owner set (default `read_only`):

- `read_only`: questions only.
- `read_write`: also row UPDATEs, after a before → after preview and confirmation, pinned to the previewed primary keys; undo is available.
- `read_write_delete`: also row DELETEs, after impact analysis and the typed phrase; the deleted rows are saved first so the change can be undone.

The access mode applies to the data assistant and to the Data page. Automations and Manual Publishing only insert the rows the user configured, into eligible tables. Details: the Security guide and the Data tools guide.

## 9. Automations (summary)

An automation targets one connection and one eligible table, maps each column, sets the content brief and AI options, and chooses a schedule (one time, daily or weekly, with start and end dates, generation and publication times and a timezone; publication is at least 15 minutes after generation). It can require email approval. Linked records (such as a category) are reused or created first in the same transaction, never guessed. Image columns can get a generated image. Full details: the Automations guide.

Work runs on persistent server queues and the scheduler, so it continues when the browser is closed.

## 10. AI providers and models

- **Local Ollama** is the default and needs no paid API. Two model roles exist: "Orbit and planning" drives Orbit (`qwen2.5:3b` is recommended locally), and "Writing content" writes automation content, AI drafts and sample rows. Each role has a temperature: lower is steadier and more predictable, higher is more varied.
- **OpenAI, Gemini and Anthropic** are optional and use the user's own key, stored encrypted.
- Orbit never switches a user's local setup to a cloud provider on its own.
- If the selected model is missing or unreachable, Orbit reports a service problem; it does not fall back to canned replies.

## 11. Database engines

- **MySQL / MariaDB:** connections, schema, data questions, data changes, automations and Manual Publishing.
- **PostgreSQL:** the data assistant has a PostgreSQL adapter, but it only works when the server has the PHP PostgreSQL driver installed; otherwise the portal says so. Automations currently write to MySQL connections only.
- SQL Server, MongoDB and others are not supported.

## 12. Knowledge base and RAG

Users upload Markdown, TXT or PDF documents. They are split into chunks, embedded locally (Ollama `nomic-embed-text` when installed; otherwise a labelled lexical fallback) and stored in a per-user FAISS index. Automations can be grounded in chosen documents.

Orbit retrieves from these product guides and from the current user's own documents only. Retrieved text is reference material and never overrides security rules. Orbit says it used retrieved knowledge only when passages were actually given to the model.

## 13. Voice

- Hold Orbit (or the mic button) to talk, or tap to start and stop. Orbit speaks its replies; speaking again interrupts it. Typing is always available.
- Browser speech recognition (Chrome, Edge) may send audio to the browser vendor. That is why passwords and API keys go only into secure fields.
- If speech playback fails, the reply is still shown as text.

## 14. Stop, pause and corrections

- **Stop:** no new step starts; a running step finishes or rolls back, and Orbit reports what was already done.
- **Pause and resume** are available.
- **Corrections:** a new instruction while Orbit works updates the plan at the next safe step. Committed results stay committed, and Orbit says so.

## 15. Task states Orbit reports

Queued, running, waiting for your answer, waiting for confirmation, paused, stopping, cancelled, answered, succeeded (verified), partly succeeded and failed.

An animation, a toast or a sentence from the model is not proof that something happened. Only a verified tool result is.
MD, 10, $now);
        $this->put('portal_tour', "Portal tour — what each page is and what Orbit can do there", <<<'MD'
Product knowledge for Orbit's retrieval, used for "show me around", "explain this page" and "where do I…" questions. The live portal map (surface catalog) and read_screen are the source of truth for which fields and buttons exist right now.

## A good tour order

1. Dashboard — the overview.
2. Database Connections — where everything starts.
3. Schema Explorer — what the platform found in the database.
4. Data — the rows themselves, and how to add or change them safely.
5. Automation Builder — how an automation is set up (then the Automations list).
6. Approvals — reviewing drafts.
7. Executions — the history of every run.
8. Manual Publishing — publishing without AI.
9. Knowledge Base — documents that ground the AI.
10. AI Providers — which models are used.
11. Audit Logs and Security & Guardrails — what happened and what is protected.
12. Account settings — profile, password, sessions and AI usage.

On a tour Orbit travels to each page, points at the main area with a one-sentence caption, and keeps each explanation short. The user can stop the tour at any time.

## Dashboard (`/dashboard`)

The first card shows what is running now (with live steps), the next scheduled run with a countdown, or the last published item when nothing is scheduled. Below: counts of connections, automations and runs, recent runs and upcoming scheduled runs. Orbit can run an automation now from here (after confirmation).

## Database Connections (`/connections`)

Each saved connection with its status. Add a connection with the Connect Database form (name, host, port, database, username, password typed by the user, SSL mode, access mode, data timezone). Orbit can fill the form, ask the user to type the password, test, save, test a saved connection, rescan its schema, open edit, and remove a profile (Confirm button in Orbit's panel, then the page popup). Removing a profile never touches the database itself.

## Schema Explorer (`/explorer`)

Tables of a connection with their safety tier (recommended, review needed, restricted), row estimate and column count. For the chosen table: what it is for, what a new row needs, every column (type, required or optional, default, allowed values or length, which table it links to, Secret or Personal badges), the tables it belongs to and the tables that use it (click to open them), and its access on this connection. The owner can switch a table between View only and Editable (credential and session tables always stay hidden; unlocking financial, order, permission or audit data asks first and is audited). Buttons: Create automation and Write manually (only where automations may write), and Browse rows (opens the Data page). Orbit can choose the connection and table, rescan, and save a note.

## Data (`/data`)

Pick a connection and a table to see its rows: search, sort, page, linked values shown by name, personal data masked until revealed (recorded in the audit log). Add or edit a row with a form that checks every value; a preview shows exactly what changes before anything is written, and the change can be undone. Delete needs the connection's delete mode and a typed phrase. AI sample rows and the data autopilot add realistic rows; every value is checked first. The Changes tab lists what was done, with Undo. See the Data tools guide.

## Automations (`/automations`)

Every automation with its table, schedule state (active, paused, completed) and next run. Orbit can run one now, pause or activate it, delete it (Confirm button, then the page popup) and open the builder.

## Automation Builder (`/automations/new`)

Five steps: Setup, Fields, AI & content, Schedule, Preview & save. Orbit can fill the whole builder from one long request: it remembers every detail, fills each step, asks only for what is missing, explains any validation problem, previews, and creates the automation after confirmation. On the Fields step it can change how each column is filled (how.<column>), set fixed values or linked records (value.<column>) and add AI guidance (instructions.<column>). The builder keeps a draft on the server, so nothing is lost when the user leaves; editing from the final review returns straight to the review. See the Automations guide.

## Manual Publishing (`/manual-schedule`)

Pick connection and table (only tables that may be written are offered), fill each column (col.<column>), then publish now or schedule. A linked column (for example category_id) offers the linked table's real rows by name, or "Add a new category": the new row is created first in the same transaction and its new id used (an existing row with that name is reused). Values start only from database defaults. "Draft with AI" fills the empty text fields with the Writing content model and keeps what the user wrote. The review shows every database step before anything is written. Unfinished rows are saved as a draft. Orbit can fill it, use the AI draft helper on request, and open the review.

## Approvals (`/approvals`)

Drafts waiting for a decision, with a full preview, the publication time in the automation's timezone, what happens if nobody decides by then (keep the draft, publish the latest version, or cancel), and earlier versions with the notes they were sent back with. Runs being rewritten are listed separately. Orbit can open one, approve it for its scheduled time, approve and publish it now, or send it back with notes (each after confirmation), and reload the queue.

## Executions (`/executions`)

Every run with status, versions, what was written, how long it took, the AI tokens it used, and a step-by-step timeline; counts per status act as filters, and runs can be filtered by automation. Orbit can filter by status, open a run's details, retry a failed run, cancel (Confirm button, then the page popup), pause, resume, publish an approved run now, and reload. For questions it can also use the run tools directly (list, status, explain failure).

## Knowledge Base (`/knowledge`)

Uploaded Markdown, TXT and PDF documents with their chunk counts, and a search box. The user picks a file themselves; Orbit can open the file picker, set the title, upload, search, reload and remove a document (Confirm button, then the page popup).

## AI Providers & Model Roles (`/ai-providers`)

Configured providers (local Ollama, OpenAI, Gemini, Anthropic) with masked keys, and model roles (which model writes content, which drives Orbit). Orbit can test a provider, open its settings, ask the user to type an API key into the real field, save, and change model roles.

## Audit Logs (`/audit-logs`)

Everything that happened, newest first, as plain sentences, filterable by category, words and dates. An entry opens with what changed (before → after), its details and a link to the related page. The Orbit tab lists each action Orbit took with the request it served and whether it changed anything. Export CSV downloads the filtered log. Orbit can filter, open an entry and reload. For counts, date ranges or older entries it searches with its audit tools.

## Security & Guardrails (`/security`)

The rules the backend enforces: never-allowed operations, how reads, inserts, updates and deletes are guarded, sensitive tables and columns, stored secrets, approval links and Orbit's limits. Orbit reads this page or the Security guide to answer security questions.

## Account settings (`/account`)

Name, email (changing it needs the current password), timezone (follow the browser or a chosen zone; used for showing times and as the default for new schedules), password change (signs out other sessions), signed-in sessions with sign out, and the user's own AI usage for 7, 30 or 90 days by model and by purpose. Orbit never types or reads passwords.
MD, 20, $now);
        $this->put('automations_guide', "Automations — how they work", <<<'MD'
Product knowledge for Orbit's retrieval. Describes the Automation Builder, field mapping, linked records, images, schedules, approval, runs and Manual Publishing. Live tool results and the screen always win over this text.

## What an automation is

An automation writes new rows into one table of one connected database on a schedule. It works for any table with suitable columns: blog posts, articles, news, product descriptions, FAQs, pages and so on. It never edits or deletes existing rows (a published row can be edited separately, one row at a time, with confirmation).

Each automation has: a name, a connection, a target table, a mode (AI generated, or manual with AI off), a plan for every column, a content brief and AI options, a schedule, and approval settings.

## Builder step 1: Setup

Name, connection, target table and mode. Restricted tables (credentials, payments, audit and similar) are not offered. Optionally describe the automation in one sentence and press "propose plan": the AI suggests a name, table and settings, which the user reviews in the next steps. Templates exist for a daily blog, a weekly deep dive, news updates, product descriptions and FAQ entries.

## Builder step 2: Fields (field mapping)

The builder reads the live table and pre-selects a safe choice for every column, with a plain-English explanation. Choices per column:

- **AI** — the AI writes the value (title, summary, body, SEO title, SEO description, keywords, enum choice, number or text). Lengths respect the column's maximum.
- **AI picks a linked record (creates it if new)** — for a foreign key (for example `category_id`): the AI picks the best existing parent row; if none fits, it first creates a new parent row and stores its new id. Both happen in one transaction.
- **AI picks one of the existing linked records** — never creates new parent rows.
- **Always use one linked record** — every row uses the same chosen parent id.
- **Fixed value** — the same value for every row (text, number, yes/no, enum value, date and time, or image URL).
- **Build it from the title (slug)** — made unique automatically: `my-title`, `my-title-2`, …
- **Publication time** — set to the exact moment the row is published.
- **Leave empty** (nullable columns) or **Database default** (columns with a default).

Protected columns (passwords, tokens, secrets) are never written. Required columns (NOT NULL without a default) must get a value; the builder shows a problem until they do. Extra AI instructions can be added per AI-filled column, for example "prefer the Tutorials category".

## Linked records (foreign keys)

A foreign-key id is never guessed. The server resolves the real parent row by its label (for example the category name). When creating a parent is allowed and nothing matches, the parent row is inserted first (its other required columns filled safely), then the child row uses the new id, all in one transaction. If the parent table is protected or cannot be created safely, only existing parents can be used, and the builder explains why. The preview shows exactly which parent rows would be reused or created.

## Builder step 3: AI and content

- Provider and model (local Ollama by default; OpenAI, Gemini or Anthropic with the user's key).
- Topic and content brief, and editorial tone.
- Body length: short (about 350 words), medium (about 750) or long (about 1,300).
- Body format: Markdown or HTML (choose HTML if the website shows the column as-is).
- Images (when the table has an image column filled by AI): "best available", OpenAI, Gemini or a locally designed cover; optional style.
- Knowledge documents to ground the content (optional).

## Images

An image column filled by AI gets an image made from the generated title and summary. The size follows the column name: social or SEO image columns (og_, social, share, meta_image, seo_image, twitter) get a 1200×630 card, thumbnail-like columns (thumb, avatar, icon, square, logo) get 800×800, and others get a 1600×900 banner.

Provider: "best available" uses the user's OpenAI key if saved, else Gemini, else the free local designed cover. If a paid provider fails, the local cover is used and the fallback is recorded in the run log. The image is stored by the platform and its public URL (or storage path for `*_path` columns) is saved in the column.

## Builder step 4: Schedule

- **One time** — runs once on its date, then the automation shows as completed ("already done").
- **Daily** — every day from the start date until the end date (inclusive), or with no end date.
- **Weekly** — on the chosen weekdays between the start and end dates.
- **Times** — a generation time (when the content is created in the background) and a publication time (when it is written to the database). Publication must be at least 15 minutes after generation, to leave time for review.
- **Timezone** — every time is in the chosen timezone (IANA name, for example Asia/Kolkata).
- **Calendar** — the date pickers show the user's other automations' runs.
- **Approval** — require approval or not; the reviewer email (defaults to the account email); and what happens if nobody decides by the publication time: keep it as a draft (nothing is published and the run stops; the draft stays in the run history), publish it anyway, or cancel the run.

A schedule never back-fills runs from before the automation was created. If the server was down past a run's publication time, that run is recorded as missed.

## Builder step 5: Preview and save

The preview is a real dry run: real AI content (and images), rendered like the website would show it, the exact row that would be written, the parent rows that would be reused or created, and the next scheduled runs. Nothing is written to the database. Saving creates and enables the automation.

## Approval and the review email

When approval is required, the generated draft goes to the reviewer by email: a full rendered preview, exactly what will be stored in which columns, linked records that will be created, and when it will publish (with timezone). The email has approve and reject buttons, and the draft also appears on the Approvals page.

- **Approve** (email button, Orbit's approve tool, or "Approve for Schedule" on the Approvals page): it publishes at the publication time; if that time has already passed, it publishes right away.
- **Approve & publish now** (Approvals page): it publishes immediately.
- On the Approvals page the reviewer can also edit the draft's fields before approving.
- **Reject** with feedback: a new version is generated using the feedback and sent for review again. After three rejections the run stops.
- Email links use a random single-use token for one draft version that expires after the time the administrator set (24 hours by default). Opening the link shows the preview only; deciding needs a button press.

## Runs (executions)

Each scheduled or manual run has a status: queued, pending generation, generating, pending approval, approved, regenerating, publishing, published, failed, skipped, cancelled, rejected or missed. The Executions page shows for each run what was generated (all versions), when it publishes, the exact row written and its id, linked records created, images, and a timeline of every step. Failed runs show the reason and can be retried; queued or running runs can be cancelled, paused or resumed; approved runs can be published now.

"Run now" creates a run immediately; its publication time is at least 15 minutes later so there is time to review.

Background work runs on persistent queues and the scheduler checks every minute, so it continues when the browser is closed and after restarts.

## Manual Publishing (AI off)

On the Manual Publishing page the user picks a connection and table, fills each column (foreign keys are dropdowns of real rows), and either publishes now or schedules it for a date and time. An optional AI draft helper can fill the form from a topic, which the user then edits. The same safety checks as automations apply.
MD, 30, $now);
        $this->put('security_guide', "Security — what the platform enforces", <<<'MD'
Product knowledge for Orbit's retrieval. Every rule here is enforced by the Laravel backend, not by the AI model. The Security & Guardrails page (`/security`) shows the same rules.

## Never possible

No prompt, setting or request can run these against a connected database: DROP, TRUNCATE, ALTER, CREATE, RENAME, GRANT, REVOKE or any other DDL; a raw SQL console; AI-written SQL for writes. Orbit has no tool for them and says so plainly.

## Reads

A question about the data (in any language) is answered with ONE SELECT written by the user's own model from the live schema. Before it runs, the read gate checks it: a single SELECT statement, only readable tables, only allow-listed functions, every column resolved against the live schema (secret columns are not even shown to the model, so they cannot be referenced), joins that would inflate counts or sums are corrected or refused, a plain list that joins an unused child table (repeating rows) is refused, and a LIMIT is forced. The query is also compared with the question's own words: a filter the question never mentions, or a ranking question answered without ranking, gets one rewrite; if a filter stays, the answer says exactly which rows were counted. It then runs in a read-only transaction with a statement timeout. If the gate or the database rejects it, the model gets the exact error and may correct it (at most three attempts); if it still cannot be answered, Orbit says so — it never shows a different query's result instead. Blocked tables cannot be read. Every read is written to the audit log, including whether personal data was unmasked. Orbit itself cannot unmask personal data; only the user can, in the data assistant.

## Access mode (data assistant and Data page)

Each connection has an access mode set by its owner; the default is read-only.

- **Read only** — the data assistant and the Data page only read.
- **Read & write** — also adding rows (each previewed and confirmed; undo within a day) and row UPDATEs: a before → after preview of the exact rows, the user's confirmation, and the update is pinned to the previewed primary keys (an unscoped update is impossible). An executed change can be undone from its saved, encrypted before-image.
- **Read, write & delete** — also row DELETEs: impact analysis first, then the user types the exact phrase shown (voice alone is not accepted); it runs in a transaction, the deleted rows are saved first (encrypted) so it can be undone, and it is audited.

The access mode governs the data assistant and the Data page. Automations and Manual Publishing are separate: they only insert the new rows the user configured, into eligible tables, and they need INSERT permission on those tables.

## Sensitive tables

- **Always blocked** for the data assistant: credential, token and session tables (names like tokens, sessions, password_resets, personal_access_tokens, oauth_*, credentials). No setting opens them.
- **View only by default** for the data assistant and the Data page: payments, invoices, transactions, refunds, payouts, financial*, orders, order_items / order_lines, roles, permissions, user_roles, model_has_roles, model_has_permissions, role_has_permissions and audit_* tables. The connection owner can change this per table in the Schema Explorer (View only / Editable); unlocking asks first and is recorded in the audit log. Automations never write to a table that is view only.
- **Never written by automations or Manual Publishing:** tables whose name is, or contains as a whole word (split on `_`, `-` or spaces), user(s), account(s), auth, password(s), credential(s), session(s), token(s), oauth, role(s), permission(s), payment(s), transaction(s), billing, invoice(s), wallet(s), financial, audit(s), log(s) or migration(s); also `credit_card(s)` and `audit_log(s)` as full names. So `user_profiles` is restricted, but `blog_posts` and `blog_categories` are not.

## Sensitive columns

- **Secret columns** (password hashes, tokens, API keys, card numbers, national IDs and similar) are never returned, never sent to an AI model and never written.
- **Personal data** (emails, phone numbers) is masked in results unless the owner reveals it; the reveal is recorded in the audit log.

## Stored secrets

Database passwords and AI provider API keys are encrypted at rest and never sent back to the browser after saving. Orbit never types, reads or repeats them: it points at the real password or key box and the user types it there. Secrets typed into chat by mistake are redacted before anything is stored or sent to a model.

## Connection test guard

Connection tests, saving, schema scans, reads and writes all refuse the cloud metadata address (169.254.169.254), 0.0.0.0, and well-known non-database ports: SSH (22), Telnet (23), SMTP (25), POP3 (110), IMAP (143), Docker (2375, 2376), etcd (2379), Redis (6379), Kubernetes API (6443), Consul (8500), Elasticsearch (9200) and Memcached (11211).

## Writes by automations

Rows are inserted with parameterized statements inside one transaction, after the AI output has been validated against the live table: required fields, types, lengths, allowed values, uniqueness and relationships. AI output is treated as untrusted. Linked parent rows are created first in the same transaction only when allowed. Each scheduled occurrence gets one idempotency key, so it creates one run, and the insert itself is keyed so a retried publish does not write the row twice.

## Email approval links

Each link carries a random 48-character token for one draft version. It works once and expires after the time the administrator set (24 hours by default). Opening it shows the preview only; approving or rejecting needs an explicit button press. The portal itself never receives these tokens.

## Ownership

Every connection, automation, run, approval, document and provider key belongs to one user. Ownership is checked on the server for every request and again inside background jobs; another user's id is treated as not found.

## Orbit's own limits

- The backend decides what Orbit may do, never the model.
- Consequential steps need the user's confirmation. Removals and cancellations need the Confirm button in Orbit's panel; a typed or spoken "yes" does not count for them. Then Orbit presses the page's own button and confirmation popup in front of the user.
- Orbit reports only verified results and says when it is not sure.

## Audit log

Security-relevant actions are recorded per user: connections created, tested, changed or removed; table access changes; schema scans; automations created, changed, deleted, run; previews; approvals, rejections and publications; data reads and changes; refused attempts; profile and password changes; exports. Changes keep before → after values (secret fields only as "changed", personal data masked). Every Orbit tool call is kept with the request it served. The user can export their log as CSV. Orbit can search it by words, action, resource and date range, with totals and first/last time.
MD, 40, $now);
        $this->put('data_tools_guide', "Data tools — browsing, adding and changing rows", <<<'MD'
Product knowledge for Orbit's retrieval about the Data page (`/data`). Every rule here is enforced by the Laravel backend. An administrator can turn the Data page, row changes, AI sample rows and the data autopilot on or off for everyone.

## Browsing

Choose a connection, then a table. Each table shows its row estimate; credential, token and session tables are listed as locked and never opened. Rows can be searched (text columns), sorted by any column and paged (the page size is limited by the administrator). Linked columns show the linked row's name next to its id. Secret columns (password hashes, tokens, card numbers and similar) are never returned. Personal data such as emails and phone numbers is masked; Reveal shows it and is recorded in the audit log. Every read runs read-only with a time limit.

## Adding and editing rows

Add row and Edit open a form built from the live table: the right input per column type, required fields marked, allowed values as a list, linked columns as a search of the linked table's rows by name. Every value is checked (type, length, required, allowed values, unique columns, linked rows exist) and all problems are shown under their fields at once. Nothing is written yet: a preview shows the new row, or each changed field before → after, and the user confirms. An edit is pinned to that one row's primary key. An added row can be undone within a day; an edit can be undone from its saved before-image.

These need the connection's access mode to be Read & write (or higher) and the table to be Editable on that connection. Tables that are view only by default (orders, payments, permissions, audit and similar) can be made editable by the owner in the Schema Explorer.

## Deleting rows

Only when the connection owner set Read, write & delete. The preview shows how many rows in other tables depend on the row and what the database will do with them. The user must type the exact phrase shown. The row is backed up (encrypted) before it is removed, it runs in a transaction, it can be undone, and it is audited.

## AI sample rows

Asks the user's Writing content model for realistic rows (how many: up to the administrator's limit, 25 by default), optionally about a topic. Linked columns only use rows that already exist, unique columns avoid values already used, and every value passes the same checks as a typed row; rows that fail are left out and the reason is shown. The proposed rows are shown for confirmation before anything is added. Progress is shown step by step; on a local model this usually takes 20 seconds to 2 minutes.

## Data autopilot

Adds a few AI sample rows to a table on a schedule (every few hours, daily or on chosen weekdays, in a timezone), using the same checks. It runs on the server even when the browser is closed. After 3 failed runs in a row it pauses itself and says why. It can be run once now, paused, changed or removed. Each customer can have a limited number of autopilots (10 by default).

## Changes tab

Lists the changes made to the table from the Data page (added, updated, deleted, undone), who made them and when, with Undo where it is still possible.

## Orbit and the Data page

Orbit can explain the page and answer questions about the data with the data assistant. Adding, changing or deleting rows always ends in the preview and the user's own confirmation; deletes also need the typed phrase.
MD, 50, $now);
    }

    private function put(string $slug, string $title, string $body, int $sort, $now): void
    {
        $row = DB::table('orbit_knowledge_guides')->where('slug', $slug)->first();
        if (!$row) {
            DB::table('orbit_knowledge_guides')->insert(['slug' => $slug, 'title' => $title, 'body' => $body, 'is_published' => true, 'sort' => $sort, 'created_at' => $now, 'updated_at' => $now]);
            return;
        }
        if (isset(self::SHIPPED[$slug]) && hash('sha256', trim((string) $row->body)) === self::SHIPPED[$slug]) {
            DB::table('orbit_knowledge_guides')->where('id', $row->id)->update(['title' => $title, 'body' => $body, 'updated_at' => $now]);
        }
    }

    public function down(): void
    {
        // Guide text is content managed in the admin panel; it is not rolled back.
    }
};
