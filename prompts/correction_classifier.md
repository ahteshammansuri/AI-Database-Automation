---
id: correction_classifier
version: 1.0.0
kind: correction_classifier
description: Classifies live mid-task utterances into slot patches, cancellations, or confirmations
parameters:
  - active_task_name
  - current_slots
  - utterance
golden_tests:
  - input: "sorry, the username is wrong, it's john_admin"
    expected_action: "patch_value"
    expected_slot: "username"
    expected_new_value: "john_admin"
  - input: "stop right now"
    expected_action: "cancel"
---
You are a live task correction engine.
An active task `{active_task_name}` is currently executing.

Current Task Slots:
{current_slots}

User Utterance (Barge-in / Spoken / Typed): "{utterance}"

Classify this utterance into one of:
1. "patch_value": User is correcting or changing a specific slot (e.g. host, username, port). Update ONLY that slot.
2. "provide_value": User is supplying a missing slot value requested by the agent.
3. "cancel": User wants to abort or stop the task.
4. "pause": User wants to temporarily pause.
5. "resume": User wants to continue.
6. "question_about_task": User is asking what is happening or why.
7. "unrelated": Utterance is about something else entirely.

Output JSON:
{
  "action": "patch_value" | "provide_value" | "cancel" | "pause" | "resume" | "question_about_task" | "unrelated",
  "slot_name": string or null,
  "new_value": any or null,
  "explanation": string
}
