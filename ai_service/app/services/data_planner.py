"""
DataPlanner: Structured Intent + QueryPlan generator (ADR-010, ADR-013).
Synthesizes QueryPlan JSON using the active AI provider constrained by JSON schema.
Includes bounded repair loop (max 3 attempts) and deterministic heuristic planning.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.services.prompt_registry import prompt_registry

logger = logging.getLogger(__name__)

QUERY_PLAN_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {
            "type": "string",
            "enum": ["count", "list", "aggregate", "describe_schema", "find_dummy_data", "update", "insert", "delete", "explain"],
        },
        "connection_ref": {"type": ["string", "null"]},
        "tables": {"type": "array", "items": {"type": "string"}},
        "select": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "column": {"type": "string"},
                    "table": {"type": ["string", "null"]},
                    "alias": {"type": ["string", "null"]},
                    "agg": {"type": "string", "enum": ["count", "sum", "avg", "min", "max", "none"]},
                },
                "required": ["column"],
            },
        },
        "filters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "column": {"type": "string"},
                    "table": {"type": ["string", "null"]},
                    "op": {"type": "string", "enum": ["=", "!=", ">", "<", ">=", "<=", "like", "in", "is_null", "is_not_null"]},
                    "value": {},
                    "value_type": {"type": "string", "enum": ["string", "number", "boolean", "date"]},
                },
                "required": ["column", "op", "value"],
            },
        },
        "joins": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "via_fk": {"type": ["string", "null"]},
                },
                "required": ["from", "to"],
            },
        },
        "group_by": {"type": "array", "items": {"type": "string"}},
        "order_by": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "column": {"type": "string"},
                    "direction": {"type": "string", "enum": ["asc", "desc"]},
                },
                "required": ["column"],
            },
        },
        "time_window": {
            "type": ["object", "null"],
            "properties": {
                "column": {"type": "string"},
                "from": {"type": ["string", "null"]},
                "to": {"type": ["string", "null"]},
                "timezone": {"type": "string"},
                "label": {"type": "string"},
            },
            "required": ["column", "timezone"],
        },
        "limit": {"type": "integer"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "needs_clarification": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["question"],
            },
        },
    },
    "required": ["intent", "tables"],
}


class DataPlanner:
    def plan(
        self,
        utterance: str,
        schema_slice: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
        timezone: str = "Asia/Kolkata",
        backend_errors: Optional[List[str]] = None,
        provider_type: Optional[str] = None,
        model_name: Optional[str] = None,
        max_attempts: int = 3,
    ) -> Dict[str, Any]:
        """
        Generate QueryPlan via LLM with bounded retry repair loop.
        Falls back to rule-based planner if model fails or is offline.
        """
        prompt_text = prompt_registry.render(
            "query_plan",
            utterance=utterance,
            schema_slice=json.dumps(schema_slice, indent=2),
            context=json.dumps(context or {}, indent=2),
            timezone=timezone,
            backend_errors=json.dumps(backend_errors or []),
        )

        messages = [
            {"role": "system", "content": "You are a deterministic database query planner. Return strictly valid JSON conforming to the QueryPlan schema."},
            {"role": "user", "content": prompt_text},
        ]

        # Try LLM provider if available
        try:
            provider = AIProviderFactory.get_provider(provider_type or "ollama", model_name=model_name)
            for attempt in range(max_attempts):
                try:
                    raw_json = provider.chat_structured(
                        messages=messages,
                        json_schema=QUERY_PLAN_JSON_SCHEMA,
                        timeout=30.0,
                        temperature=0.1,
                    )
                    data = json.loads(raw_json)
                    if isinstance(data, dict) and "intent" in data and "tables" in data:
                        return self._clean_plan(data, timezone)
                except Exception as e:
                    logger.warning(f"[DataPlanner] Attempt {attempt + 1} failed: {e}")
                    if attempt < max_attempts - 1:
                        messages.append({"role": "user", "content": f"Previous attempt failed with error: {str(e)}. Please correct and return valid JSON."})
        except Exception as e:
            logger.info(f"[DataPlanner] Provider call failed or unavailable ({e}); using heuristic planner.")

        # Heuristic deterministic planner fallback
        return self._heuristic_plan(utterance, schema_slice, context, timezone)

    def _clean_plan(self, plan: Dict[str, Any], timezone: str) -> Dict[str, Any]:
        if "limit" not in plan or not plan["limit"]:
            plan["limit"] = 50
        plan["limit"] = min(500, max(1, int(plan["limit"])))
        if "select" not in plan or not plan["select"]:
            plan["select"] = [{"column": "*"}]
        if "filters" not in plan:
            plan["filters"] = []
        if "joins" not in plan:
            plan["joins"] = []
        if "assumptions" not in plan:
            plan["assumptions"] = []
        if "needs_clarification" not in plan:
            plan["needs_clarification"] = []
        if plan.get("time_window") and isinstance(plan["time_window"], dict):
            if "timezone" not in plan["time_window"] or not plan["time_window"]["timezone"]:
                plan["time_window"]["timezone"] = timezone
        return plan

    def _heuristic_plan(
        self,
        utterance: str,
        schema_slice: Dict[str, Any],
        context: Optional[Dict[str, Any]],
        timezone: str,
    ) -> Dict[str, Any]:
        u = utterance.lower()
        tables = schema_slice.get("tables", {})
        table_names = list(tables.keys())

        # Determine target table
        target_table = None
        for t in table_names:
            if t.lower() in u:
                target_table = t
                break
        if not target_table:
            # Check for synonyms
            if "user" in u or "customer" in u or "account" in u:
                target_table = next((t for t in table_names if "user" in t or "acct" in t or "account" in t), table_names[0] if table_names else "users")
            elif "order" in u:
                target_table = next((t for t in table_names if "order" in t or "ord" in t), table_names[0] if table_names else "orders")
            elif "product" in u or "item" in u:
                target_table = next((t for t in table_names if "prod" in t or "item" in t), table_names[0] if table_names else "products")
            else:
                target_table = table_names[0] if table_names else "users"

        table_meta = tables.get(target_table, {})
        cols = table_meta.get("columns", {})

        # Determine intent
        intent = "list"
        if "how many" in u or "count" in u or "total number" in u:
            intent = "count"
        elif "dummy" in u or "test data" in u:
            intent = "find_dummy_data"
        elif "describe" in u or "columns" in u or "schema" in u or "structure" in u or "how many tables" in u:
            intent = "describe_schema"
        elif "change" in u or "update" in u or "modify" in u:
            intent = "update"
        elif "delete" in u or "remove" in u:
            intent = "delete"

        filters = []
        assumptions = []
        time_window = None

        # Check for regions (e.g. Rajasthan)
        if "rajasthan" in u:
            if "region" in cols:
                filters.append({"table": target_table, "column": "region", "op": "=", "value": "RJ", "value_type": "string"})
                assumptions.append("Mapped 'Rajasthan' to region code 'RJ'")
            elif "rgn_cd" in cols:
                filters.append({"table": target_table, "column": "rgn_cd", "op": "=", "value": "RJ", "value_type": "string"})
                assumptions.append("Mapped 'Rajasthan' to region code 'RJ'")

        # Check for time-relative questions ("today", "yesterday")
        if "today" in u or "new" in u:
            # Find created timestamp column
            ts_col = next((c for c, m in cols.items() if m.get("temporal_role") == "created" or "created" in c or "crt" in c), "created_at" if "created_at" in cols else None)
            if ts_col:
                time_window = {
                    "column": ts_col,
                    "from": "start_of_day",
                    "to": "end_of_day",
                    "timezone": timezone,
                    "label": "today",
                }
                assumptions.append(f"Used '{ts_col}' as timestamp column in timezone '{timezone}'")

        select = [{"column": "*", "table": target_table}]
        if intent == "count":
            select = [{"column": "*", "table": target_table, "agg": "count", "alias": "total_count"}]

        return {
            "intent": intent,
            "connection_ref": context.get("active_connection") if context else None,
            "tables": [target_table],
            "select": select,
            "filters": filters,
            "joins": [],
            "group_by": [],
            "order_by": [],
            "time_window": time_window,
            "limit": 50,
            "assumptions": assumptions,
            "needs_clarification": [],
        }


data_planner = DataPlanner()
