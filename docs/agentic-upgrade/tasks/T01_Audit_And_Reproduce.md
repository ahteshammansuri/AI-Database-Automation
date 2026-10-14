# Task T01: Audit And Reproduce Baseline

- **Objective:** Inspect existing request flow, document hardcoded routing sites, verify baseline test suites, and establish reproduction tests.
- **Existing Code Paths:**
  - `frontend/src/context/AssistantContext.tsx`
  - `laravel/app/Services/Agent/AgentExecutionService.php`
  - `ai_service/app/services/agent_planner.py`
- **Prerequisites:** Workspace running; access to Laravel and Python services.
- **Concrete Changes:**
  - Identified confirmed defect in `agent_planner.py:25-320` where regexes replace model invocation.
  - Documented slot erasure in `agent_planner.py:218-232`.
  - Documented missing frontend component bridge in `AssistantContext.tsx:264-336`.
- **Files Affected:**
  - `docs/agentic-upgrade/CURRENT_STATE_AUDIT.md`
  - `docs/agentic-upgrade/tasks/T01_Audit_And_Reproduce.md`
- **Unit & Integration Tests Run:**
  - `PYTHONPATH=. ./.venv/bin/pytest tests/` (28 passed)
  - `php artisan test` (45 passed)
  - `npm run build` (success in 3.54s)
- **Manual Demo Steps:**
  1. Spoken input with custom connection details tested against existing planner.
  2. Confirmed that planner output returns fixed `MySQL Target` dummy values and ignores user utterance.
- **Acceptance Criteria:**
  - [x] Baseline audit completed and documented with code line references.
  - [x] Test baseline established across all three layers.
  - [x] Root causes confirmed without guessing.
- **Current Status:** `VERIFIED`
- **Actual Results:** Confirmed root causes in planner, slot extraction, and frontend bridge.
- **Remaining Risks:** None for audit phase.
