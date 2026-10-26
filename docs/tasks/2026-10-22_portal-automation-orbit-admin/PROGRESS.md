# Progress

- 2026-10-22: Explored. Builder (5 steps, sessionStorage draft, templates set name/topic/schedule but not the table,
  review "Edit" jumps back to a step), field plan already supports AI_CREATE / AI_REUSE for foreign keys (parent row
  created first in one transaction), DataChangeService supports update/delete preview -> confirm -> undo (no insert),
  no token usage is recorded anywhere (providers drop it), mock provider is offered as "Test mode" in the builder.
- P1 (quick wins) done:
  - Product name Rowpilot (brand default, tagline "Database autopilot", panel fallbacks, index.html placeholder,
    README). Orbit's system prompt takes the brand from the request (product_name) instead of a hard-coded name.
  - Password minimum can be 6 (registry min and the server rule).
  - Mock provider removed from the product: provider catalog, model roles, builder ("Test mode"), automation model
    dialog, health check. Found and fixed: the content pipeline silently fell back to the mock generator when Ollama
    was down (would have written placeholder text into customer tables; now the run fails honestly), and "Fill in the
    steps for me" (propose-plan) always used the mock provider (now the customer's planning model via ModelSelector).
    The AI service accepts "mock" only when AI_ALLOW_MOCK_PROVIDER is set (tests/conftest.py).
  - Found and fixed: the model readiness test returned invented scores (100, or 55 for "1b" models) after a
    reachability check. Now the AI service runs four real tasks (exact JSON, right action, query plan, correction) at
    temperature 0 and reports each result; the portal shows them ("Test with real tasks").
  - Found and fixed: role temperature/max tokens were saved but never used, and the classifier/summarizer roles had no
    job. Now two roles (Orbit and planning, Writing content); temperature is sent with Orbit decisions and content
    generation; the UI explains it (Precise/Balanced/Creative presets with a plain-words note).
  - Claude model ids updated (claude-sonnet-5-5 etc.); the Claude health check pinged a retired fixed model, now the
    chosen one. Provider model lists live in config/ai_models.php and are admin settings (new 'tags' setting type).
  - Settings: every non-content setting explained in plain words; section descriptions; new settings: terms/privacy
    links (shown on sign-up and footer), customer sign-in length (maps to sanctum.expiration via a new 'map' hook),
    provider model lists, readiness time limit, review link lifetime, retries after a worker stops, linked records the
    AI can choose from (each wired to the code that uses it).
  - Tests: AI service 89 passed + 5 new (usage header, readiness real results, invalid JSON, mock refused); Laravel
    model role / readiness tests rewritten to the honest behaviour (10 passed). The 1 AI failure is the pre-existing
    test_busy_model_lock_reports_busy_not_crash.
- Dev services found stopped (serve, AI service, Reverb, scheduler, Vite http); workers running with new PIDs.
- P2 (token usage) core done: AI service middleware + providers report usage (X-AI-Usage); Laravel stores it in
  ai_usage_events (customer, purpose, provider, model, tokens, subject) via a Guzzle middleware on every AiServiceClient
  request; attribution in content/publish jobs (run), Orbit turns (request), previews and writing help; each queued
  job starts clean. Tests: AiUsageTrackingTest 3/3. Admin/customer views of usage come in P7/P9.
- P3 done: GET /api/dashboard/next-up (real next occurrence from ScheduleCalculator for every active, unfinished,
  scheduled automation; run in progress or finished in the last 30 min; last published). Found and fixed: the old
  "next run" ignored weekdays/start/end dates/one-time/completed automations ("today or tomorrow" guess), and
  worker_health was hard-coded "operational" (now the real queue heartbeat). New NextUpCard: live countdown (server
  clock offset), Write -> Review -> Publish steps, "Ran and published" state then the next run, failed state, refresh
  on live events and when a countdown reaches zero.
