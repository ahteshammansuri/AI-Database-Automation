# Linked records everywhere: detected relations, pickers by name, new parents, value choices (2026-10-29)

Request: wherever a column points at another table (blogs.category_id -> blog_categories, products.user_id ->
users, orders.user_id -> users), never ask for a raw id. Show the relation clearly in the Schema Explorer (which
table, which column, how, how many rows), and in every form (Data add/edit, manual publishing, automation fields)
offer a searchable list of the parent rows by name with their id. Typing a new name creates the parent when the row
is saved; a parent that needs more required fields gets a small form. Status-like number columns get a list of
choices instead of a number box. Must work for any table and any new database, not only the demo tables.

Rules that still apply (AGENTS.md, ADR-010): INSERT/UPDATE only after preview + confirmation, pinned keys; never
DDL; blocked tables never read; read-only tables never written; secret columns never returned or written; PII
masked and never used as a row label; ownership enforced in the backend; AI output untrusted.

## What exists (kept and built on)
- Declared foreign keys are read from the catalog (`LiveSchemaService`, `SchemaIntrospectionService`,
  `TargetTableInspector`) and drive: Data link picker + labels, link checks before writes, delete impact,
  AI sample rows, AI query joins, automation field plan (AI picks/creates parents), manual publish parent creation.
- Manual publishing guesses `category_id -> categories` in the browser only; the server never learns the link.

## Findings on a real connected database (choviet102, 141 tables)
- Only 8 declared foreign keys. `blogs.category_id`, `products.user_id`, `products.category_id`, `cities.state_id`
  ... are plain integers, so every screen shows a number box.
- `blog_categories` names its rows by `category_name`; the label detector only knows `name`/`title`, so even a
  declared link would show "Row 3".
- `product_categories` is a pivot without a primary key: a naive "prefix" rule would link `products.category_id` to it.
- `categories.parent_id` defaults to 0 ("no parent"): a strict link check would refuse every top-level category.
- Manual publishing "Add a new category" on an undeclared link sends a name into an integer column (server does not
  know the link) and fails.
- Three separate pickers (Data, Manual, Builder) with three endpoints and three label rules.

## Requirements
| # | Requirement |
| --- | --- |
| R1 | Detect links that the database does not declare, from names and types, for any schema (prefix-scoped names, plurals, self links, qualifiers like `refund_note_id`, role names like `author_id`); never link to pivots, views, type-mismatched keys or polymorphic pairs. |
| R2 | One source of truth on the server; every consumer (Data, link checks, delete impact, sample rows, AI joins, field plan, executor, Schema Explorer) uses the same links. |
| R3 | The owner can confirm, change or remove a detected link, or add one, per connection; can check a link against the data. |
| R4 | Schema Explorer: relationship map (belongs to / used by), declared vs detected vs set by you, why, row counts, cardinality in plain words. |
| R5 | Rows are named by the best readable column (name, title, category_name, *_name, ...), never secrets or personal data. |
| R6 | One picker everywhere: search by name, show id, optional "none", create new by name (saved with the row), or "add with details" form for parents with more required fields. |
| R7 | Parent rows created in the same transaction as the child row; validated with the same rules; protected/read-only parents never created; undo removes both when nothing else uses the parent. |
| R8 | Status-like columns: choices from the values in use (with counts), names the owner gives them, enum/boolean as before; free value still allowed when valid. |
| R9 | Labels shown for links and named values in tables, row details, previews and plans. |
| R10 | Tests (inference unit, feature on a fixture DB without declared FKs, IDOR), docs, typecheck/lint/build, browser check. |

## Slices
1. `RelationInference` (pure) + unit tests.
2. Owner settings table/model; `SchemaRelations` service; catalog carries effective links, label column, value labels.
3. Data API: rows/labels/link options/form/validate/values; previews with labels; `$new` parents (insert + update), undo.
4. Executor + field plan through `describeFor` (detected links), parent values from a form, 0 = none on detected links.
5. Schema API: effective links on the snapshot, link editor, link check, value names.
6. Frontend: one `LinkPicker`, `NewRecordModal`, `ValuePicker`; Data, Manual, Builder; Schema Explorer map + editors.
7. Tests, docs, build, browser run.
