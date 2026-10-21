# Orbit reliability fixes — plan (started 2026-10-19)

Resume from here: read this file, then `PROGRESS.md`. Statuses below are the source of truth. Mark an item
DONE only after it is verified, and say how.

## Reported by the owner (screenshots, 2026-10-19)
1. "Can you tour me on this project?" — the tour worked page by page, then "Could not open /security."
2. "Aisa kaun sa user hai jisne sabse jyada order refund kare ho" — six "Failed." steps, no answer.
3. "Aisa kaun sa customer hai jismein bahut hi jyada order kiye ho" — six "Failed." steps; reply "I see a
   total of 1,875 orders … unable to group them by customer".

## Root causes (from the recorded tool calls, tasks 179, 190, 191)
- R1: `App.tsx` keeps a second, hand-written list of routes Orbit may open; `/security` was never added.
- R2: every `ask_database` result is reported as failed: the data assistant's replies have no `success`
  field, so the tool runner labels them "Failed." (even correct answers, e.g. a user found by email).
- R3: grouped/ranked questions are impossible: the AI planner gets 15 s (Laravel) / 30 s (Python) while the
  local model needs longer on this CPU, so both sides silently fall back to keyword planners. Any question
  containing "count" becomes `SELECT COUNT(*) FROM orders` — a wrong answer presented as an answer.
- R4: secret-like columns (otp_code, verification_code…) were returned in results.

## Work items
| ID | Item | Status | Verified by |
|---|---|---|---|
| F1 | Navigation uses the server catalog's pages (one source of truth) + test that every catalog page is a real route | DONE | orbitCatalogConsistency test; frontend 50/50, tsc |
| F2 | Data assistant replies carry `success` + `message`; failures are honest and specific | DONE | NaturalLanguageDataAgentTest; real browser runs |
| F3 | Questions answered by a model-written SELECT through the validated read gate (AGENTS.md): AST parse, single statement, allow-listed tables and functions, columns checked against the live schema, secret columns refused, forced LIMIT, read-only transaction + timeout; bounded repair with the real error; no silent keyword guessing | DONE | test_data_sql.py 21, Laravel data suite, real-model probes vs ground truth |
| F4 | Secret column patterns: one-time/verification/reset codes, 2FA | DONE | classifier checks |
| F5 | Clear step labels in "What Orbit actually did" (which page opened, what was shown) | DONE | real browser: "Opened Security & Guardrails." |
| F6 | Tests (Python gate, Laravel data agent, frontend) + real run with qwen2.5:3b against a synthetic shop database (Hindi/Hinglish questions) | DONE | see PROGRESS (final runs #6) |
| F7 | Focused path for data questions (schema-derived data_hint -> small route call -> ask_database -> small answer call) | DONE | Laravel tests; real browser runs |
| F8 | Replies must contain every verified fact (retry once, else factual sentence); no question echo | DONE | Laravel tests; real browser runs |
| F9 | Focused path opens catalog pages (page_hint) | DONE | Laravel + Python tests; real browser 20–28 s |
| F10–F13 | Gate checks: duplicating joins, filter transparency, question-grounded filters, rankings without sorting / over raw child rows (model critic tried and removed: measured worse) | DONE | live evaluation 16/16 with reference SQL |
| F14 | No raw validation errors for the user: open_form for any surface; model slips hidden from the timeline (kept in audit); "adjusted" for not-on-screen / rejected values; dropdown label matching; partial fills reported | DONE | Laravel test; frontend tsc |
| F15 | Movement-synced actions (arrival events), navigation tap -> page render -> arrive on page, captions held until read/spoken, softer flight, placement beside heading text and inside the content area | DONE | real-browser sync measurement (shots/sync4) |
| F16 | Unhurried explanations and tours (policy, 1400-char speech) | DONE | real model: explanation answered in 146 s |
| F17 | Waits instead of failing on a busy machine: decision 480 s, model call 450 s, SQL writer 420 s | DONE | real run of "can you create one automation for me" (task 218: SUCCEEDED, no failed steps) |
| F18 | A new message during a running turn is merged into it on every cache driver (lock probe instead of Cache::has, which missed array/database locks; .env.example ships database) | DONE | supersede test + new dead-worker re-queue test |

## Rules that must still hold
- Reads only through the gate; writes never model-written; no DDL; blocked tables stay blocked.
- Secret columns never returned or sent to a model; PII masked unless revealed (audited).
- If a question cannot be answered safely, say so — never present a different query's result as the answer.