- P4 (automation builder) done in code:
  - Server-side drafts (automation_drafts, GET/PUT/DELETE /api/drafts/{automation|manual_publish}); every step,
    connection, table, mappings, template, description; debounced autosave with "Saving / Draft saved" chip; old
    per-tab draft migrated once; empty visits not saved; stale field-plan responses can no longer overwrite a draft.
  - Templates pick the matching table (lib/tableMatch.ts: name + columns; restricted never), with the reason shown.
  - Fields step: "Ready / N need your choice" summary, one-row-at-a-glance chips, plain option names, a 3-step flow
    on linked columns (AI picks / new parent saved first / id linked).
  - Review: Edit returns to the review ("Done, back to review" checks the steps in between); name edits inline.
  - Preview streams real steps (NDJSON ?stream=1; ContentPipeline emits TABLE_READ, IMAGES_STARTED,
    WRITE_CHECK_STARTED/WRITE_CHECKED besides its own); WorkProgress component; "Fill in the steps" shows honest
    single-step progress. Database errors explained in plain words (DbConnection::explainFailure).
  - Knowledge documents matching the topic are suggested and pre-selected (POST /api/knowledge/suggest; threshold
    from measured nomic-embed-text scores: matches 0.75-0.81, unrelated 0.28-0.45 -> 0.6 floor, within 0.15 of best).
  - Dev services restarted (AI, serve, Reverb, scheduler, Vite) detached; logs in the scratchpad.
- P5 in progress: RowValidator, DataChangeService insert preview/execute/undo + unique/link checks,
  DataExplorerController (tables, rows, link options, preview insert/update/delete, confirm, cancel, undo, history),
  feature flags data_explorer/data_manager/sample_data/data_autopilot, data_explorer config + settings, global
  DataException rendering (422), AI service /v1/ai/sample-rows (+3 tests), chat max_output_tokens option.
- P5 (Data Explorer + Data Manager + sample rows + autopilot) done:
  - Backend: SampleDataService (column rules from the live table, existing parent records for links, values already
    used in unique columns; every AI value validated; only valid rows previewed), POST .../sample-rows (streams
    RULES_READ/GENERATING/GENERATED/VALIDATED/READY), data_autopilots table + model (hourly/daily/weekly, timezone,
    ends_on, pauses after 3 failed runs), RunDataAutopilotJob (lock, ownership + suspension re-checked, flags,
    executes the confirmed setup, audit + live event), data:run-autopilots every minute (claims each occurrence),
    DataAutopilotController (CRUD, run now, per-customer limit, table must accept sample rows). Shared
    StreamsProgress trait (preview + sample rows). Every validation problem reported at once.
  - Frontend: /data page (connection picker, tables with sizes and locked protected tables, rows with search,
    sorting, paging, links by name, personal data masked until revealed (audited), row panel, add/edit forms
    generated per column type with messages under fields, AI sample rows with real progress, change preview with
    before -> after / typed delete phrase, Undo banner, Autopilot tab, Changes tab), nav item (feature flag).
  - Tests: DataExplorerManagerTest 8/8 (70 assertions) on the fixture DB (left clean); AI sample rows 3/3.
  - Real checks: browser (browse, field errors, streamed progress) and API with the real local model
    (llama3.2:1b, 3 valid rows in 124 s, confirm wrote ids 38-40, undo removed them; usage recorded: 2 calls,
    822 + 389 tokens). The machine ran out of memory once (Chrome + local model + another project): the kernel
    killed an IDE process; browser checks are now kept apart from model runs.
  - Dev stack for checks runs on spare ports (Laravel 8010, Vite 5180, AI 8001, Reverb 8080) because ports
    8000/5173 are used by another project (dol-diocese-site).
- P6 (Schema Explorer) done:
  - Fixed: schema snapshots name columns is_nullable/default and keep foreign keys on relationships, but pages read
    nullable/default_value/is_foreign_key, so every column showed "not null", FK badges never showed and Manual
    Publishing treated every column as required. api.getSchema now normalizes once (original keys kept).
    ContextPackageService read the same wrong keys (no field was ever "REQUIRED" in the AI context and primary keys
    were not skipped); it now reads both spellings.
  - Policy gap fixed: order tables were writable by default although the rules say order/financial/permission/audit
    tables are read-only. Added orders, order_items/lines, refunds, payouts, model_has_roles/permissions,
    role_has_permissions. No UI or API could set the per-connection override the rules promise: new owner-only
    PUT /api/connections/{id}/tables/{table}/access (view only / editable / default; blocked tables refused; audited
    CONNECTION_TABLE_ACCESS_CHANGED with before/after; live catalog cache cleared). data_policy.table_overrides
    values validated on connection create/update; unknown stored values are ignored.
  - Schema response adds data_class, data_class_default per table and sensitivity (secret/pii/standard) per column.
  - UI: table list shows row estimate + column count; header facts (rows, columns, access chip that also reflects a
    read-only connection); honest eligibility line (good fit / check columns first / view only / restriction);
    actions only where they work (Create automation + Write manually only for writable, non-restricted tables;
    Browse rows when the Data Explorer is on and the table is not blocked); owner access control with a
    confirmation before unlocking default view-only data; "Links to other tables" (belongs to / used by, click to
    open, plain-language note on how automations fill links and how deletes show dependants); columns table with
    full type, "when a row is added" (required / optional / default / set by the database), link target, allowed
    values or max length, Unique/Secret/Personal badges, and a "a new row needs: ..." summary; column search for
    wide tables; ?table= opens a table; layout overflow on wide tables fixed.
  - Tests: TableAccessTest 5/5 (40 assertions). Related suites: only the pre-existing environment failures remain.
    tsc clean; oxlint clean on the changed files. Browser: products, categories (via link), users badges, orders
    access control + confirmation modal, no horizontal overflow.
