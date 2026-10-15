# Orbit Agent Upgrade — Test Results

Date: 2026-10-15. All numbers below are from real runs on the development machine. CPU-only Ollama on 4 cores and 15 GB RAM, shared with desktop applications; load average 8–12 during the live runs, swap nearly full.

## Automated suites

| Suite | Command | Baseline (before) | After |
|---|---|---|---|
| Laravel feature | `cd laravel && php artisan test` | 89 passed | **101 passed** (870 assertions); agent suite now 23 |
| AI service | `.venv/bin/python -m pytest ai_service/tests -q` | 18 passed | **26 passed** |
| Root Python | `.venv/bin/python -m pytest tests -q -p no:cacheprovider` | 67 passed | **58 passed** |
| Frontend unit | `cd frontend && npm test` (Node test runner) | 7 passed | **24 passed** |
| Frontend build | `cd frontend && npm run build` | clean | **clean** (chunk-size warning only) |

The suites changed in two ways:

- **Removed tests:** 9 root-Python tests and 8 AI-service tests asserted the old keyword-router contract (`/v1/ai/agent/plan`, regex slot extraction). They were removed together with that router. The 11 old Laravel agent tests were rewritten for the new loop (22 tests now).
- **New tests prove:**
  - no keyword routing (the same word gets whatever the model decides);
  - retrieved passages actually appear in the Ollama request, and `rag.used` is false when nothing was included;
  - a missing model is reported, never silently swapped;
  - repair is bounded;
  - PHP empty arrays are accepted at the protocol boundary;
  - the screenshot regression (a status question with the create form open checks status and never asks for a name);
  - connection creation asks only for the password, then tests, saves and reloads to verify;
  - the test password appears nowhere in tasks, messages, tool calls, UI actions, timeline, events or model requests;
  - unknown tools and extra arguments are rejected;
  - cross-tenant IDs are rejected;
  - confirmation works by button and by a spoken "yes" only after Orbit asked;
  - service errors are reported without any fallback;
  - repeated failed calls are not re-executed;
  - repeated successful calls are not re-run, and the turn is not reported as a success;
  - a missing secret twice leads to a secure-channel request;
  - an unresponsive browser does not block backend work;
  - a mid-turn utterance supersedes the plan;
  - Stop and Pause work;
  - UI acknowledgements are owner-scoped;
  - character state has no success without a server `SUCCEEDED`;
  - the action bridge returns `not_mounted`, never a fake `ok`;
  - the target registry ignores detached elements;
  - the pose library covers every required state.

## Live acceptance (real `qwen2.5:3b`, real `nomic-embed-text`, real agent queue worker, synthetic demo MySQL on 127.0.0.1:3308, fresh synthetic account)

Harness: the API calls the browser makes (`POST …/messages` → poll the task → read the persisted reply). No browser was attached, so visible UI steps were recorded as `headless`.

### Run 2 (after timeout tuning)

| # | Utterance | Outcome | Time |
|---|---|---|---|
| 1 | "hey Orbit, how are you today?" | ✅ Model `ANSWER`, source `model`: "I'm just here to help you with your tasks today. How can I assist you with DataAuto?" | 63 s |
| 2 | "what is this project about?" | ✅ Model `ANSWER` grounded in 3 retrieved product passages (`product:doc_999999_chk_1/3/20`) | 86 s |
| 3a | "connect my mysql database demo_blog_cms on 127.0.0.1 port 3308 as user root, call it Blog DB" | ✅ No name/host/port questions. The model tried the test twice without the password; the guard ended the turn with a secure-field request (`WAIT_FOR_USER`, `database_password`). | 163 s |
| 3b | Password via the secure field | ⚠️ The real MySQL test passed (8.0.46, 2.45 ms), but the model kept re-testing and never called save. It also invented `connection_id: 1` once (the gate rejected it as `NOT_FOUND`). The turn ended with a system summary that was wrongly marked `SUCCEEDED`. | 575 s |
| 4 | Status check with the create form open | ❌ AI service HTTP 422 (PHP `[]` for an empty `args` object). Reported honestly as a service notice. | 200 s |
| 5 | "which tables does Blog DB have?" | ❌ Same 422 | 95 s |

