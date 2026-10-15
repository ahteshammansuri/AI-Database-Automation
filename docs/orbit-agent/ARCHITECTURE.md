# Orbit Agent Architecture

Orbit is a voice-first operator for the DataAuto portal. Every meaningful utterance reaches the user's configured model together with live context. The model chooses real registered tools. Laravel executes those tools, verifies the results, and returns them to the model. Orbit speaks only what was observed.

## 1. Request flow

```
Browser (React)                         Laravel (control plane)                       FastAPI AI service
───────────────                         ───────────────────────                       ──────────────────
voice/typing ─► secretRedactor ─► POST /agent/conversations/{id}/messages
                 (secrets → secure_input_data)     │ SecretVault (encrypted, per task)
  + page snapshot (non-secret)                     │ AgentMessage (redacted), AgentTask (open or new)
                                                   └─► 202 + RunAgentTurnJob (queue "agent")
                                                          │
                                       AgentOrchestrator::runTurn (lock per task)
                                         loop ≤ 8 iterations / ≤ 600 s:
                                           RuntimeContextBuilder ─► AiServiceClient::decide ─► POST /v1/ai/agent/decide
                                                                                                retrieve (product + this user's KB)
                                                                                                build messages
                                                                                                Ollama /api/chat (JSON-schema constrained)
                                                                                                validate AgentDecision (≤1 repair)
                                           ◄──────────────────────────────── decision + RAG metadata
                                           CALL_TOOL → ToolPolicyGate → UiActionCoordinator (visible, acked)
                                                     → ToolRunner (vault injects secrets) → postcondition verify
                                                     → AgentToolCall persisted → observation appended
                                           terminal decision → AgentMessage + agent.speech event
  live events ◄── poll /live/events (350 ms while working) ◄── workspace_events (persisted, ordered)
  agent.ui_action → orbitRuntime → actionBridge handler → POST /agent/ui-actions/{id}/ack
  agent.speech → ttsAdapter (single channel) + character state
```

The AI service never connects to customer databases. Laravel is the only executor, and identity always comes from the authenticated session.

## 2. Decision protocol (`orbit.v1`)

Defined in `ai_service/app/schemas/agent.py`.

| Kind | Meaning | Ends the turn? | Task status |
|---|---|---|---|
| `ANSWER` | Answer directly (with RAG when relevant) | yes | `ANSWERED` (`SUCCEEDED` if a verified tool ran this turn) |
| `ASK_CLARIFICATION` | Ask for one missing/ambiguous value | yes | `WAITING_FOR_INPUT` |
| `CREATE_OR_REVISE_PLAN` | Record a plan, then keep acting | no | — |
| `CALL_TOOL` | Run a registered tool with typed args | no | — |
| `WAIT_FOR_USER` | Needs secure input (`database_password` / `api_key`) | yes | `WAITING_FOR_INPUT` |
| `REQUEST_CONFIRMATION` | Ask before a gated tool runs | yes | `WAITING_FOR_APPROVAL` |
| `INTERRUPT_OR_CANCEL` | `STOP` / `PAUSE` / `RESUME` | yes (except `RESUME`) | `CANCELLED` / `PAUSED` |
| `UNSUPPORTED` | Explain an unavailable capability | yes | `ANSWERED` |
| `RECOVER` | Explain a real failure and ask for a correction | yes | `WAITING_FOR_INPUT` |
| `PARTIAL_RESULT` | Some steps done, some not | yes | `PARTIAL_SUCCESS` |
| `COMPLETE` | Goal verified done | yes | `SUCCEEDED` only if a verified tool ran, else `ANSWERED` |

Validation rules:
- Extra fields are forbidden.
- Tool names are constrained by a JSON-schema enum of the available tools, and checked again after parsing.
- Args or slots whose names look secret are rejected.
- `emotion_hint` and `response_style` are allowlisted enums.
- Malformed output gets at most one repair round; after that the error is `MODEL_OUTPUT_INVALID`.
- There is no keyword or regex fallback anywhere.

## 3. Runtime context sent to the model

Built by `RuntimeContextBuilder`, from server data plus the sanitized page snapshot:

- **Page:** route, open modal, and forms. Fields are marked `supplied` only when the user or Orbit entered them; untouched defaults are flagged `default`. Secret fields become `{present, secret}`.
- **Workspace:** connections (no passwords) with status, automations, and the pending-approval count.
- **Model:** the provider and model in use.
- **Credentials captured:** booleans per secret kind.
- **Current task:** status, plan version, awaiting-confirmation call, and the last question Orbit asked.
- **Focused schema:** table names and categories for the connection in focus.
- **Conversation:** the last 8 messages, truncated.
- **Slots:** non-secret values learned earlier in the task.
- **Observations:** the real results of tools called in this turn.

## 4. Tool registry and policy

`AgentToolRegistry` holds the definitions and handlers; `TOOL_META` adds the agent-loop metadata:

- `side_effect_class`: `read` / `platform_metadata` / `write` / `external`;
- `secret_params`: arguments filled from the vault and hidden from the model;
- `always_confirm`;
- `requires_confirmation`;
- `postcondition`.

`modelVisibleSchemas()` generates the model's tool list from the same definitions that `ToolArgumentValidator` enforces.

`ToolPolicyGate` runs immediately before each side effect. It checks, in order:
1. the tool is registered;
2. it is available;
3. the arguments validate (types, enums, no extra properties);
4. every `*_id` is owned by the user (a foreign ID gets the same `NOT_FOUND` as a missing one);
5. confirmation policy, by autonomy level.

`ToolRunner` returns a normalized `ToolResult`: `success`, `status`, `error_category`, `safe_message`, `retryable`, `side_effect_committed`, `verified`, `resource_refs`, `data`. Postconditions re-read platform state:

| Tool | Postcondition |
|---|---|
| save connection | connection persisted |
| create automation | automation persisted |
| scan schema | schema snapshot exists |
| approve | version `APPROVED` |

Loop guards:
- A repeated identical failed call is not executed; the third repeat ends the turn.
- A repeated successful call is not re-run.
- A second `SECRET_REQUIRED` ends the turn with a secure-input request.
- Iteration and time limits end the turn with an honest partial result.

## 5. Secrets

`SecretVault` (`agent_secure_inputs`, encrypted cast, 30-minute TTL, per task and user):

- Secrets arrive from the masked field (`secure_input_data`), or are redacted out of an utterance by the browser and again by the server (`SecretVault::redactUtterance`).
- They are injected into tool arguments only at execution time.
- They are scrubbed from tool output and consumed after a verified save.
- The model only ever sees `credentials_captured`.
- Tests assert that a test password appears in none of: tasks, messages, tool calls, UI actions, timeline, workspace events, or model requests.

## 6. Visible website choreography

`UiActionCoordinator` defines, per tool, the allowlisted UI steps to run before and after it. For a new connection test, for example: navigate to `/connections` → open the create form → set fields → press Test → show the result.

Each step is an `agent.ui_action` event with a correlation ID. The browser (`orbitRuntime`):
1. flies Orbit to the registered semantic target;
2. performs the gesture;
3. runs the page's typed handler, which changes real controlled React state and validates it;
4. acknowledges the real result.

The server waits up to 6 s per step, and only if a heartbeat shows a browser is present. Otherwise it records the step as `headless` and continues. Visible "press" actions never call the API themselves: the server runs the real operation once, and the page shows the server's result.

## 7. Events (persisted in `workspace_events`, replay-safe)

| Event | Meaning |
|---|---|
| `agent.turn_stage` | `QUEUED`, `UNDERSTANDING`, `THINKING` (model request in flight), `CALLING_TOOL`, `DONE` |
| `agent.narration` | The model's short progress phrase for a tool call |
| `agent.ui_action` | A visible UI step to perform and acknowledge |
| `agent.tool_started` / `agent.tool_finished` | A real tool call with its trace ID and verified result |
| `agent.timeline_event` | The human-readable record of what actually happened |
| `agent.task_updated` | Status, stage, plan version |
| `agent.speech` | Final spoken text, with source (`model` or `system`), emotion and style |

A fresh page starts polling from "now" (`/live/events?baseline=1`) and reconciles from persisted task state, so old UI actions are never replayed.

## 8. Interruption and corrections

| Input | What happens |
|---|---|
| Stop button | Running task → `INTERRUPT_REQUESTED`: no new step starts; the loop finishes at the next checkpoint and reports committed work. A waiting task is cancelled immediately. |
| Pause / Resume buttons | `PAUSE_REQUESTED` → `PAUSED`; Resume re-queues the turn. |
| New utterance while running | `pending_user_turn` is set and `plan_version` incremented. The loop folds it in at the next iteration as a correction. Committed results stay and are described as committed. |
| Spoken "stop", "pause", or "yes, go ahead" | Interpreted by the model. A spoken yes counts as confirmation only for the exact pending call, and only if spoken after Orbit asked. |

