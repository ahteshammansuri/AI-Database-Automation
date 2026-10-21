# Orbit reliability fixes — progress log

Newest entries at the bottom.

## 2026-10-19
- Investigated the three reported failures from the recorded tool calls (tasks 179, 190, 191); root causes R1–R4 in PLAN.md.
- F1 DONE: App.tsx no longer keeps its own route list; Orbit may open exactly the pages in the server catalog. New test: every catalog page is a real <Route> and no second route list exists. Frontend 50/50, tsc clean.
- Extra root causes found while fixing: (R5) the Python planner called get_provider(model_name=...), a
  TypeError that always forced its keyword fallback; (R6) query errors from the database were ignored and
  reported as "no matching records"; (R7) Orbit's model could set reveal_pii itself; (R8) model-written
  joins to child tables inflated counts (real qwen output for the refund question: 6 instead of 2).
- F2 DONE: every data-assistant reply has success + message (normalised at the entry point); failures say
  why (MODEL_BUSY_OR_SLOW, QUERY_NOT_ANSWERED with the last reason, TABLE_BLOCKED, ...).
- F3 DONE: new /v1/ai/data/sql (user's model writes one SELECT from the live schema slice: real types,
  enum values, references, sampled categorical values) and /v1/sql/validate-select (sqlglot: single SELECT,
  allow-listed tables and functions, columns resolved against the readable schema so secret columns and
  blocked tables cannot be referenced, fan-out guard with real foreign keys, forced LIMIT). Laravel runs it
  read-only with timeout + masking + audit, retries with the exact gate/database error (max 3), never
  substitutes another query. Keyword planner and hard-coded "Rajasthan->RJ" mapping removed; real values
  are sampled instead. Ranked answers detect ties and widen a top-N that ended inside a tie.
  Orbit can no longer unmask PII (reveal_pii removed from the tool). Decider policy: ask once, answer from
  rows in the user's language, name ties.
- F4 DONE: secret patterns for otp, verification/reset/recovery codes, 2FA/MFA, PIN.
- F5 DONE: steps read "Opened Audit Logs.", "Showed Dashboard: …" instead of "Done on screen.".
- Real model probe (qwen2.5:3b, shopfx fixture, no mocks): "Which customer has placed the most orders?"
  -> Rahul Verma 8 (correct); Hinglish refund question -> tie at 2 (correct after fan-out guard; was 6);
  "Aisa kaun sa customer hai jismein bahut hi jyada order kiye ho" -> Rahul Verma 8 (correct);
  "Rajasthan ke kitne users hain?" -> 13 via sampled 'RJ' (correct); top spender -> Rahul Verma 349506.81
  (correct); refunded orders -> 24 (correct); top 3 products by quantity -> correct. 18–169 s each.
- Tests: Python 21 new (gate + writer), suite 62/63 (pre-existing busy-lock failure); Laravel data agent
  15/16 (postgres driver missing); frontend 50/50.
- Real browser run (full stack, qwen2.5:3b, QA user with the shopfx fixture) #1: first decision timed out
  (>280 s). Cause: the owner's own run_all.sh stack was running, so my extra agent/default workers (13:39)
  competed with theirs for the model; stopped my extra processes. Owner's workers were reloaded with
  `php artisan queue:restart` (they run in supervised loops) so they use the new code; the owner's AI
  service runs with --reload and picked up the Python changes by itself.
- Run #2: decision in 126 s, but the model misread the Hinglish question and asked the user for the answer.
  Fix: runtime_context.data_hint — tables and stored enum values of the user's own databases named in the
  utterance (from the latest scan or the cached live catalog; e.g. users, orders, orders.status='refunded';
  nothing for "tour me" or "remove my document"); policy: data_hint => call ask_database, never ask the
  user to supply the answer. Verified on the owner's Choviet102 schema too (users, orders). Test added.
- Found by a sweep of every read tool: lookup_table_values called a method that does not exist (always
  failed). Now uses the same lookup as the portal dropdowns. Regression test added.
- Run #3 (with data_hint): the big decision prompt still asked "Please provide the ID of the user" — a 3B
  model inside a ~6k-token prompt does not reliably follow one more rule. Structural fix (still model-driven):
  F7 focused path for data questions. Only when data_hint is present: a small model call (/v1/ai/agent/route)
  decides whether the WHOLE message is one read-only data question and restates it in English; ask_database
  runs through the normal gate and timeline; a second small call (/v1/ai/agent/answer) writes the reply
  from the verified rows in the user's language. Anything else (changes, portal actions, several requests,
  a failed routing call) goes to the full agent loop unchanged.