- P7a (Manual publishing) done:
  - Problems found and fixed: links (?connectionId=&table=) were ignored; every *_id field silently started at 1 and
    a missing lookup showed a fabricated "Record #1 (Default Record)"; unknown *_id columns guessed a table that may
    not exist; creating a new parent ("create the category first") was unreachable because the picker could not
    take a name; prices/ints started at 0 and status at an invented "published"; a column could appear in two
    groups; secret columns were offered; a "custom columns" section only reached hidden columns; the success screen
    linked to a non-existent /schema route; AI draft overwrote typed text and used Ollama's default model instead of
    the customer's "Writing content" model (same for per-field AI assist, which also invented the topic
    "Enterprise Database Automation" when none was given).
  - New: RelationPicker (real rows with server search; "Use an existing X" / "Add a new X"; offers to add what was
    typed; plain note that the new row is created first in the same transaction and an existing one with that name
    is reused); only writable, non-restricted tables offered (notice when a link names another); values start
    from database defaults only; Yes/No control for boolean columns; friendly labels with column name + limits;
    "Filled in automatically" group for created/updated/deleted_at; server draft (kind manual_publish, restored with
    "Start over", cleared after publishing); AI draft fills only empty text fields with elapsed time and a summary;
    plain wording throughout; success view shows what was written and links to the Data page.
  - Backend: previewAi and fieldAssist use ModelSelector (generator role, with its temperature) when no provider is
    given; fieldAssist refuses "generate" without a topic and rewrite actions without text (422, no model call).
  - Verified in the browser end to end on shopfx_w: errors under fields, categories listed by name, new category
    "QA Trail Gear" + product written in one transaction (review showed both steps), draft saved then cleared; rows
    removed afterwards (fixture back to 30 products / 6 categories). Tests: field-assist guard test added (passes).
