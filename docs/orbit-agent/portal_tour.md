# Portal tour — what each page is and what Orbit can do there

Product knowledge for Orbit's retrieval, used for "show me around", "explain this page" and "where do I…" questions. The live portal map (surface catalog) and read_screen are the source of truth for which fields and buttons exist right now.

## A good tour order

1. Dashboard — the overview.
2. Database Connections — where everything starts.
3. Schema Explorer — what the platform found in the database.
4. Automation Builder — how an automation is set up (then the Automations list).
5. Approvals — reviewing drafts.
6. Executions — the history of every run.
7. Manual Publishing — publishing without AI.
8. Knowledge Base — documents that ground the AI.
9. AI Providers — which models are used.
10. Audit Logs and Security & Guardrails — what happened and what is protected.

On a tour Orbit travels to each page, points at the main area with a one-sentence caption, and keeps each explanation short. The user can stop the tour at any time.

## Dashboard (`/dashboard`)

Counts of connections, automations and runs, recent runs and upcoming scheduled runs. Orbit can run an automation now from here (after confirmation).

## Database Connections (`/connections`)

Each saved connection with its status. Add a connection with the Connect Database form (name, host, port, database, username, password typed by the user, SSL mode, access mode, data timezone). Orbit can fill the form, ask the user to type the password, test, save, test a saved connection, rescan its schema, open edit, and remove a profile (Confirm button in Orbit's panel, then the page popup). Removing a profile never touches the database itself.

## Schema Explorer (`/explorer`)

Tables and columns of a connection with types, keys, relationships and safety tier (recommended, review, restricted), plus notes. Orbit can choose the connection and table, refresh, and save a note.

## Automations (`/automations`)

Every automation with its table, schedule state (active, paused, completed) and next run. Orbit can run one now, pause or activate it, delete it (Confirm button, then the page popup) and open the builder.

## Automation Builder (`/automations/new`)

Five steps: Setup, Fields, AI & content, Schedule, Preview & save. Orbit can fill the whole builder from one long request: it remembers every detail, fills each step, asks only for what is missing, explains any validation problem, previews, and creates the automation after confirmation. On the Fields step it can change how each column is filled (how.<column>), set fixed values or linked records (value.<column>) and add AI guidance (instructions.<column>). See `automations_guide.md`.

## Manual Publishing (`/manual-schedule`)

Pick connection and table, fill each column (col.<column>; foreign keys are dropdowns), then publish now or schedule. Orbit can fill it, use the AI draft helper on request, and publish after confirmation.

## Approvals (`/approvals`)

Drafts waiting for a decision, with a full preview. Orbit can open one, approve it for its scheduled time, approve and publish it now, or reject it with feedback (each after confirmation), and reload the queue.

## Executions (`/executions`)

Every run with status, versions, what was written and a step-by-step timeline. Orbit can filter by status, open a run's details, retry a failed run, cancel (Confirm button, then the page popup), pause, resume, publish an approved run now, and reload. For questions it can also use the run tools directly (list, status, explain failure).

## Knowledge Base (`/knowledge`)

Uploaded Markdown, TXT and PDF documents with their chunk counts, and a search box. The user picks a file themselves; Orbit can open the file picker, set the title, upload, search, reload and remove a document (Confirm button, then the page popup).

## AI Providers & Model Roles (`/ai-providers`)

Configured providers (local Ollama, OpenAI, Gemini, Anthropic) with masked keys, and model roles (which model writes content, which drives Orbit). Orbit can test a provider, open its settings, ask the user to type an API key into the real field, save, and change model roles.

## Audit Logs (`/audit-logs`)

Security-relevant actions, newest first, filterable by category; each entry's details open in a panel. Orbit can filter, open an entry and reload. For counts, date ranges or older entries it searches with its audit tools.

## Security & Guardrails (`/security`)

The rules the backend enforces: never-allowed operations, how reads, inserts, updates and deletes are guarded, sensitive tables and columns, stored secrets, approval links and Orbit's limits. Orbit reads this page or `security_guide.md` to answer security questions.
