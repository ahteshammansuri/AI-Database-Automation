# Orbit agent upgrade — progress log

Append newest entries at the bottom. Each entry: date/time, item ID, what changed, how it was verified,
what is next.

## 2026-10-16
- Audit of the existing Orbit stack done (orchestrator, decider, gate, runtime, surfaces, catalog, rig).
  Findings and work items written to PLAN.md. Next: O1 (broken tools).
- O1 DONE. New `laravel/app/Services/Agent/Tools/AutomationTools.php` (list, details, create, update, delete,
  run now, preview, executions, retry, explain failure, edit published record, pending approvals, approve,
  reject) using the real jobs and the portal's status rules; shared validation moved to
  `App\Services\Automation\AutomationConfigService` (also used by AutomationController). Also fixed:
  pending approvals used a missing relation and had no version_id; update_published_record called the
  executor statically with the wrong signature. Verified: OrbitAutomationToolsTest 9/9. Next: O7 audit tools.
- O7 DONE: `Tools/AuditTools.php` — list_audit_logs now searches (query, action, resource_type, since, until)
  with real totals, first/last time, counts per action; new get_audit_log_entry (secrets and review links
  hidden). Verified: OrbitAuditToolsTest 2/2.
- O2 DONE: orbit.max_iterations 24, max_turn_seconds 1500; RunAgentTurnJob timeout 1560 on a new "agent"
  queue connection (retry_after 1620); run_all.sh / docker-compose agent worker --timeout 1600.
  Decider: context window sized to the prompt (AGENT_NUM_CTX_MAX 12288), decision budget 512 tokens,
  older observations condensed (last 6 verbatim). NOTE: restart run_all.sh so workers use the new timeout.
- O8 DONE (text): decider SYSTEM_POLICY gained long-request slot capture + plan, validation feedback,
  confirm-then-press for deletes (Orbit clicks the page popup), tours, accuracy rules, bubble narration.
  Next: O4 (visible typing + confirm popup), then O5 (bubble), O3 (surfaces).
- O4 DONE. Visible operation + popup confirmation:
  - `orbitRuntime.ts`: fill_fields types text progressively through the page's own setter (capped ~1.4 s,
    ~2.2 s for textareas; instant for reduced motion / non-text). press: when the server marks the press
    `user_confirmed`, Orbit waits for the page popup, flies to "dialog.confirm" and clicks it; it stops
    waiting as soon as an action without a popup finishes.
  - `ToastContext.confirm()` (promise; always settles, also when replaced/closed); popup buttons are Orbit
    targets. Connections remove, Automations delete, Knowledge remove and Executions cancel now use the same
    popup for the human button and Orbit's action (Orbit's surface actions used to delete without a popup).
  - Mascot layer z-[70] so Orbit is visible above the popup backdrop.
  - Server: ToolRunner adds `user_confirmed` only for confirmed consequential presses. NEW rule: destructive
    steps (catalog `destructive`, meta `confirm_by_button` on disconnect/remove_automation/remove_knowledge)
    are confirmed only by the panel's Confirm button, never by a typed "yes" (the model reads that).
    If the model ends a turn with a plain question after CONFIRMATION_REQUIRED, the task still goes to
    WAITING_FOR_APPROVAL so the Confirm button shows. Portal map marks destructive actions `!!`.
  - Decider policy: corrected "deleting data is unsupported" (guarded row DELETE exists via
    preview_data_change when the connection allows it); explained `!!`.
  - Verified: AgentAutonomousActionTest 29/33 — all confirmation tests pass; the 4 failures are pre-existing
    (3 need the demo MySQL on 3308, which is down; 1 "supersede" test never sets the worker heartbeat key).
    Decider tests 20/21 (same pre-existing failure). Frontend: tsc clean, 39/39, oxlint 0 errors.
  Next: O5 (speech bubble next to Orbit), then O3 (surfaces), O6 (RAG docs), O9 (character), O10.
- O5 DONE. Speech bubble beside Orbit while the panel is closed (`OrbitSpeechBubble` in OrbitOverlays.tsx,
  logic in `services/orbitBubble.ts`): priority caption (show_me) > pending confirmation ("Open to confirm"
  opens the panel; confirming stays in the panel) > open question ("Reply") > current work (Orbit's own
  narration, else the running step label, else the real queue position/worker state) > latest reply
  (shortened, "Read more" when cut, hides after 5–14 s). Dismiss with ×. Markdown is stripped without
  changing identifiers or numbers (blog_posts, -5 stay exact). Bubble flips left/right and above/below so
  it stays on screen when Orbit travels. Replaces the old caption-only bubble.
  Verified: orbitBubble.test.ts (7), frontend 46/46, tsc clean, oxlint 0 errors.
  Next: O3 (catalog + surfaces), then O6, O9, O10 (O10 includes one real-browser check of O4 + O5).
