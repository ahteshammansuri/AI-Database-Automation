# Dynamic Capability Registry & Semantic Planner Specification

## 1. Dynamic Capability Registry
The platform's capability boundary is strictly governed by `AgentToolRegistry.php`. Capabilities are exposed dynamically based on tenant ownership, database safety policies, and available system integrations.

Each registered tool adheres to the schema:
- `name`: Unique machine identifier (e.g. `list_database_connections`, `scan_database_schema`, `create_automation_draft`).
- `label`: Human-readable title.
- `description`: Purpose and functional intent.
- `outcome`: Clear explanation of the operation's result.
- `scope`: Access boundary (strictly `tenant_user`).
- `read_only`: Boolean flag distinguishing queries from mutations.
- `risk_level`: `LOW` | `MEDIUM` | `HIGH`.
- `requires_confirmation`: Consequential actions requiring user confirmation under policy.
- `idempotent`: Safe for bounded automatic retries.
- `parameters`: Typed JSON Schema defining inputs.
- `output_schema`: Typed JSON Schema defining outputs.
- `ui_route`: Relevant application route (e.g. `/connections`, `/explorer`, `/automations`).
- `ui_anchor`: Semantic element ID for mascot positioning (e.g. `connection-form-anchor`).

## 2. Capability Catalog Overview

| Capability Group | Tools | Read-Only? | Consequential Confirmation? |
|---|---|---|---|
| **Connections** | `list_database_connections`, `test_database_connection`, `save_database_connection`, `update_database_connection`, `disconnect_database_connection` | `list`, `test` = true; Others = false | `save`, `disconnect` = yes |
| **Schema & Data** | `scan_database_schema`, `get_schema_scan_status`, `lookup_table_values` | true | no |
| **Automations** | `list_automations`, `get_automation_details`, `create_automation_draft`, `update_automation`, `remove_automation`, `run_automation_now`, `preview_automation_content` | `list`, `get`, `preview` = true; Others = false | `create`, `update`, `remove`, `run` = yes |
| **Executions & Approvals** | `list_executions`, `get_execution_status`, `retry_execution`, `request_execution_interrupt`, `explain_execution_failure`, `update_published_record`, `get_pending_approvals`, `approve_content_version`, `reject_content_version` | Status queries = true; Actions = false | `update_published_record`, `approve`, `reject` = yes |
| **AI Providers** | `list_ai_providers`, `test_ai_provider`, `save_ai_provider`, `get_provider_health` | Queries = true; `save` = false | `save` = yes |
| **Knowledge Base** | `list_knowledge_documents`, `query_knowledge_base`, `remove_knowledge_document` | Queries = true; `remove` = false | `remove` = yes |
| **Audit & Overview** | `get_dashboard_summary`, `list_audit_logs` | true | no |

## 3. Semantic Planning Without Keyword Routing
- **Architecture**:
  - Voice transcript is received by the backend.
  - The Python AI microservice (`/v1/ai/agent/plan`) receives the user goal prompt alongside available connections, schemas, automations, and recent executions.
  - The LLM reasons over the intent and selects from registered tools without requiring exact keywords or prefixes.
- **Classification Categories**:
  1. `SUPPORTED_AND_SPECIFIED`: Direct multi-step plan produced.
  2. `MISSING_INFORMATION`: Asks for missing required parameters (e.g. database credentials or schedule times).
  3. `AMBIGUOUS`: Asks a clarifying question (e.g. when multiple database connections exist).
  4. `CURRENTLY_UNAVAILABLE`: Explains why an action cannot be performed right now (e.g. trying to scan schema with 0 connected databases).
  5. `UNSUPPORTED`: Truthfully declines out-of-scope requests (e.g. booking flights or ordering food).
  6. `DISALLOWED_BY_POLICY`: Intercepts forbidden operations (e.g. destructive SQL commands).

## 4. Loop Prevention & Execution Bounds
- Maximum steps per plan: 5 steps.
- Maximum replanning iterations on error: 2 iterations.
- If a step fails, the planner does not spin in an infinite retry loop; it records the failure, explains the blocker by voice and HUD, and halts safely.
