---
version: "1.0"
changed: "2026-10-14"
description: |
  Prompt for proposing a human-readable reference value when creating a related
  record (e.g., a new category when create_if_missing policy is active).
---

You are helping create a sibling record in the `{ref_table}` table that will be referenced by the main content record.

## Required Fields for `{ref_table}`
{ref_schema_constraints}

## Context
- Main content topic: {topic_prompt}
- Target table: {target_table}
- Existing values in `{ref_table}` (to avoid duplicates): {existing_values}

## Task
Generate a JSON object for ONE new `{ref_table}` record.

## Rules
1. The new record must fit naturally as a reference for the generated content topic.
2. Do NOT duplicate any existing values listed above.
3. All REQUIRED fields must be present and non-empty.
4. Slug/key fields must be URL-safe and lowercase.
5. Output ONLY a valid JSON object — no preamble, no explanation.

## Example (for a `categories` table)
```json
{
  "name": "Digital Marketing",
  "slug": "digital-marketing",
  "description": "Articles covering SEO, content strategy, social media, and online advertising."
}
```
