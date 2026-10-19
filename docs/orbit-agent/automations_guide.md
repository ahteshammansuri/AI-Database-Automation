# Automations — how they work

Product knowledge for Orbit's retrieval. Describes the Automation Builder, field mapping, linked records, images, schedules, approval, runs and Manual Publishing. Live tool results and the screen always win over this text.

## What an automation is

An automation writes new rows into one table of one connected database on a schedule. It works for any table with suitable columns: blog posts, articles, news, product descriptions, FAQs, pages and so on. It never edits or deletes existing rows (a published row can be edited separately, one row at a time, with confirmation).

Each automation has: a name, a connection, a target table, a mode (AI generated, or manual with AI off), a plan for every column, a content brief and AI options, a schedule, and approval settings.

## Builder step 1: Setup

Name, connection, target table and mode. Restricted tables (credentials, payments, audit and similar) are not offered. Optionally describe the automation in one sentence and press "propose plan": the AI suggests a name, table and settings, which the user reviews in the next steps. Templates exist for a daily blog, a weekly deep dive, news updates, product descriptions and FAQ entries.

## Builder step 2: Fields (field mapping)

The builder reads the live table and pre-selects a safe choice for every column, with a plain-English explanation. Choices per column:

- **AI** — the AI writes the value (title, summary, body, SEO title, SEO description, keywords, enum choice, number or text). Lengths respect the column's maximum.
- **AI picks a linked record (creates it if new)** — for a foreign key (for example `category_id`): the AI picks the best existing parent row; if none fits, it first creates a new parent row and stores its new id. Both happen in one transaction.
- **AI picks one of the existing linked records** — never creates new parent rows.
- **Always use one linked record** — every row uses the same chosen parent id.
- **Fixed value** — the same value for every row (text, number, yes/no, enum value, date and time, or image URL).
- **Build it from the title (slug)** — made unique automatically: `my-title`, `my-title-2`, …
- **Publication time** — set to the exact moment the row is published.
- **Leave empty** (nullable columns) or **Database default** (columns with a default).

Protected columns (passwords, tokens, secrets) are never written. Required columns (NOT NULL without a default) must get a value; the builder shows a problem until they do. Extra AI instructions can be added per AI-filled column, for example "prefer the Tutorials category".

## Linked records (foreign keys)

A foreign-key id is never guessed. The server resolves the real parent row by its label (for example the category name). When creating a parent is allowed and nothing matches, the parent row is inserted first (its other required columns filled safely), then the child row uses the new id, all in one transaction. If the parent table is protected or cannot be created safely, only existing parents can be used, and the builder explains why. The preview shows exactly which parent rows would be reused or created.

## Builder step 3: AI and content

- Provider and model (local Ollama by default; OpenAI, Gemini or Anthropic with the user's key).
- Topic and content brief, and editorial tone.
- Body length: short (about 350 words), medium (about 750) or long (about 1,300).
- Body format: Markdown or HTML (choose HTML if the website shows the column as-is).
- Images (when the table has an image column filled by AI): "best available", OpenAI, Gemini or a locally designed cover; optional style.
- Knowledge documents to ground the content (optional).

## Images

An image column filled by AI gets an image made from the generated title and summary. The size follows the column name: social or SEO image columns (og_, social, share, meta_image, seo_image, twitter) get a 1200×630 card, thumbnail-like columns (thumb, avatar, icon, square, logo) get 800×800, and others get a 1600×900 banner.

Provider: "best available" uses the user's OpenAI key if saved, else Gemini, else the free local designed cover. If a paid provider fails, the local cover is used and the fallback is recorded in the run log. The image is stored by the platform and its public URL (or storage path for `*_path` columns) is saved in the column.

## Builder step 4: Schedule

- **One time** — runs once on its date, then the automation shows as completed ("already done").
- **Daily** — every day from the start date until the end date (inclusive), or with no end date.
- **Weekly** — on the chosen weekdays between the start and end dates.
- **Times** — a generation time (when the content is created in the background) and a publication time (when it is written to the database). Publication must be at least 15 minutes after generation, to leave time for review.
- **Timezone** — every time is in the chosen timezone (IANA name, for example Asia/Kolkata).
- **Calendar** — the date pickers show the user's other automations' runs.
- **Approval** — require approval or not; the reviewer email (defaults to the account email); and what happens if nobody decides by the publication time: keep it as a draft (nothing is published and the run stops; the draft stays in the run history), publish it anyway, or cancel the run.

A schedule never back-fills runs from before the automation was created. If the server was down past a run's publication time, that run is recorded as missed.

## Builder step 5: Preview and save

The preview is a real dry run: real AI content (and images), rendered like the website would show it, the exact row that would be written, the parent rows that would be reused or created, and the next scheduled runs. Nothing is written to the database. Saving creates and enables the automation.

## Approval and the review email

When approval is required, the generated draft goes to the reviewer by email: a full rendered preview, exactly what will be stored in which columns, linked records that will be created, and when it will publish (with timezone). The email has approve and reject buttons, and the draft also appears on the Approvals page.

- **Approve** (email button, Orbit's approve tool, or "Approve for Schedule" on the Approvals page): it publishes at the publication time; if that time has already passed, it publishes right away.
- **Approve & publish now** (Approvals page): it publishes immediately.
- On the Approvals page the reviewer can also edit the draft's fields before approving.
- **Reject** with feedback: a new version is generated using the feedback and sent for review again. After three rejections the run stops.
- Email links use a random single-use token for one draft version that expires after 24 hours. Opening the link shows the preview only; deciding needs a button press.

## Runs (executions)

Each scheduled or manual run has a status: queued, pending generation, generating, pending approval, approved, regenerating, publishing, published, failed, skipped, cancelled, rejected or missed. The Executions page shows for each run what was generated (all versions), when it publishes, the exact row written and its id, linked records created, images, and a timeline of every step. Failed runs show the reason and can be retried; queued or running runs can be cancelled, paused or resumed; approved runs can be published now.

"Run now" creates a run immediately; its publication time is at least 15 minutes later so there is time to review.

Background work runs on persistent queues and the scheduler checks every minute, so it continues when the browser is closed and after restarts.

## Manual Publishing (AI off)

On the Manual Publishing page the user picks a connection and table, fills each column (foreign keys are dropdowns of real rows), and either publishes now or schedules it for a date and time. An optional AI draft helper can fill the form from a topic, which the user then edits. The same safety checks as automations apply.
