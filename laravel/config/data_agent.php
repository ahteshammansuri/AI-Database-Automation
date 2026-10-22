<?php

// Limits for the natural-language data agent (ADR-010). These are runtime limits, not per-user
// secrets; per-connection owner settings live in db_connections.access_mode / data_policy.
return [
    'statement_timeout_ms' => (int) env('DATA_AGENT_STATEMENT_TIMEOUT_MS', 8000),
    'write_statement_timeout_ms' => (int) env('DATA_AGENT_WRITE_TIMEOUT_MS', 15000),
    'schema_cache_seconds' => 60,
    'default_limit' => 50,
    'max_limit' => 500,
    'stored_result_rows' => 200,          // masked rows kept for re-display / paging (encrypted, TTL)
    'result_ttl_hours' => 24,
    'llm_sample_rows' => 5,               // rows a model may see, and only when privacy mode allows
    'explain_max_rows' => (int) env('DATA_AGENT_EXPLAIN_MAX_ROWS', 2000000),
    'explain_max_cost' => (float) env('DATA_AGENT_EXPLAIN_MAX_COST', 5000000),
    'max_result_rows' => 200,             // rows a data question may return
    'max_write_rows' => 100,
    'max_delete_rows' => 50,
    'change_request_ttl_minutes' => 15,
    'before_image_ttl_days' => 7,
    'deletes_per_hour' => 10,
    'plan_attempts' => 3,                 // plan + up to 2 repairs fed with backend validation errors
    'split_intent_stage' => (bool) env('DATA_AGENT_SPLIT_INTENT', false),
    'llm_answer_phrasing' => (bool) env('DATA_AGENT_LLM_PHRASING', false),
    'linker_max_tables' => 6,
    'value_hint_max_distinct' => 15,
    'plan_timeout_seconds' => (int) env('DATA_AGENT_PLAN_TIMEOUT', 280),
];
