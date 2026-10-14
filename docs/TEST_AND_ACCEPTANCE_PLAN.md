# Test & Acceptance Verification Plan

**Testing Strategy:** Unit, Feature, Integration, and Synthetic Target Database Verification  

---

## 1. Test Suite Coverage

### A. Laravel Control Plane (`laravel/tests`)
33 Feature Tests covering:
- `AuthTest.php`: User registration, duplicate email rejection, session authentication, unauthenticated route rejection.
- `TenantIsolationTest.php`: Cross-user connection IDOR rejection, cross-user automation attachment blocking.
- `DbConnectionProfileTest.php`: SSL mode parsing (`prefer`, `require`, `disable`), connection creation, validation error handling.
- `DatabaseSafetyTest.php`: SSRF IP blocking, sensitive table classification, forbidden SQL verb interception (`DELETE`, `DROP`).
- `SafeExecutorTest.php`: Parameterized `INSERT` and `UPDATE` into target MySQL, sensitive table write blocking.
- `IntelligentRelationalAndSchemaTest.php`: Four-tier table classification, workspace table annotations, deterministic category resolution/creation, proposal plan generation.
- `AutomationLeadTimeAndFieldAssistTest.php`: 30-minute lead time validation, future manual publish holding, inline AI field assist endpoint, knowledge semantic query endpoint.
- `FairQueueAndConcurrencyTest.php`: Multi-tenant fair round-robin dispatch, stale lease recovery, retry limit enforcement.
- `ApprovalFlowTest.php`: Single-use signed approval token lifecycle, review endpoint, approve/reject state transitions.
- `ManualPublishAndSchedulerTest.php`: Manual publishing without AI, future scheduled publishing lifecycle.

### B. AI Microservice (`ai_service/tests`)
7 Pytest Tests covering:
- `test_ai_service.py`: Health check, provider listing, mock generation, prompt assembly, structured output validation.
- `test_rag.py`: Text extraction, document chunking, FAISS vector indexing, semantic passage retrieval with similarity scores.

### C. End-to-End Vertical Slice (`scripts/verify_end_to_end.py`)
Deterministic end-to-end integration test against live synthetic MySQL (`demo_blog_cms`):
1. Fresh user registration.
2. Empty onboarding state validation.
3. Live connection test and encrypted profile creation.
4. Schema introspection and guardrail validation (`posts` eligible, `users` restricted).
5. Automation creation with field mappings.
6. Execution trigger and queue worker processing.
7. Draft generation and single-use signed token retrieval.
8. Email approval link simulation and approval.
9. Publication job processing and direct physical MySQL table query.
10. Cross-user IDOR penetration test.
