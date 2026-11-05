# AI field understanding, AI parent decisions, builder order, schedule defaults (2026-10-30)

Request: in automations and scheduled manual publishing, (1) linked records come first in the field step, (2) "AI chooses
or creates" really creates a new parent when no existing one fits the content (decided by the model), (3) columns set
to "Leave empty" move to the bottom, required columns are never hidden under "Other columns", (4) coded values
(status 1/2) are understood by AI and shown by meaning, (5) image columns are understood even when they store only an id
(blogs.banner -> uploads.id), (6) understanding uses the AI stack (embeddings, FAISS/RAG retrieval, the customer's LLM),
not fixed lists, (7) generation time defaults to now in the chosen timezone, publication to now + 15 minutes, (8) fix bugs
found, remove unused files and temporary test files. Do not commit.

## Findings
- The parent is chosen inside the one article-writing call ("Prefer one of these existing names ... only if none fits");
  small local models nearly always copy an existing name; nothing decides separately.
- choviet102 `blogs.banner` and `meta_img` are `int` (ids of `uploads` rows: file_original_name, file_name,
  external_link, extension, type, file_size). The builder treats them as numbers ("AI writes it" writes a number).
- `field_classifier.py` (`/v1/rag/classify-fields`) is a regex classifier that nothing calls.
- Table profiles indexed into RAG overwrite each other (`docId = 100000 + conn*100 + index % 100`) and say "Primary key:
  None" (wrong field names).
- Builder defaults 08:30/09:00 and templates force fixed times.

## Design
- AI service `routers/schema.py`:
  - `POST /v1/schema/interpret-table`: column roles, meanings, value names for coded columns, references (e.g. a
    media table) and media-file roles, by the customer's planner model with constrained JSON; context = embedding
    similarity of each column to the role catalogue (semantic hints), RAG passages from the customer's FAISS index
    (knowledge documents + table profiles), observed values (bounded). Validated in Python and again in Laravel.
    Falls back to embedding hints only (marked) when no model answers.
  - `POST /v1/schema/choose-parent`: embeddings rank existing parents against the generated content; the model decides
    reuse vs new (and names the new one); guard against near-duplicates by embedding similarity.
- Laravel: `schema_table_insights` (per connection + table, schema hash, status), `AnalyzeTableInsightsJob` (queued,
  unique, background), `TableInsightService` (ensure on use, apply). AI value names fill `value_labels` where the owner
  has not named them (owner wins, source shown); AI references feed `RelationInference` after declared/owner/name rules;
  AI roles refine column kinds in the field plan (validated against types).
- Media references: image kind + link to the media table; `MediaRowBuilder` maps a generated or uploaded image to the
  media table's columns from its AI roles; the executor creates that row first (always new) and stores its id.
- Parent decision step in `ContentPipeline` after the text: `choose-parent`; main call proposes an unbiased name.
- Builder UI: linked records first, content, required by the table, other (optional, collapsed), left-empty last;
  AI status banner with live refresh; schedule defaults now / now + 15 (start today); templates keep them.
- Manual publishing: media-reference columns can pick an existing upload or upload a new image (row added first);
  schedule-for-later default now + 15; scheduled publish keeps relation details.
- Cleanup: remove the unused classifier (endpoint, client method, tests), fix table-profile ids and fields.

## Tests
Extend existing suites (no new permanent test files); temporary checks and demo data are removed afterwards.