**Fixes applied after run 2:**
- `[]` is coerced to `{}` at the protocol boundary, with a regression test.
- A successful test of new details returns a typed `next_step` hint to save.
- A loop-guard summary counts as `SUCCEEDED` only after a committed, verified write.
- The prompt is sharper about never inventing IDs.

### Run 3 (after the fixes) — interrupted, not completed

Run 3 was stopped before finishing. Under heavy swap the first decision took about 10 minutes. Then the agent tables in the dev database (`agent_tasks`, `agent_messages`, most of `agent_conversations`) were emptied from outside the application: users and connections were untouched, and no application code, schedule or test deletes these rows. Run 3 therefore has no result to report. The fixes from run 2 are covered by automated tests, not by a completed live run.

### "Stuck in Queued" (user report)

**Cause:** only one `agent` worker existed. While it was busy with a long turn (here, my acceptance run on a swapping CPU-only model), every other turn waited in the queue. The panel showed an open-ended "Queued — starting shortly".

**Fixes:**
- `run_all.sh` starts two agent workers.
- Workers send a liveness heartbeat (queue `Looping`/`JobProcessing` events).
- Queued tasks report their real position and whether a worker is alive (`AgentQueueStatus`, returned by the task and conversation endpoints and polled every 4 s while queued).
- The panel says "Waiting behind N other Orbit task(s)", or warns that no Orbit worker is running.
- Covered by `test_queued_turn_reports_real_position_and_worker_liveness`.

## Known limitations observed

- **Latency:** on this machine one model decision took 20–200 s, and longer when swapping. The agent runs on a background queue, so this is slow but not lost work. A GPU, a smaller context, or a lighter model reduces it.
- **Small-model reliability:** `qwen2.5:3b` sometimes repeats a successful call or ignores a hint. Server-side guards stop the loop safely and report only what was verified, but they cannot make the model finish a workflow it doesn't choose. A larger local model or a cloud provider improves completion.
- **Unexplained deletions:** during run 1, two agent jobs from another account failed because that account's rows were deleted mid-turn. The source was not identified. The orchestrator now ends such turns quietly.

## Round 3 (on-screen operation, reliability, memory, 3D character)

| Suite | Result |
|---|---|
| Laravel feature (`php artisan test`) | **108 passed** (945 assertions); agent suite 30 |
| AI service (`pytest ai_service/tests`) | **31 passed** |
| Root Python (`pytest tests`) | **58 passed** |
| Frontend unit (`npm test`) | **33 passed** |
| Frontend build | clean; Three.js in its own lazy chunk (140 KB gzipped) |

**New coverage:**
- **Laravel:**
  - UI tools are unavailable without a browser;
  - the real form is filled and the password is requested in the form (no second secure card);
  - the catalog blocks secret fills, unknown surfaces/actions and unconfirmed consequential presses (nothing reaches the browser);
  - a pressed save is verified on the server, and another user's id is rejected;
  - `/continue` is owner-scoped and rejects values;
  - the surfaces endpoint;
  - an unresponsive browser yields `UI_TIMEOUT` and the loop continues;
  - conversation memory carries facts and history skips service notices.
- **AI service:**
  - the streaming watchdog cancels a slow first token;
  - the deadline skips the repair;
  - the busy model lock reports `MODEL_BUSY_OR_SLOW`;
  - tool selection keeps core tools and caps the count.
- **Frontend:**
  - the registry refuses non-catalog surfaces;
  - secrets are never read back;
  - options match by id/label with ambiguity reported;
  - every catalog surface is implemented by a page and vice versa;
  - the timeline collapses and never spins after a turn;
  - face-texture redraw keys;
  - renderer choice.

**3D character:** headless-Chrome renders (software WebGL) of idle, success, thinking, pointing, celebrate, typing and error, compared with the design sheet and iterated twice (darker glass face, stronger irises, badge glow, star sparkles).

**Not yet verified live in a browser:** the full spoken flow ("connect my database" → Orbit opens the form, fills it, you type the password, Orbit tests and saves). It needs the restarted stack and a real browser session. The machine had ~250 MB free RAM and full swap during this round.
