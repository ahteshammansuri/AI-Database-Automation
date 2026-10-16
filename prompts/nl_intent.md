---
id: nl_intent
version: 1.0.0
kind: intent_classifier
description: Classifies natural language utterance into database operations or portal actions
parameters:
  - utterance
  - active_connection
  - active_table
  - tables_list
golden_tests:
  - input: "How many tables are in my database?"
    expected_intent: "describe_schema"
  - input: "How many orders do I have today?"
    expected_intent: "count"
  - input: "Find users from Rajasthan"
    expected_intent: "list"
  - input: "Change this user's name from John to Jack"
    expected_intent: "update"
  - input: "Delete this user"
    expected_intent: "delete"
  - input: "Is there any dummy or test data?"
    expected_intent: "find_dummy_data"
---
You are an expert natural language database router.
Analyze the user utterance and classify its core database intent.

Active Connection: {active_connection}
Active Table: {active_table}
Available Tables: {tables_list}

User Utterance: "{utterance}"

Return a JSON object conforming strictly to this schema:
{
  "intent": "count" | "list" | "aggregate" | "describe_schema" | "find_dummy_data" | "update" | "insert" | "delete" | "explain" | "unrelated",
  "target_table": string or null,
  "confidence": float between 0.0 and 1.0,
  "explanation": "Brief reasoning for the classification"
}
