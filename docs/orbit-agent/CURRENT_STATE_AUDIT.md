# Orbit Agent — Current State Audit (pre-upgrade)

Date: 2026-10-15. Scope: the voice → model → tool → UI → speech path for Orbit.
Method: code reading of the AI service, Laravel agent services, and frontend runtime, plus baseline test runs.
An earlier tracker (`docs/tasks/2026-10-15_orbit_agent_autonomous_upgrade.md`) marked this work "DONE"; the evidence below shows the core loop was still static.

## Baseline test results (before any change)

| Suite | Command | Result |
|---|---|---|
| Laravel | `cd laravel && php artisan test` | 89 passed (877 assertions) |
| AI service | `.venv/bin/python -m pytest ai_service/tests -q` | 18 passed |
| Root Python | `.venv/bin/python -m pytest tests -q -p no:cacheprovider` | 67 passed |
| Frontend | `cd frontend && npm run build` | Clean build (chunk-size warning only) |

Running `pytest ai_service/tests tests` in one invocation fails at collection because both folders contain `test_agent_service.py` / `test_rag.py`. Run them separately.

Runtime environment observed: Ollama at `127.0.0.1:11434` with `llama3.2:1b` and `llama3:latest` only. No embedding model (`nomic-embed-text`) installed.

## Confirmed root causes (with evidence)

| # | Finding | Evidence |
|---|---|---|
| 1 | The LLM never selects tools. `OllamaProvider.plan_agent_turn` is a regex/keyword router; Ollama is only called to phrase chit-chat. It invents defaults (`host=127.0.0.1`, `username=root`, name `"MySQL Target"`) and emits fixed 3-step connection plans. | `ai_service/app/providers/ollama_provider.py:271-591` |
| 2 | No observe→act loop. A single plan is produced, then executed blindly; tool results never return to the model. | `ai_service/app/services/agent_planner.py:29-93`; `laravel/app/Services/Agent/AgentExecutionService.php:253-486` |
| 3 | Silent keyword fallbacks pose as AI. Any planner exception falls back to `MockAIProvider` (keyword router), and Laravel falls back to `fallbackOpenEndedPlanner` (regex). Neither is flagged as a service failure. Mid-task corrections route on substrings ("category", "change "). | `agent_planner.py:92-93,124-172`; `AgentExecutionService.php:748-983,985-995` |
| 4 | Frontend keyword routing. `mapIntentToNavigation` opens the *create-connection* form for any utterance containing "connect"/"database"; this explains the screenshot ("check connection status" → "what is the display name?"). Stop/pause voice commands are string-matched. | `frontend/src/context/AssistantContext.tsx:274-354,410,455-463` |
| 5 | Page/form state ignored. The page snapshot is stored in `slots.page_context`, but no planner branch reads form values, so already-filled host/port are not treated as supplied. | `AgentExecutionService.php:124-126,717-720`; `ollama_provider.py` (no use of form fields) |
| 6 | RAG reaches the model only for a hard-coded list of "project question" phrases; all other branches discard retrieved chunks. Embeddings use the hash-projection fallback because no Ollama embedding model is installed, and the product index never re-indexes when its source changes. | `ollama_provider.py:321-359`; `ai_service/app/rag/embeddings.py:94-111,153`; `ai_service/app/rag/service.py:137-138` |
| 7 | Plaintext secrets persisted and returned. Secure input is merged into `active_plan` step args (stored as JSON on `agent_tasks` and returned to the browser in `task` payloads). Ollama-planned steps also carry a `password` arg. | `AgentExecutionService.php:650-672`; `ollama_provider.py:438,452` |
| 8 | UI bridge fakes success and double-executes. `dispatchAsync` returns `ok` when no handler is mounted. `connections.trigger_test`/`submit_save` handlers call the real API while the backend tool also tests/saves → possible duplicate profiles. | `frontend/src/services/actionBridge.ts:80-87`; `frontend/src/pages/ConnectionsPage.tsx:292-312`; `AgentExecutionService.php:319-329` |
| 9 | Synchronous turn. All steps run inside the HTTP request; a closed tab or slow model loses the turn. Response synthesis has a 3 s timeout and then returns canned "successfully completed" text. | `AgentController.php:85-111`; `ollama_provider.py:669-683` |
| 10 | Character is PNG swapping: one full-body `<img>` per state. No independent eyes, mouth, arms or fingers; no eye tracking or lip sync possible. | `frontend/src/components/agent/OrbitMascotCharacter.tsx:480`; `frontend/public/mascot/*.png` |

