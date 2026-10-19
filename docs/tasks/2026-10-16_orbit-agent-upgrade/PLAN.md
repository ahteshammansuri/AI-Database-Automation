# Orbit agent upgrade — plan (started 2026-10-16)

Resume from here: read this file, then `PROGRESS.md` (newest entries at the bottom). Statuses in the
table below are the source of truth. Mark an item DONE only after it is verified (tests, typecheck,
or a real run), and note how it was verified.

## Goal (from the owner's request)
Orbit should operate the whole portal like a careful human assistant, visibly and safely:
- Navigate, click links and buttons, type into fields (visibly, character by character), pick options.
- Take everything the user says in one long prompt, remember it, and fill multi-step flows step by step
  (e.g. the automation builder); ask only for what is missing, one question at a time.
- Validate: if a value is wrong, say exactly what is wrong and ask for a correction.
- Edit, delete, test connection, scan schema, refresh queues, view/inspect anything the user asks.
- Deletes and other risky actions: ask for confirmation in Orbit's panel first; after the user confirms,
  Orbit clicks the page's own Delete and then the popup's confirm button, in front of the user.
- Know the product: explain any page, give a guided tour by travelling page to page, answer security
  questions, answer questions about the user's data, audit log, executions and knowledge base accurately.
- Never invent answers; report only verified results. DDL (DROP/TRUNCATE/ALTER…) is never possible.
- Small speech bubble next to Orbit (without opening the panel) saying what it is doing / has done.
- Character: keep the current design, make it cuter and more natural: eyes, mouth/lip-sync, hands, feet,
  pet-like idle behaviour, different motion for travelling vs working vs celebrating.
- No keyword routing or canned answers: decisions come from the model with runtime context, tool
  schemas, the page catalog and RAG (embeddings) over the product docs.

## What already exists (keep and build on)
- Observe-act loop: `AgentOrchestrator` → Python `agent_decider` (model decision, JSON schema, embedding
  tool selection, RAG) → `ToolPolicyGate` (ownership, args, confirmation) → `ToolRunner` → verification.
- Generic on-screen tools: go_to_page, open_form, read_screen, fill_fields, choose_option, press,
  ask_secret_in_form, show_me. Pages register "surfaces" (fields/actions) checked against
  `laravel/resources/orbit/surfaces.json`.
- Backend tools for connections, schema, automations, executions, approvals, providers, knowledge,
  dashboard, audit, data agent (ask_database, preview/confirm/undo data change).
- SVG rig (`OrbitRig`) with blink, TTS lip-sync, blush, arms/hands, hover feet; travel/gesture events.

## Gaps found (2026-10-16 audit)
1. BUG: `run_automation_now`, `retry_execution`, `approve_content_version`, `reject_content_version`
   dispatch job classes that do not exist (`ProcessAutomationExecution`, `PublishApprovedExecution`).
2. `create_automation_draft` / `update_automation` tools bypass the new schedule + field-plan validation.
3. Turn limit (8 iterations) is too small to drive the 5-step builder from one long prompt.
4. `fill_fields` sets values instantly (no visible typing).
5. Consequential presses bypass the page's own confirm popup (e.g. knowledge remove deletes directly).
6. Catalog gaps: builder field mappings (per column), builder content options (length, format, images,
   documents), approvals/executions refresh, audit search/inspect, security page missing.
7. Narration is only visible inside the panel; no bubble next to Orbit.
8. Agent RAG indexes only `product_context_rag.md` (no security/scheduling/automation/page guide).
9. `list_audit_logs` only returns the latest N rows (cannot answer "did I ever create a connection?").

## Work items
| ID | Item | Status | Verified by |
|---|---|---|---|
| O1 | Fix broken agent tools (real jobs, correct status transitions) and route automation tools through the new validation | DONE | `tests/Feature/OrbitAutomationToolsTest.php` 9/9 |
| O2 | Longer multi-step turns (iteration/time limits), slot memory guidance for long prompts | DONE | config chain 1500<1560<1600<1620; decider tests 20/21 (1 pre-existing failure) |
| O3 | Catalog + page surfaces: builder mappings/content, approvals/executions refresh, audit search/inspect, security page, knowledge refresh | DONE | stronger orbitCatalogConsistency test (every catalogued field/action implemented), 47/47 frontend, tsc, oxlint 0 errors; Laravel agent suites 46/51 (5 environmental) |
| O4 | Visible typing in fill_fields; consequential presses go through the page's confirm popup, which Orbit clicks after the user confirmed in the panel | DONE | AgentAutonomousActionTest: 4 new confirmation tests + updated spoken-yes test pass; frontend tsc clean, 39/39 node tests, oxlint 0 errors. Visual check in a real browser still pending (O10) |
| O5 | Speech/status bubble next to Orbit (narration, steps done, confirmation prompt) when the panel is closed | DONE | `orbitBubble.test.ts` 7 tests (46/46 frontend), tsc clean, oxlint 0 errors. Visual check in a real browser pending (O10) |
| O6 | Multi-document product RAG (product context, portal guide, security, scheduling, automations) | DONE | test_rag 3/3 (2 new); real nomic-embed-text probe returns the right guide sections; Python 41/42 (1 pre-existing) |
| O7 | Audit and execution tools with search/filters/summaries for accurate answers | DONE | `OrbitAuditToolsTest` 2/2, `OrbitAutomationToolsTest` (list_executions filter) |
| O8 | Decider policy: tours, validation feedback, one-question-at-a-time, safety wording | DONE (policy text; real-model behaviour to be checked in O10) | decider tests pass |
| O9 | Character refinements: cuter face details, smoother lip-sync, natural limb motion, pet-like idle | DONE | rigPersonality.test.ts (2), frontend 49/49, tsc, oxlint 0 errors; headless-Chrome render of 10 states + close-up faces |
| O10 | Tests (PHP, Python, frontend) and docs (product context, ADR, README) | DONE | real-browser run with qwen2.5:3b passed end to end (run #7); suites below; README, ADR-016, IMPLEMENTATION_PLAN |

## Safety rules that must hold after every change
- The model never decides permissions; the gate does. Consequential actions always need explicit user
  confirmation in Orbit's panel; only then may Orbit click the page's confirm button.
- Destructive actions (catalog `destructive: true`, tool meta `confirm_by_button`) are confirmed ONLY by the
  Confirm button in Orbit's panel; a typed/spoken "yes" does not count for them.
- Secrets are never typed or read by Orbit (ask_secret_in_form only).
- No raw SQL writes, no DDL, ever. Data changes go through preview → confirm → undo.
- Tenant ownership is re-checked for every resource id.
