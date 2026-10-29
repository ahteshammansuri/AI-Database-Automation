# Orbit: faster, deeper, clearer (2026-10-26)

## Request (owner, summarised)
- Some Orbit actions end in errors; sometimes Orbit says the same answer 2-3 times.
- Orbit is slow ("thinks too much"); answers should come quickly, be explained simply and calmly, spoken at an
  understandable pace.
- On any page Orbit should be able to explain in detail by actually operating it (open and close popups, show each
  control); it may first ask "Do you want the detailed version of this page?".
- Much stronger knowledge of the website, the user's data and database.
- Stronger task execution with a visible thought process; for long tasks it may ask to continue.

## Evidence (measured 2026-10-26 on the owner's own requests)
- A tour request ("tour of this project, travelling to each link") ran 12.5 min and ended with "needed more steps
  than I am allowed in one turn": one model call per go_to_page / show_me, 24 calls.
- Each model decision took ~17-65 s. The owner's planner is Gemini `gemini-3.5-flash`, which answers HTTP 429
  (quota exceeded) on every call; the adapter retried it 4 times with back-off before falling back to
  `gemini-3.5-flash-lite`, which itself took 20-29 s for a trivial prompt (Google-side latency;
  `gemini-3.8-flash` 503 "high demand", `gemini-flash-latest` > 60 s). Prompts are ~8.5k tokens per call.
- Delete flow errors: "Array to string conversion" in preview_data_change; after the user confirmed,
  confirm_data_change answered "resource not found"; the confirmation request was repeated word for word.

## Plan
| # | Item | Status |
|---|---|---|
| S1 | Provider calls: no back-off retries on quota/high-demand errors, remember an unavailable model for a while, move to the next model at once, cap a stalled call; tell the user which model answered and why. | DONE |
| S2 | Fewer model calls per request: a decision may carry follow-up on-screen steps (`then`) run without asking the model again; `finish_after` ends an action request with the verified result. | DONE |
| S3 | Tours: `give_tour` (whole portal) and `explain_page` (one page, overview or detailed: opens and closes forms, popups and tabs, points at each control) run in the browser in one call, narrated in step with speech; afterwards Orbit offers the detailed version. | DONE |
| S4 | Fix the data-change errors and the repeated confirmation; a typed "yes" for a delete gets a clear instruction instead of the same question. | DONE (fixed by a parallel session; verified by its regression tests, no new log errors) |
| S5 | Visible thinking: Orbit's short reasoning and plan shown live in its panel. | DONE |
| S6 | Knowledge: detailed guides (every page and control, data and database concepts, troubleshooting) stored in the database. | DONE |
| S7 | Speech: calm, slightly slower pace with sentence pauses; no duplicate speech. | DONE |
| S8 | Tests, docs, report. | DONE |

Progress, test results and what is still external: see PROGRESS.md.