## Additional root causes found during the upgrade (confirmed)

| # | Finding | Evidence |
|---|---|---|
| 11 | No live agent event ever reached the assistant: the API returns `event_type`, every frontend listener reads `event_name`. The old visible "action bridge" only worked through the HTTP-response shortcut. | `laravel/app/Services/LiveEventService.php:53`; `frontend/src/context/LiveEventsContext.tsx` listeners |
| 12 | Live-event polling was served from a 25 s in-memory GET cache, so with no new events the same `since_id` URL returned a cached empty list for 25 s. | `frontend/src/services/api.ts` (`CACHE_TTL_MS`) |
| 13 | On page load the poller started at event id 0 and replayed the oldest 50 events, which could re-run old UI actions. | `LiveEventsContext.pollEvents` with `lastEventIdRef = 0` |
| 14 | `SecureCredentialCard` pre-filled a real demo password, host and username (a seeded customer credential in the frontend), and the card was not rendered anywhere, so there was no working secure-capture UI. | `frontend/src/components/agent/SecureCredentialCard.tsx` (old defaults) |
| 15 | The connection form's untouched defaults (`127.0.0.1`, `3306`) were reported to the agent as entered values. | `ConnectionsPage` form defaults + `pageStateService.updateFormField` |
| 16 | `ConnectionsPage` opened the create modal whenever the keyword router set `activeAnchor = connection-form-anchor`. | old `ConnectionsPage.tsx:110-116` |
| 17 | The speech recognizer was recreated on every parent re-render (inline callbacks in deps), which could abort a listening session. | old `useVoiceLifecycle.ts:200` |
| 18 | Agent `approve_content_version` / `reject_content_version` wrote a non-fillable `is_approved` attribute (a silent no-op) and looked versions up without an owner scope. The verifier checked the same non-existent field. | old `AgentToolRegistry::approveContentVersion` / `rejectContentVersion`, `AgentExecutionService::verifyStepAuthoritatively` |
| 19 | The voice-reply preference was read from a non-existent key (`voice_responses_enabled`), so Orbit never spoke by default. | old `AssistantContext.loadConversation` |
| 20 | The HUD "behaviour studio" put the live mascot into any state (including success) with no real event behind it. | old `AgentOperationalHUD` `onSelectBehavior` |

## Hypotheses (not yet proven)
- `llama3.2:1b` is likely too small for reliable structured tool selection; the upgrade targets `qwen2.5:3b` (user-approved) and will verify live.
- Browser `webkitSpeechRecognition` in Chrome sends audio to a remote service; the UI does not disclose this today.

## Reusable, working assets
- `AgentToolRegistry` — ~35 real, tenant-scoped tool handlers (connections, schema, automations, executions, approvals, providers, knowledge base).
- `LiveEventService` — persisted events with sequence IDs and replay (`getEventsSince`), streamed over SSE.
- Database queue + scheduler; `DatabaseSafetyService` (SSRF); `SafeDatabaseExecutor`.
- FAISS per-user indexes in `RAGService`; `pageStateService`; `secretRedactor`; `ttsAdapter`; `SecureCredentialCard`; `usePressAndHold`; `useMascotTravel`; framer-motion.

## Resolution
See `/docs/orbit-agent/ARCHITECTURE.md` (written during the upgrade) and the tracker in `docs/tasks/2026-10-15_orbit_agent_autonomous_upgrade.md`.
