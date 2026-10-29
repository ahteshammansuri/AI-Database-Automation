# Orbit: right database, grounded in retrieval instead of text in code (2026-10-28)

Owner's request: Orbit picked the wrong database and added a user there; and no static code, text or prompts for Orbit:
use the AI (RAG, embeddings, vectors, retrieval of only what is relevant) for everything. Nothing is committed.

## Why the wrong database was used (found in the code and in task 305's log)
1. Data page race: `fill_fields {connection, table}` ran both setters on one render's state; the table setter wrote the
   previous connection back into the URL and a URL→state effect switched the page back to it. Add row then opened on
   the other database's `users` table. Fixed: URL updates start from the latest URL, a database switch clears the old
   table, late answers of a previous database are ignored, the page reports `busy` until its tables and rows belong to
   what is chosen; the runtime re-reads the live surface and waits while it is busy before every step, and fills fields
   in the form's order.
2. The orchestrator switched the screen to `slots.connection_id` (possibly remembered from an earlier request) and to a
   table found by a word regex before pressing Add row / AI sample rows, using a `value` argument the tool rejects.
   Removed.
3. Data tools picked the first connection when none was given; `preview_data_change` treated a missing action, and
   `insert`, as a delete. Now `ConnectionResolver` (explicit and owned, or the only one; otherwise
   `CONNECTION_REQUIRED` with the candidates and which have the table), `insert` uses the Data page's own checked
   `previewInsert`, a missing action is an error.
4. The browser redactor took Hindi "mere pass to Soviet …" for "password to …" and removed the database name from the
   message (it was even stored as a password). Whole words only now.
5. The multi-database guard was dead code (`$context` was never set) with a fixed Hindi question; the focused path chose
   the first of two equally matching databases. Both replaced by retrieval (below).
Also fixed on the way: a delete's typed phrase was accepted from tool arguments (the model knows it from the preview);
now only the user's own latest message counts.

## Static text and code replaced
| Was in code | Now |
|---|---|
| `DEFAULT_SYSTEM_POLICY` (AI service), long persona default in `SettingsRegistry` | Role and principles as a setting (seeded as data); the decision protocol generated from the schema |
| One-off rules (dummy data, Data page choreography, Hindi examples) | Knowledge guide "How Orbit carries out requests", retrieved per request |
| Keyword tool routing, `CORE_TOOLS` | On-screen tools + tools the retrieved knowledge names + embedding similarity |
| "let me check" regexes → forced `find_dummy_data` (Python and Laravel) | Removed: the decision is the model's |
| `_SYNONYMS` Hindi word list in retrieval | Removed; wording belongs in the knowledge; `search_orbit_knowledge` lets the model write its own query |
| `dataHint` / `pageHint` / `detectAmbiguousTarget` (word lists in English and Hindi) | Retrieval of the user's tables (every database) and pages in the AI service |
| Route / reply prompts with a Hinglish glossary | Settings `orbit.route_instructions`, `orbit.answer_instructions` (seeded) |
| Canned English confirmation of a preview | Written in the user's language by the reply composer; must keep database, table, count and phrase |
| `TOOL_META` (descriptions and policy) | `orbit_tools` columns + `resources/orbit/tools.json`; vault-filled secret arguments enforced by name |
| `IN_FLIGHT`, `OPEN_STATUSES`, `OPEN_TASK_TTL_MINUTES` | On the models they describe; the TTL in `config/orbit.php` |
| Customer database names in the shared Data tools guide | Replaced by general sections (guides are shared by every customer) |

Kept in code on purpose: the decision protocol (the contract), safety enforcement (ADR-010), workflow state sets, system
notices for when no model answers, and factual hints in tool results.

## Fresh installs
The tool catalog had moved from code to the database, but its seeding migration copied from the (now empty) code, so a
fresh installation, and every test database, had no tools ("UNKNOWN_TOOL"). `ToolCatalog::sync()` seeds from
`resources/orbit/tools.json`; tools edited in the admin panel keep their text.

## Verification
- Frontend: `tsc` clean; `npm test` 79/79 (2 new); oxlint 157 warnings, none new.
- AI service: 117 passed, 1 failed (`test_runtime_context_keeps_decision_keys_when_long`, failing before this work);
  new `test_orbit_grounding.py` 18/18, `test_agent_fastpath.py` ported 7/7.
- Laravel: `OrbitGroundingTest` 7/7 (new). `AgentAutonomousActionTest` 41/44: the 3 failures need the demo MySQL on
  :3308, not available here (before this work 22 failed: no tools on a fresh database). With the test fixture MySQL
  (:3317) started for the run: `NaturalLanguageDataAgentTest` 25/26 (the Postgres test needs php-pgsql),
  `SafeDataWritesAndGuardedDeleteTest` + `DataExplorerManagerTest` + `OrbitVisibleActionsTest` 21/22 (the AST read gate
  test needs the AI service running). `OrbitAccountToolsTest`, `OrbitDynamicAdminCatalogTest`, `OrbitPageToursTest`,
  `DummyDataMultiTableTest`, `AdminPanelTest` pass. The fixture container was stopped again.
- Retrieval calibrated on the owner's real 234 tables (two databases): data questions find their tables in both
  databases; greetings, tours, "connect a new database" find none.
- Real-model smoke test (local qwen2.5:3b, owner's real schema, tools and principles; index copy): the decision did not
  finish within 562 s on this CPU while the 234 table descriptions were being embedded on the same Ollama, so no model
  answer was observed. It exposed a retrieval bug that is fixed: the current page ("Dashboard") was part of the table
  query and pulled in the customer's `pages` tables instead of `users`. After the fix: "dummy user bana do" retrieves
  `users` of both databases, the follow-up "Soviet mein" too, "hello" none (2 regression tests added; AI service 119
  passed, same 1 pre-existing failure).

## Still to do by the owner
- The `run_all.sh` stack was found stopped (another project started at 19:45 uses port 5173). Restart it, then publish
  Orbit's knowledge (Admin › Orbit › Knowledge › Publish) so the new guide is live. Migrations already ran.