## 9. Model and RAG

- **Model:** the user's "planner" model role, else their active provider, else the platform default (`qwen2.5:3b`). A missing model is reported, never silently swapped.
- **RAG:** product knowledge (`docs/orbit-agent/product_context_rag.md`, versioned by SHA-256 and re-indexed on change) plus the current user's knowledge-base partition. Retrieval is hybrid (vector + lexical) and thresholded. `rag.used` is true only when passages were placed in the model request.
- **Embeddings:** `nomic-embed-text` via Ollama; otherwise `lexical-fallback`, labelled as such.

## 10. Character

See `CHARACTER_TECH_DECISION.md`. `deriveCharacterState()` (in `frontend/src/services/orbitBehavior.ts`) maps real task status, turn stage and playback state to Orbit's state. Success requires a server `SUCCEEDED`.

## 11. Operating the whole site on screen (surfaces)

Orbit operates any page the way a person does, visibly.

- **Catalog:** `laravel/resources/orbit/surfaces.json` is server-owned and served at `GET /api/agent/surfaces`. It lists every operable surface (forms, wizard steps, lists with row actions), with:
  - fields (`secret` and `file` fields are typed or chosen by the user only; `col.*` is a dynamic per-column field);
  - actions (`consequential` actions need confirmation; `verifies` names the resource type the server re-checks).
- **Pages:** each page registers handlers with `useOrbitSurface(id, () => ({...}))`, bound to its own React state and API calls. Registrations not in the catalog are refused, and a consistency test checks pages and catalog against each other.
- **Tools:** the model gets generic UI tools: `go_to_page`, `open_form`, `read_screen`, `fill_fields`, `choose_option`, `press`, `ask_secret_in_form`, `show_me`.
  - `ToolPolicyGate` validates each call against the catalog (never trusting the browser).
  - `ToolRunner::runUi` sends it to the browser through `UiActionCoordinator::request`, with a per-action timeout from the catalog.
  - The browser runtime (`orbitRuntime.ts`) flies Orbit to the real element, types or taps, runs the page's own handler, and acknowledges the real outcome.
  - For a `press` with `verifies`, the server checks the returned resource exists and belongs to the user before reporting success.
  - With no browser present, the UI tools are unavailable (`NO_BROWSER`).
- **Secrets:** `ask_secret_in_form` points at the form's own password or API-key box. The user types there, then presses Enter or the "Continue" chip, which calls `POST /api/agent/tasks/{id}/continue` with the field name only, never the value. Orbit then presses the page's Test/Save, so the value only ever goes from the browser to the existing API.

Coverage: Connections (form plus list rows), Schema Explorer, Automation Builder (5 wizard steps), Automations, Manual Publishing (dynamic columns), Approvals, Executions, Knowledge Base (Orbit opens the file picker; the user picks the file), AI Providers (cards, form, model roles), Dashboard, Audit Logs.

## 12. Reliability on CPU-only machines

- **Streaming with a watchdog:** Ollama is called with `stream: true`. A watchdog closes the stream on a time-to-first-token limit (360 s), an inter-chunk idle limit (60 s), or the request deadline. Closing makes Ollama stop generating, so no orphaned work delays the next request.
- **One deadline end to end:** Laravel sends `deadline_seconds` (its HTTP timeout minus 20 s), so the AI service always answers first. A miss becomes `MODEL_BUSY_OR_SLOW`, and Orbit says honestly that nothing was changed.
- **One request at a time:** the AI service holds a lock so only one agent decision uses the model at a time.
- **Smaller prompts:** the model sees full signatures for core and relevant tools only (embedding-ranked, capped at 18); other tools are listed by name. `num_ctx` is 4096.
- **Timeline:** rows are collapsed by `trace_id`, so nothing spins after a turn ends.

## 13. Conversation memory

- **History:** the model gets up to 14 recent messages (the latest 4 at 500 chars, older ones at 220). Service notices are excluded, and each assistant turn's decision kind is included.
- **Carried facts:** non-secret slots are merged into `agent_conversations.metadata.memory` after every turn. New tasks start from that memory, and it is sent as `conversation_memory`, so facts like the connection name carry over.
