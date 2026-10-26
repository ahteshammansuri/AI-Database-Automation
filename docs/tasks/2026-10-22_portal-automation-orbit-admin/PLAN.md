# Portal, automations, data tools, Orbit and admin panel upgrade (2026-10-22)

Request: improve the customer portal (functionality + UX), make automations stronger and simpler, add a Data Explorer
and Data Manager with AI sample data (instant and scheduled), make Orbit act visibly and know the signed-in user's
data, and deepen the admin panel (dark mode, details, token usage, exports, settings). Do not commit.

Rules that still apply (AGENTS.md): reads validated and limited; INSERT/UPDATE only after preview + confirmation,
updates pinned to previewed keys; DELETE only in `read_write_delete` with impact analysis, typed confirmation,
transaction, backup, audit; never DDL, raw SQL console or model-written write SQL; secrets never returned; PII masked;
tenant ownership enforced in backend and jobs; AI output is untrusted and validated before writes.

## Requirements (every item from the request)

### Customer portal
| # | Requirement |
| --- | --- |
| C1 | Dashboard first card: the next automation run with a live countdown; after a run publishes, show it completed ("ran and published"), then the next one; if nothing is scheduled, show the last published state. |
| C2 | Schema Explorer: better experience. |
| C3 | Data Explorer (new): browse each table's rows (search, sort, filter, paging, row detail), masked and limited. |
| C4 | Data Manager (new): add / edit / delete rows (preview + confirm; deletes only when the connection allows), AI sample ("dummy") rows instantly, and scheduled sample rows (autopilot); every table handled correctly (types, required, enums, foreign keys, unique). |
| C5 | Automation templates auto-detect the matching table (blog template -> blog/posts table). |
| C6 | Automation draft keeps every detail (connection, table, mappings, all steps) reliably (server-side, survives tabs/devices). |
| C7 | Fields step clearer and simpler; foreign keys handled and explained (AI creates the parent record first from the topic, then links its new id); simple for non-technical users. |
| C8 | Preview & save: editing a setting returns the user to the review (no walking through every step again); inline edits where possible. |
| C9 | Long operations show staged progress (what is done, what is running, what is next), not just a spinner. |
| C10 | AI & content: knowledge documents relevant to the topic are suggested and pre-selected. |
| C11 | Automations accurate and strong for every table type (validation, foreign keys, images, unique, enums). |
| C12 | Manual publishing: simpler, same foreign-key handling and draft safety. |
| C13 | Approvals: improve where possible. |
| C14 | AI providers: remove the local mock ("Test mode") generator everywhere in the product; explain temperature and model jobs in plain words. |
| C15 | Execution history: improve where possible. |
| C16 | Audit logs: more detail, inspect view with what changed (from -> to), what was done, Orbit requests and results. |
| C17 | User settings: profile (name, email, password), preferences, usage. |

### Orbit
| # | Requirement |
| --- | --- |
| O1 | Knows the whole product (knowledge from the database) and the signed-in user's own data only (tenant isolated). |
| O2 | Actions happen visibly: navigate to the page and operate it (pause/resume/run automations etc.), not silently in the background. |
| O3 | Speech, lip sync and actions stay in sync (says what it is doing while doing it). |
| O4 | Smooth movement, reactions and navigation. |

### Admin panel
| # | Requirement |
| --- | --- |
| A1 | Better dark mode (and refined light mode). |
| A2 | Customers: every detail incl. models used and tokens used. |
| A3 | Connections: more detail. |
| A4 | Automations: more detail. |
| A5 | "Runs": a clear name and more detail. |
| A6 | Activity logs: clearer detail + export. |
| A7 | Orbit requests: tokens, model, detail; conversations page. |
| A8 | Paired phones: more detail. |
| A9 | Orbit knowledge only in the database (no Markdown files for Orbit/site knowledge; remove unused files). |
| A10 | Website content: improve. |
| A11 | General settings: relevant and complete. |
| A12 | New premium product name. |
| A13 | Password minimum can be 6. |
| A14 | AI models, Automations, Data assistant, Orbit, Orbit Remote, Features settings: more settings where useful and clear explanations; feature switches for new modules. |
| A15 | Team & access security; admin activity detail. |
| A16 | Health and failed jobs: extras where useful. |
| A17 | Production ready; nothing committed. |

## Phases
| Phase | Scope | Status |
| --- | --- | --- |
| P1 | Quick wins: password min 6, product name, remove mock provider from the product, temperature help, settings explanations + new settings | DONE |
| P2 | Token usage: AI service reports usage per call, Laravel records it per customer / model / purpose | DONE |
| P3 | Dashboard next-run card with countdown and completed state | DONE |
| P4 | Automation builder: server draft, template table detection, fields/foreign keys, return to review, staged progress, document suggestions | DONE |
| P5 | Data Explorer + Data Manager + AI sample rows + data autopilot | DONE |
| P6 | Schema Explorer | DONE |
| P7 | Manual publishing, approvals, executions, audit log inspect, profile settings | DONE |
| P8 | Orbit: visible actions, speech/action sync, user data context, knowledge from DB only | DONE (O4 motion: existing choreography kept; timing fixes only, see PROGRESS) |
| P9 | Admin: dark mode, customers/connections/automations/runs/requests/conversations/phones detail, exports, knowledge DB-only, settings | DONE (A10/A11/A15: existing pages kept; settings help from P1) |
| P10 | Tests, docs, real-browser checks, report | DONE (see PROGRESS: test runs, docs, cleanup) |