- Run #4 (focused path): both reported questions SUCCEEDED with correct data (refunds: the true 6-way tie at
  2; most orders: Rahul Verma 8) in ~2–2.5 min, but the small model's wording was poor ("Rahul Verma ki
  bahut hi jyada order kiye ho" without the 8). Fix F8: the data assistant returns plain factual sentences
  and `facts` (names/numbers the answer must contain); Orbit checks the reply contains every fact (numbers
  matched as whole numbers, separators ignored), retries once naming what was missing, else speaks the
  factual sentence. Tests: Laravel Orbit suites 67/72 (5 environmental), Python 27/27 new.
- Run #5: refund SUCCEEDED 112 s (true 6-way tie) but reply was a bare list "2, Vihaan Verma, ..."; most
  orders SUCCEEDED 99 s "Rahul Verma ki order_count 8 hai."; "Please open the security page" SUCCEEDED
  (Opened Security & Guardrails — tour bug fixed in a real browser) but took 547 s via the full loop.
  Fixes: factual sentences use words, not column names ("Rahul Verma has the highest order count: 8 (next:
  Aarav Sharma with 7)", "It is a tie: 6 share the highest refunds (2 each): ..."), highest/lowest from the
  real sort order; a reply that is only the list of facts is retried, then the factual sentence is used.
  F9: the focused path also opens pages: pageHint comes from the server catalog's page titles/routes
  (e.g. "security page" -> /security, "audit logs dikhao" -> /audit-logs; none for "tour me"); the router
  may return open_page only for a route in the catalog; go_to_page runs through the normal gate.
  Tests: Laravel Orbit suites 69/74 (5 environmental), Python 70/71 (pre-existing busy-lock).
- Final real browser runs #6 (owner's own run_all.sh stack, reloaded with queue:restart; qwen2.5:3b; QA user
  on the shopfx fixture): refund question SUCCEEDED 173 s — all 6 users tied at 2 refunds named, in
  Hinglish; most-orders question SUCCEEDED 256 s — model wording failed the fact check twice, so the verified
  sentence was spoken: "Rahul Verma has the highest order count: 8 (next: Aarav Sharma with 7)."; "audit logs
  ke baad security page kholo" SUCCEEDED 20 s (opened Security & Guardrails). Echo of the question in
  replies is now stripped (test added).
- Docs: security_guide, product_context_rag (data questions), ADR-017, README.
- Cleanup: QA user 71 (qa.data+probe@example.test), its token, conversations, audit rows and FAISS folder
  deleted; my extra workers/Vite stopped; the owner's stack left running.
- Known limits: a data question needs 3–4 local model calls (route, SQL, reply, maybe a reply retry), so
  ~2–4 min on this CPU under load; the full agent loop (tours, multi-step tasks) is still slow on CPU.
- Full Laravel suite: 173 passed, 27 failed. Checked every failure: all environmental — the demo MySQL on
  3308 is not running (DeadlinePolicy, ManualPublish, Idempotency, SafeExecutor, RelationshipResolver,
  PostPublication, IntelligentRelational, Agent tests that test real connections), the PHP pgsql driver is
  missing (postgres tests), the AI service was not running for the AST read-gate test (passes with it:
  verified), plus NaturalLanguageQueryAccuracyTest. That suite only asserted that 60 questions returned the
  type "data_query" (always true under the old keyword planner, even for wrong answers) and now needs the
  live model. Replaced it with a real accuracy evaluation: 15 questions with hand-written reference SQL on
  shopfx, rows compared with what the database returns; opt-in via ORBIT_LIVE_EVAL=1 (skipped otherwise).
  The owner's run_all.sh stack was stopped at this point (not by me); I started a temporary AI service on
  8001 only for these checks.
- Live accuracy evaluation (real qwen2.5:3b, shopfx, reference SQL): run 1 = 14/15 (291 s; miss: average
  order total with an unrequested status filter). Fixes: prompt rule against unrequested filters; answers
  now state the query's real WHERE ("Counted only rows where ..."), taken from the gate; ranking words only
  when the query really sorts by that value. Run 2 = 13/15 (miss: same filter; "out of stock" written as
  stock > 0 with a duplicating join). Fixes: F10 gate refuses a plain list that joins an unused child table
  (repeats rows); F11 one focused accuracy check per question (/v1/ai/data/sql-check: unrequested filters,
  inverted conditions, wrong calculation) -> one rewrite with the stated problem; never blocks if the check
  is unavailable. Tests: Python +3, Laravel +2.
- Run 3 (with the accuracy check) = 11/15: the 3B critic raised false problems and its rewrites broke
  correct queries (RJ -> 'Rajasthan', most -> lowest, SUM -> COUNT). Measured, so REMOVED the critic
  entirely (code, endpoint, tests). Kept: duplicate-join refusal, filter transparency, ranking wording.
  Allowed EXISTS (safe; subquery tables validated) — the duplicate-join message suggests it. Prompt: generic
  comparison-direction guidance. Eval strengthened: "out of stock" had a zero-row truth (any empty result
  passed); replaced by "fewer than 100 units in stock" (10 rows) and "cost more than 50000" (2 rows).
