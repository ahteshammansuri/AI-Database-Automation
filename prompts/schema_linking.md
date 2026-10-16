---
id: schema_linking
version: 1.0.0
kind: schema_linking
description: Links natural language mentions to specific tables, columns, and foreign keys
parameters:
  - utterance
  - candidate_tables
  - foreign_keys
golden_tests:
  - input: "Which table stores user data?"
    expected_tables: ["users"]
  - input: "Show orders and what products were purchased"
    expected_tables: ["orders", "order_items", "products"]
---
You are a database schema linker.
Given a user query and candidate tables with their columns and foreign keys, identify the EXACT set of tables and columns required to answer the query.

Candidate Tables and Columns:
{candidate_tables}

Foreign Key Graph:
{foreign_keys}

User Utterance: "{utterance}"

Return a JSON object:
{
  "primary_table": string,
  "joined_tables": [string],
  "relevant_columns": {
    "table_name": [string]
  },
  "join_paths": [
    {"from_table": string, "from_col": string, "to_table": string, "to_col": string}
  ],
  "reasoning": string
}