- O3 DONE. Catalog + surfaces:
  - builder.mappings: dynamic how.<column> (fill choice, same options as the dropdown), value.<column> (fixed
    value or linked record, validated by kind: enum, yes/no, number, date-time, image URL, max length; linked
    records resolved by id or label through the lookup API), instructions.<column> (AI guidance). describe()
    gives each column's choice, allowed choices, plain-English meaning and problem. Column rows are Orbit
    targets (builder.col.<name>).
  - builder.content: length, content_format, image_provider, image_style, documents (+ describe).
    builder.schedule: timeout_policy. builder.review describe: rendered record, write plan, next runs.
  - approvals: refresh; `approve` now = for the scheduled time, new `approve_publish_now` (matches the
    page's two buttons; before, Orbit always published immediately). executions/knowledge/audit: refresh;
    audit: inspect(row). New /security page + security.page surface.
  - Accuracy fixes found on the way: Security page rewritten from the code (it said DELETE is forbidden,
    claimed HMAC-signed tokens and "SOC-2 ready", said rows are never read); access-mode descriptions on the
    connection form (said INSERT; "all writes blocked" while automations still insert); audit table showed a
    fake 127.0.0.1 IP; "keep as draft" text promised a later approval that the server refuses; Approvals
    list/Orbit listed drafts whose run had already ended (new ContentVersion::awaitingDecision scope + test);
    builder image-size explanation now uses the server's column-name rules; data reads now audit
    `pii_revealed`.
  - Verified: frontend 47/47 (consistency test now checks fields/actions), tsc clean, oxlint 0 errors;
    OrbitAutomationToolsTest 10/10 + approval tests 12/12; agent suites 46/51 (failures environmental:
    demo MySQL 3308 down x3, worker-heartbeat test, missing php8.3-pgsql).
- O6 DONE. Product RAG indexes every guide in docs/orbit-agent (one hash over all; sources named
  product:<guide>:<n>; headings "Guide › Section"; 4 product passages per question). Guides rewritten or
  added from the code: product_context_rag.md (updated: tools, confirmations, engines, no stale "planned"
  items), automations_guide.md, security_guide.md, portal_tour.md. Qdrant ingest uses the same folder.
  Verified: test_rag 3/3, Python 41/42 (pre-existing failure), real-embedder probe (8 questions) returns
  the right sections.
  OPEN QUESTION for the owner: automations/manual publishing insert regardless of the connection's access
  mode (documented honestly; behaviour unchanged).
  Next: O9 (character), then O10 (real-browser check of O4/O5/O3 + docs).
- O9 DONE. Character (same design, more life):
  - Smooth curved-eyelid blink (~220 ms, occasional double blink) instead of an on/off cover; a third eye
    sparkle; pupils a little bigger when listening, wide-eyed or petted.
  - Idle personality (calm states only, never while working): glances and curious head tilts every few
    seconds with an antenna boing; gaze follows the pointer only while it moves, then personality resumes.
  - Petting: pointer resting on Orbit while calm -> happy eyes, grin, blush, small wiggle.
  - Lip-sync: attack/decay envelope from real TTS word boundaries; mouth alternates wider/rounder shapes
    with friendly corners and a tongue hint when wide open.
  - Limbs: relaxed arms sway out of phase while breathing; hovering feet dangle; flying feet tuck and trail;
    a small squash when landing after flight. Motion code is now shared with the 3D renderer
    (rigMotion.motionLayers / rigPersonality).
  - Verified: rigPersonality.test.ts, frontend 49/49, tsc clean, oxlint 0 errors; headless-Chrome render of
    10 states and close-ups (temporary preview page, removed afterwards).
  Next: O10 (real-browser run of Orbit against the full stack + README/ADR/docs).
- O10 (in progress). Docs: README Orbit section corrected (visible typing, panel-only confirmation for
  removals, bubble, tours, SVG character is the default, agent worker command), ADR-016, IMPLEMENTATION_PLAN.
  Real-browser run #1 (full stack, qwen2.5:3b, headless Chrome as the QA user, "remove my knowledge document
  Old pricing notes"): the bubble showed Orbit's narration with the panel closed (works). The model guessed
  document id 123; the gate refused it (nothing removed), then the model asked the user for the id with a
  password box. Fixes: runtime_context now lists knowledge_documents with ids; NOT_FOUND refusals list the
  user's own items of that kind (never other users'); a model-requested secure box is shown only when a
  secret is really involved; policy: never ask users for internal ids. Regression test replays the run
  (AgentAutonomousActionTest 30/34, same 4 environmental failures). Re-running the browser scenario.