- P7b (Approvals + Execution history) done:
  - Approvals bug fixed: the card buttons "Approve for schedule" / "Publish now" set the selected item and called the
    handler in the same tick, so the handler saw no item and only the review modal opened; they now act on the card's
    draft (verified: run #313 published as post #16 from the card; row removed afterwards). Removed the fallback
    that built approval items from executions (could send an execution id as a version id).
  - Approvals: version history per run (API adds execution.versions without content), "Rewritten after your notes",
    real draft image or a neutral placeholder (no decorative fake), publication time in the automation's timezone
    with countdown, what happens if nobody decides (KEEP_DRAFT / AUTO_PUBLISH_LATEST / CANCEL), overdue handling,
    "Being rewritten" list (REGENERATING runs) with a link to follow progress, live refresh on execution events,
    friendly field labels, plain toasts, "Send back" from a card closes cleanly on cancel.
  - Execution history: API summary per status (same automation filter) + page size capped at 100; per-run AI usage
    in the detail (calls, tokens, models from ai_usage_events); summary chips that filter; automation filter;
    plain status labels; ?id= opens a run; humanised failure categories; "Edit row" prefills from the published
    version (it used versions[0], the oldest, which after a send-back was the rejected draft); no fake "posts"
    table fallback; plain metric/tab labels (AI used instead of the idempotency key, kept in Technical details).
  - Real run for the checks: AI automation on posts with approval (llama3.2:1b, 3.7 min, 831 tokens recorded).
- P7c (Audit log + Account settings) done:
  - Before -> after is now recorded: AuditLog::changes() (only real differences, long values shortened, secret
    fields stored as "(hidden)", personal data masked as the portal shows it) used by AUTOMATION_UPDATED,
    CONNECTION_UPDATED (password never), MODEL_ROLE_UPDATED, AI_PROVIDER_CONFIGURED (+ api_key_replaced, never the
    key), data.update_executed (masked diff), PROFILE_UPDATED, and portal approvals (edited fields).
  - Gap fixed: approving or sending back a draft in the portal wrote no audit entry (only the email link did); both
    now record VERSION_APPROVED / VERSION_REJECTED (via portal, publish_now, notes).
  - API: /audit-logs filters (category, search, from/to, paging), /audit-logs/orbit (each Orbit tool call with the
    request it served, outcome, whether it changed something / was verified, redacted arguments), /audit-logs/export
    (CSV, owner only, 10k rows, spreadsheet-formula guard, itself audited).
  - Page: plain sentence per event, category tabs incl. Orbit activity, search + date range, paging, detail with
    "What changed" (from -> to), labelled details, link to the related run/table/page, raw data on demand; CSV export.
  - Account settings (/account, also in the user menu and sidebar): profile (email change needs the current
    password; unique), timezone (follow the browser or a chosen zone; used for showing times and as the default for
    new schedules), password change (current password checked, signs out other sessions), signed-in sessions with
    sign-out, AI usage for 7/30/90 days by model and purpose. users.timezone made nullable: every existing row held
    the column default 'UTC' that nobody could choose, so those were cleared (migration 2026_10_23_000002) to keep
    times following the browser.
  - Sign-up minimum password length default lowered from 8 to 6 as requested (admins can raise it); test updated
    and a 6-character sign-up asserted.
  - Tests: AuditTrailTest 3/3, ProfileSettingsTest 3/3, FormValidationTest 9/9. Browser: audit list/detail with real
    before -> after, account page with real usage (2,729 tokens on llama3.2:1b).
- P8 (Orbit) done:
  - Knowledge only in the database: migration 2026_10_23_000003 stores the guides (updated for the current product:
    Data page, Account settings, table access, relation picking, approvals deadline policy, audit before/after and
    Orbit tab, model roles "Orbit and planning"/"Writing content", corrected view-only table list, configurable
    approval link lifetime) plus a new "Data tools" guide; an untouched shipped guide is updated, an admin-edited one
    kept (hash check). "{brand}" in guides is replaced by the brand setting when published. docs/orbit-agent/*.md
    deleted; OrbitKnowledge::bundled/restoreBundled and the "Restore built-in guides" admin action removed; status
    widget/empty state reworded. AI service: guides indexed straight from the published payload (no .md files; the
    old product_guides folder is removed on publish), no fallback to repository files, re-embedded from stored
    sections when the embedding backend changes; status reports "none" until published. Dead Qdrant ingestion
    (ingest_docs.py, qdrant_store.py, /v1/rag/ingest-corpus, storage/qdrant_db) removed. New orbit:sync-knowledge
    (every 10 min) re-sends the published guides when the AI service has none (fresh or wiped storage). Published
    now: 5 guides, 79 sections, ollama:nomic-embed-text.
  - Visible actions: VisibleEquivalent maps run now, pause/resume (explicit, idempotent surface actions instead of
    a toggle), delete automation, retry/cancel/pause a run, approve, send back (fills the notes, then presses) to
    go_to_page + press; the orchestrator runs them on screen when the portal is open and checks the real state on
    the server afterwards (e.g. automation really paused, a new run exists). It falls back to the backend tool only
    when nothing was pressed (row not listed, no browser); a pressed action that failed is reported, never repeated
    in the background. List surfaces report missing rows (missing: true -> NOT_ON_SCREEN). Prompt line added.
  - Bug fixed: the backend interrupt tool overwrote any status (a PUBLISHED run could become CANCELLED); it now
    follows the portal's rules.
  - Context: runtime context adds each automation's state and next run, the latest 5 runs, data autopilots and the
    user's timezone. The AI service no longer hard-cuts the context JSON at 5,000 characters with the decisive keys
    last: priority keys first, long lists shortened with *_more counts (copy, request untouched).
  - Catalog: /data (new data.page surface: connection, table, search, open add form / sample rows; no write action)
    and /account pages; manual.form gets "review" and keeps "publish" (consequential); audit.page filters updated.
  - Speech/action sync: a reply is spoken straight from the live event (no conversation reload first); Orbit returns
    to the dock after the voice finishes (was a fixed 1.5 s that cut across longer replies).
  - Tests: OrbitVisibleActionsTest 3/3; AI service RAG 4/4 (rewritten for DB-only guides), decider 22/23 (the one
    failure is the known pre-existing busy-lock test), new context compaction test passes; frontend 77/77 incl. the
    catalog consistency test (which caught the dropped manual.form publish action, restored).
- P9 (Admin panel) done:
  - Theme: refined light (hairline card edges, calm table header, row hover, rounder modals) and dark (layered ink
    canvas, raised card/modal/dropdown surfaces with visible edges, readable table cells, dark inputs with focus ring,
    quiet scrollbars instead of the bright sidebar track).
  - Customers: list shows AI tokens (30 days, sortable, sent/written tooltip) and the writing + Orbit models;
    customer page gets "AI models & tokens" (models resolved exactly as the app resolves them, tokens 30 days / all
    time, by model and by purpose) and an "AI usage" tab. New platform page Customers › AI usage (every AI call:
    customer, purpose, model, tokens, what it was for with links; filters; 30-day stats with change, top model).
  - "Runs" renamed "Automation runs" (URLs unchanged): plain statuses, started by, took, AI tokens, versions, row;
    filters by automation / customer / trigger; run page adds where it writes, AI usage, every content version with
    the notes it was sent back with.
  - Orbit requests: model and tokens per request (list + detail), the conversation during the request, and each tool
    call with its outcome, whether it changed something / was verified, and the (redacted) arguments.
  - Activity log: "What happened" sentences (AuditDescriber, same wording as the portal), area and customer filters,
    detail with "What changed", Export CSV of exactly what is filtered (formula-safe, audited). Admin activity: same
    export.
  - Connections: "Data and protection" (tables found, restricted, owner table-access overrides, autopilots, row
    changes and refused writes in 30 days). Automations: model actually used (pipeline resolution), approval set-up,
    last run, documents, AI tokens across runs, last failure. Paired phones: detail page with session facts and every
    command from the phone; command count in the list.
  - Health: new "Orbit knowledge" card (guides/sections indexed, semantic or keyword search, or a warning).
  - Bug found through the readable log and fixed: listing tables on the Data page built each table's permissions via
    assertCanWrite, which wrote a "write/delete refused" audit entry for every table on every visit. Permission
    previews now use DataAccessPolicy::writeRefusal (no logging); real attempts still log (regression test added).
  - Fixed while building: Filament injects closure arguments by name, so a `$q` parameter received a fresh model-less
    builder (AI usage page crashed); array states are formatted per item (customer page crashed) - both corrected.
  - Tests: AdminPanelTest 25/25 (guides isolated from the shipped set; new tests for DB-only guides + brand,
    re-send when lost, activity exports); TableAccessTest 6/6. Every admin page rendered in dark mode with no error
    (failed-jobs only matched the probe's error words because it lists exception names).
  - Environment note: the AI service, Reverb and the scheduler (started by me on spare ports) had stopped while the
    queue workers were restarted by the user's run_all.sh; I restarted AI service, Reverb and scheduler.
- P10 (tests, docs, cleanup) done:
  - Laravel full suite: 256 passed, 23 failed, 1 skipped. Every failure is in the baseline taken before this task
    (environment: tests that need database servers not running here ("Connection refused") or the PostgreSQL PHP
    driver); none is new, and 8 baseline failures now pass. The first final run showed 4 order-dependent failures;
    fixed: AI usage attribution is reset after every HTTP request (it could carry into the next request in a
    long-lived server or the next test), AiUsageTrackingTest starts clean, and the dashboard test now expects the
    real worker-health fields instead of the removed invented `active_workers` count.
  - AI service: 92 passed, 1 failed (test_busy_model_lock_reports_busy_not_crash, failing before this task).
  - Frontend: tsc clean, oxlint 0 errors (156 warnings, mostly React-compiler advisories), 77/77 tests, production
    build succeeds (built into the scratchpad; dist/ untouched).
  - Docs: README (Schema Explorer/Data, providers without mock, manual publishing, account settings, Orbit knowledge
    in the database and visible actions, admin areas, view-only tables), API_CONTRACT (every endpoint added in this
    task, product-guides behaviour), SECURITY_MODEL (view-only table list + owner override, audit before/after and
    masking, CSV formula guard, profile changes, visible actions, knowledge storage), DECISIONS (ADR-018),
    RUNBOOK (orbit:sync-knowledge instead of the removed Qdrant ingestion), CAPABILITIES (link), IMPLEMENTATION_PLAN.
  - Cleanup: QA customer (user 81, connection 43, its automations, runs, drafts, tokens, usage) deleted through the
    admin's own delete path (all rows verified gone); temporary QA admin and its 13 activity rows removed (the
    user's admin account untouched); fixture shopfx_w back to 30 products / 6 categories / 15 posts / 8 tags;
    scratchpad credential files removed; the dev services I started (Laravel 8010, Vite 5180, AI service 8001,
    Reverb 8080, scheduler) stopped. The user's queue workers were left running.
  - Nothing committed or staged (HEAD is still eb203fe).