- Run 4 (no critic, 16 questions) = 13/16: misses were two unrequested filters (status on the average,
  is_active on the highest price) and an unsorted "top 3". F12: deterministic, question-grounded checks in
  the gate — a WHERE condition counts as asked if the question mentions its column, one of its values (prefix),
  its number, or a word the value abbreviates ('RJ' <- Rajasthan); ranking words with no ORDER BY are
  flagged. One rewrite with the exact issue; if the model insists, the answer is given with its real filter
  stated (never hidden, never a failure). Tests: Python +9 cases, Laravel +2.
- Run 5 (question-grounded checks) = 15/16: both unrequested filters fixed (average over all orders
  48994.19; highest price 67356.99). Remaining miss: "top 3 products by quantity sold" sorted raw
  order_items rows without GROUP BY (the model's own assumptions said "sum of qty"). F13: the gate flags a
  ranking question whose ORDER BY uses a child table's column without aggregation (real foreign keys) ->
  one rewrite: GROUP BY the entity and SUM/COUNT the child value. Test added.
- Run 6 = 16/16 (345 s, ~22 s per question, qwen2.5:3b on CPU): every answer matched the reference SQL.
- Final checks: frontend tsc clean, 50/50, oxlint 0 errors; Python 82/83 (pre-existing busy-lock test);
  Laravel full suite reviewed: all remaining failures environmental (demo MySQL on 3308 down, PHP pgsql
  driver missing). Temporary AI service stopped; probe users (71, 72) deleted. The owner's stack is stopped:
  start it with ./run_all.sh to use the changes.

## 2026-10-19 (round 3) — "Invalid arguments: argument 'surface' must be one of: connections.form"
- Cause (task 211): open_form(builder.setup) — the builder steps are not pop-up forms, so the gate refused
  it and the raw validation text (meant for the model) was shown to the user in red. Task 212 showed the
  same pattern (field 'operation_mode', "Some fields were not accepted") although the run then completed.
- F14: open_form accepts every catalogued surface (a step-page surface is brought on screen by visiting its
  page). The model's own malformed calls (INVALID_ARGS, UNKNOWN_TOOL) are kept in the audit records and
  still explained to the model, but not shown in "What Orbit actually did"; "not on screen" and rejected
  values are shown neutrally as "adjusted". fill_fields matches dropdown labels to real options and reports
  partial fills ("Filled name, table. Not accepted: operation (…)").
- F15: movement-synced actions. Every action waits for Orbit's real arrival (flight animation finished,
  "arrived" stage event; 2.2 s cap), settles, gestures, then acts. Navigation: fly to the sidebar link, tap,
  navigate, wait for the page's sections to render, then fly to the page's main area (or its title).
  show_me waits until the caption could be read (2.5–9 s by length) and narration has finished. Softer
  flight spring; the flying pose lasts until arrival. Orbit stands beside a heading's text and stays inside
  the content area (never over the navigation).
- F16: unhurried explanations: speech limit 1400 chars; policy asks for a complete 4–8 sentence
  explanation from retrieved knowledge (what it is, the main flow, safety, how Orbit helps) and, for tours,
  2–3 sentences per page with a caption, then a summary.
- Verified (real browser, real live channel, no model): at every page change Orbit was exactly at the
  sidebar link and had been still for 300 ms; afterwards it flew to the page (Connections, Security, Audit
  Logs); captions stayed 7.6–8.4 s; screenshots in the session scratchpad (shots/sync4). Tests: Laravel +1
  (slips not shown, builder step opens), frontend 52/52 (stage arrival test), tsc clean.
- F17 (real model, owner's running stack, load average ~20): "explain this project" answered in 146 s with
  a complete overview. "can you create one automation for me" first timed out under load (build1); after
  raising the waits it SUCCEEDED (task 218, ~300 s): go_to_page /automations/new, then it asked for the
  database details (the probe user had no connection). Timeline: knowledge lookup, Go to New Automation;
  no red steps.
- F18: the running-turn check used Cache::has() on the worker's lock key, which only works on the file and
  redis stores; on array/database (the .env.example default) a mid-turn message queued a second turn
  instead of being merged. Now probes the lock itself. The stale supersede test now holds a real lock, and
  a new test covers a RUNNING task whose worker died (re-queued).
- Final checks: Orbit suites 75 passed, 4 failed: 3 need the demo MySQL on 127.0.0.1:3308 (not running) and
  1 needs php8.3-pgsql. Frontend 52/52, tsc clean, oxlint 0. Probe user 73 and its index deleted. The
  owner's queue workers were reloaded with `php artisan queue:restart` during verification.