- O10 real run #2: first model decision exceeded the 300 s limit while tests were loading the CPU (4 cores);
  Orbit reported it honestly ("Nothing was changed") in the bubble. Measured the first decision's prompt:
  ~23k chars (policy 8k, tools 6.5k, portal map 2.9k, user part 3.8k). Fixes for latency: one fixed
  num_ctx (12288) for every agent decision (changing num_ctx made Ollama reload the model and drop its
  prompt cache), and the stable portal map now precedes the per-request tool list so the cached prefix is
  longer. Decider tests 20/21 (same pre-existing failure). Re-running the browser scenario.
- O10 real run #3: the model answered WAIT_FOR_USER "Are you sure you want to remove ...?" with no secret and
  no missing fields; schema validation rejected it 3 times (MODEL_OUTPUT_INVALID, nothing done). Replay
  showed the first decision now takes ~128 s (was ~250 s) after the fixed-context change. Fixes: such a
  plain question is normalised to ASK_CLARIFICATION; REQUEST_CONFIRMATION with nothing held by the gate
  becomes WAITING_FOR_INPUT (no dead Confirm button); policy now says: call the tool/press directly, the
  server holds it, then REQUEST_CONFIRMATION (the old text told the model to ask first, which left nothing
  to confirm). Decider logs invalid outputs (reason + first 400 chars). Tests: decider +1, agent loop +1
  (31/35, same 4 environmental failures). Re-running the browser scenario.
- O10 real runs #4–#5: Orbit found the document id itself (runtime_context), the gate held the removal, and
  the bubble showed "Needs your OK … Open to confirm" with the panel closed (screenshot shots/e2e4). After
  "Open to confirm" -> panel Confirm, the server ran the held removal (document gone, audited
  AGENT_KNOWLEDGE_DELETED). Found and fixed: (a) after the confirmed step the model tried more steps and the
  turn ended "partly succeeded" — the confirmed step is now registered as done (identical repeats are never
  re-run) and its observation tells the model it is complete; (b) pages did not refresh after Orbit used a
  backend tool — new useRefreshAfterOrbit hook on Knowledge, Connections, Automations, Approvals and
  Executions; (c) Knowledge/Landing pages claimed "sentence-transformers" embeddings — corrected to Ollama
  nomic-embed-text. Tests: +1 regression (confirmed step never repeated); frontend 49/49, tsc, oxlint 0.
  Running a final full scenario in a fresh conversation.
- O10 real run #6 (fresh conversation): PASSED end to end. First decision 108 s (bubble narration), "Needs
  your OK … Open to confirm" at 191 s, panel Confirm -> removal ran in ~2 s, the Knowledge list refreshed by
  itself to 0 documents, DB row gone, audit AGENT_KNOWLEDGE_DELETED (screenshots shots/e2e6 in the session
  scratchpad). Remaining issue seen: the model's closing reply asked "Would you like to confirm?" after the
  removal was already done. Fixed structurally: in a turn started by the panel Confirm, if the confirmed
  step succeeded and the model only re-asks (no further progress, nothing held, no multi-step plan), the
  turn ends with the verified result instead. Timeline now shows plain wording for held steps ("Held until
  you press Confirm in this panel"), not the gate's instructions to the model. Tests: +1 regression; agent
  suites 44/48 (same 4 environmental failures).
- O10 DONE. Real run #7 (fresh conversation, full stack, qwen2.5:3b, headless Chrome): bubble narration at
  ~118 s, "Needs your OK" at ~191 s, panel Confirm -> removal in ~2 s, list refreshed, task SUCCEEDED with the
  verified reply "Knowledge document 'Old pricing notes' removed from workspace." Last fix: when a removal is
  held for the panel button, the reply always ends "To go ahead, press Confirm in my panel." (the model had
  said "say yes").
  Final verification: Laravel Orbit suites 44/48 + approval suites pass (4 environmental: demo MySQL 3308
  down x3, heartbeat-less supersede test); Python 42/43 (pre-existing busy-lock test); frontend 49/49, tsc
  clean, oxlint 0 errors.
  Cleanup: stack processes I started stopped; QA user 70 + its data, media and FAISS index deleted (the index
  folder was tracked in git, so it shows as deleted); scratch DB autofx_scratch dropped; old 8011 AI service
  stopped. Not done (owner decisions): automations ignoring connection access_mode; ai_service/storage
  (per-user indexes) is tracked in git and should probably be ignored.
  Known limits: on this 4-core CPU the first decision of a turn takes ~2 min with qwen2.5:3b; the model
  sometimes uses a backend tool instead of pressing the on-screen button (both are gated the same way).
