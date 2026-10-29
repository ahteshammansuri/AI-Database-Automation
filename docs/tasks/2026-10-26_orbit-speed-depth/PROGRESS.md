# Progress: Orbit faster, deeper, clearer (2026-10-26)

Nothing is committed (owner's instruction).

## S1 Provider calls (done)
- `ai_service/app/providers/cloud_providers.py`: a quota error (HTTP 429 "quota") is never retried; an unavailable model is
  remembered for a while (cooldown) and skipped; Gemini moves to the next model at once
  (`gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.8-flash`); a stalled call is capped at 45 s.
- `ai_service/app/usage.py` + `routers/agent.py`: notes about which model answered travel back as `model_notes`; Laravel shows
  them once per turn on the timeline (`MODEL_FALLBACK`) and in Orbit's thinking line.
- Tests: `ai_service/tests/test_provider_fallback.py` (4).

## S2 Fewer model calls (done)
- Decision fields `thought` (≤240 chars), `then` (≤6 on-screen steps), `finish_after`; validated in the AI service
  (`then` only with CALL_TOOL, only go_to_page / open_form / fill_fields / choose_option / show_me / press).
- `AgentOrchestrator`: runs `then` steps right after the tool call without another model call, only when
  `chainable()` (a press only of a non-consequential, non-destructive action), stops at the first failure;
  `finish_after` ends the turn with the verified result.
- Policy: "Be quick and calm" (think once, act; short calm sentences), and long work is announced with its rough
  duration and asked about first unless the user clearly asked for it.

## S3 Tours (done)
- Table `orbit_page_tours` (14 pages, 69 steps) and `PageTours` (validated against the surface catalog; presses
  only of actions that change nothing; row actions use the first listed row).
- Tools `give_tour` and `explain_page` (overview / detailed), one tool call each; afterwards Orbit offers the
  detailed version.
- Browser (`frontend/src/services/orbitRuntime.ts`): runs the steps visibly (travel, point, open, press, close the
  popup with its own Close button, never with Escape because Escape stops Orbit's task), shows each sentence as a
  caption, speaks it when voice replies are on and waits for the speech to end; a new message or Stop ends the tour
  at once; closes any window it opened.
- Admin panel: Orbit › Page tours (list with a per-tour check, create/edit with step pickers limited to the page's
  parts and, for presses, to buttons that change nothing; a server-side check names any step that would not run;
  every create/edit/delete is in the admin activity log). Permission: `orbit_knowledge.view` / `.manage`.

## S4 Data-change errors (done in a parallel session)
- The "Array to string conversion" errors in `DataChangeService` (last logged 12:41 UTC) stopped after that
  session's fix (13:09 UTC); it added `test_preview_delete_and_update_with_array_filters` and
  `test_delete_confirmation_phrase_accepts_quotes_and_case_insensitive`. Not redone here.

## S5 Visible thinking (done)
- Live event `agent.thinking {task_id, text, next[], model}`; `next` is in plain words ("Go to Data",
  "Press \"Review\"", "List database connections").
- Orbit's panel shows a "Thinking" box with the thought and the numbered next steps while the task runs.

## S6 Knowledge (done)
- Migration `2026_10_26_000002_add_orbit_depth_guides`: four new guides in the database (added only when missing):
  Databases explained simply, Your account/users/workspace, Troubleshooting, Working with Orbit. Every statement was
  checked against the code (for example: suspension signs out and blocks sign-in; it does not pause automations, so
  the guide does not claim that).
- Published to the AI service: 9 guides, 124 sections (was 5 / 79), semantic search (ollama:nomic-embed-text).

## S7 Speech (done)
- Default speech rate 0.95 (was 1.05; the old stored default is moved to the new one, no screen ever set it).
- Within one turn the same sentence is not spoken twice (narration followed by an identical reply, or a reply
  delivered twice; a new message resets it); this complements the 4 s narration de-duplication added by the parallel session.

## S8 Tests and verification
- Frontend: `tsc --noEmit` clean; `npm test` 77/77; oxlint: no new warnings in the changed files.
- AI service: full suite 100 passed (includes 3 new decider tests; `test_busy_model_lock_reports_busy_not_crash`
  was already failing before this work because it sent the mock provider, which never takes the local-model lock;
  it now names `ollama`).
- Laravel: `tests/Feature/OrbitPageToursTest.php` 9 passed (96 assertions). Full suite: 264 passed, 26 failed,
  1 skipped. Every failure was traced:
  - 21 need the synthetic demo MySQL on 127.0.0.1:3308, which is not running here ("Connection refused"):
    RelationshipResolverService (5), Phase6FeatureFlags (4), PostPublicationAndStagedDiagnostics (3),
    AgentAutonomousAction (3: status question, connection creation, unresponsive browser), IntelligentRelational (2),
    SafeExecutor, IdempotencyExecution, ManualPublishAndScheduler, DeadlinePolicy.
  - 1 needs the PHP PostgreSQL driver (not installed): NaturalLanguageDataAgent postgres test.
  - 1 was already failing before this work: NoveltyCheckTest passes an AiServiceClient mock where
    GenerateAutomationContentJob expects a ContentPipeline (both files unchanged since the last commit).
  - 1 failed because the AI service was down at that moment: SafeDataWrites "ast read gate"; with the service
    started the whole file passes (11/11, including the parallel session's data-change regression tests).
  - 2 in AgentAutonomousActionTest came from the parallel session's orchestrator edits, and one exposed a real bug:
    the "confirmed, do not repeat it" note was attached after the observation had been recorded, so the model never
    saw it (a cause of repeated steps). Fixed in `AgentOrchestrator` (note set before recording). The same session
    made a repeated successful call end the turn at once with the verified result (no extra model call); two test
    expectations were updated to that behaviour. That file now: 38 passed, 3 failed (the demo-DB ones above).
- Services: queue workers were restarted gracefully (`queue:restart`). Later the whole `run_all.sh` stack was found
  stopped (it only stops on Ctrl+C / a termination signal, which `queue:restart` does not send). It was not
  relaunched from here; start it again with `./run_all.sh`, which also loads all the new code.

## Not verified / still external
- The in-browser tour (travel, popups, speech timing) was type-checked and its server side tested, but not watched in
  a real browser in this session: no browser automation is installed. Try "walk me through this page in detail" on
  Approvals or Data.
- Speed still depends on the model: Gemini `gemini-3.5-flash` was out of quota and `flash-lite` took 20-29 s per call
  on Google's side. A paid tier or a faster model for "Orbit and planning" (AI Providers) is what makes each step fast.
- Suspending a customer does not pause their automations (only data autopilots check suspension). Not changed here.
