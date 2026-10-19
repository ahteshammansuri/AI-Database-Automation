# Automation engine upgrade — status (2026-10-16)

Full details: `docs/IMPLEMENTATION_PLAN.md` (section "Automation engine upgrade"), ADR-014/015 in
`docs/DECISIONS.md`, `docs/QUEUE_AND_SCHEDULING.md`, `docs/API_CONTRACT.md`.

## Done and verified
- Schedule model (one-time/daily/weekly, end date, weekdays, timezone, 15-min gap, completion, missed runs).
- Field plan from live schema; AI-chosen parents created first with required columns; no guessed ids.
- AI service: field contract, no fabricated values, image generation (OpenAI/Gemini/local cover).
- Read-only write plan; HTML review email; honest delivery status; approval guards.
- Frontend: builder rewrite, custom pickers, calendar, rendered previews, manual publish review, history,
  approvals, mobile navigation drawer.
- Tests: PHP 29 new (all pass), Python 9 new (pass), frontend 6 new (pass). Screenshots at 390/1280 px.

- Real local-model run (qwen2.5:3b, CPU, isolated AI service on :8011): pipeline 100.7 s; 6 AI fields;
  existing category reused; 2 local covers; write plan valid; published as posts #1 with category_id 1
  and published_at set at write time; over-long meta_description shortened with a warning.

## Pending
- Delete the temporary QA account created for screenshots (script: scratchpad `qa_cleanup.php`; the user
  e-mail starts with `qa.visual+` and ends with `@example.test`) and `ai_service/storage/indexes/user_70/`.


## Cleanup (2026-10-16, during the Orbit upgrade)
QA user 70 (qa.visual+…@example.test), its media and `ai_service/storage/indexes/user_70/` deleted; scratch DB `autofx_scratch` dropped; the isolated AI service on port 8011 stopped.
