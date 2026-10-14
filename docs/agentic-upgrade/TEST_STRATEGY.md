# TEST_STRATEGY.md
## Test Strategy & Verification Matrix

**Objective:** Thorough, verifiable automated and integration test suite covering unit reasoning, RAG inclusion, tool execution, security guardrails, and end-to-end voice operator scenarios.

---

### 1. Test Levels & Tooling

1. **Python Unit & Provider Tests (`pytest tests/`):**
   - Test LLM prompt construction with actual user utterance.
   - Test RAG chunk retrieval and injection into model prompts.
   - Test structured Pydantic decision validation and error recovery.
   - Ollama live model smoke test (using local `llama3.2:1b` / `llama3:latest`).
2. **Laravel Feature Tests (`php artisan test`):**
   - Test `AgentExecutionService` multi-turn slot preservation.
   - Test `AgentToolRegistry` tool execution and prohibition of destructive SQL.
   - Test cross-tenant isolation and IDOR defense on agent tasks.
   - Test secure credential capture (sentinel verification, zero cleartext passwords in logs).
3. **Frontend Integration Tests (`frontend/`):**
   - Test `FrontendActionBridge` action dispatch and acknowledgement.
   - Test form population and test connection invocation on `ConnectionsPage`.
   - Test mascot state transitions and barge-in speech interruption.
4. **End-to-End Acceptance Scenarios:**
   - **Scenario A:** Database Connection Creation (Open-ended phrasing, slot preservation, form fill, test, save, reload verification).
   - **Scenario B:** Arbitrary Supported Task (Schema exploration / automation review).
   - **Scenario C:** Unsupported Task (e.g., flight booking, crypto trading).
   - **Scenario D:** Interruption & Correction (Instant stop, parameter change mid-flight).

---

### 2. Traceability & Acceptance Criteria

Every test must be executable via a CLI command. Tests will clearly distinguish between deterministic mock tests and live Ollama tests. No feature will be marked `VERIFIED` without passing CLI test output.
