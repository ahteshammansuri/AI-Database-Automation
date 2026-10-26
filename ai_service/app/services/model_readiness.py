"""
Model readiness: four small, real tasks the customer's model must get right before it drives Orbit or writes data
plans. Each answer is checked in code (exact JSON, right tool, right query, correction applied). Nothing is assumed
from the model's name.
"""
import json
import time
from typing import Any, Callable, Dict, List, Tuple

from ai_service.app.providers.base import BaseAIProvider

Check = Dict[str, Any]


def _json_format() -> Check:
    schema = {
        "type": "object",
        "properties": {"city": {"type": "string"}, "country": {"type": "string"}, "year_completed": {"type": "integer"}},
        "required": ["city", "country", "year_completed"],
    }

    def verify(d: Dict[str, Any]) -> Tuple[bool, str]:
        if not all(k in d for k in ("city", "country", "year_completed")):
            return False, "Some required fields were missing from the JSON."
        if not isinstance(d["year_completed"], int):
            return False, "year_completed was not a whole number."
        ok = "paris" in str(d["city"]).lower() and "france" in str(d["country"]).lower() and 1887 <= d["year_completed"] <= 1890
        return ok, "Returned exact JSON with correct values." if ok else f"JSON was valid but the facts were wrong ({d})."

    return {
        "key": "json_conformance",
        "label": "Answers in exact JSON",
        "messages": [
            {"role": "system", "content": "Reply with JSON only, matching the schema."},
            {"role": "user", "content": "Where is the Eiffel Tower and in which year was it completed?"},
        ],
        "schema": schema,
        "verify": verify,
    }


def _tool_choice() -> Check:
    schema = {
        "type": "object",
        "properties": {
            "tool": {"type": "string", "enum": ["open_page", "pause_automation", "answer"]},
            "arguments": {"type": "object"},
        },
        "required": ["tool", "arguments"],
    }

    def verify(d: Dict[str, Any]) -> Tuple[bool, str]:
        if d.get("tool") != "pause_automation":
            return False, f"Chose '{d.get('tool')}' instead of pause_automation."
        name = str((d.get("arguments") or {}).get("name", "")).lower()
        ok = "daily tech news" in name
        return ok, "Chose the right tool with the right automation." if ok else f"Right tool, wrong automation name ('{name}')."

    return {
        "key": "tool_calling_safety",
        "label": "Picks the right action",
        "messages": [
            {"role": "system", "content": (
                "You operate a web portal. Tools: open_page(page: string) opens a page; "
                "pause_automation(name: string) pauses one automation by its name; answer(text: string) replies without acting. "
                "Reply with JSON {\"tool\": ..., \"arguments\": {...}} only."
            )},
            {"role": "user", "content": "Please pause my automation called Daily Tech News."},
        ],
        "schema": schema,
        "verify": verify,
    }


def _query_plan() -> Check:
    schema = {
        "type": "object",
        "properties": {
            "table": {"type": "string"},
            "operation": {"type": "string", "enum": ["count", "sum", "list"]},
            "filters": {"type": "array", "items": {"type": "object", "properties": {"column": {"type": "string"}, "value": {"type": "string"}}, "required": ["column", "value"]}},
        },
        "required": ["table", "operation", "filters"],
    }

    def verify(d: Dict[str, Any]) -> Tuple[bool, str]:
        if str(d.get("table", "")).lower() != "orders":
            return False, f"Picked table '{d.get('table')}' instead of orders."
        if d.get("operation") != "count":
            return False, f"Used '{d.get('operation')}' instead of count."
        filters = d.get("filters") or []
        ok = any(str(f.get("column", "")).lower() == "status" and str(f.get("value", "")).lower() == "paid" for f in filters if isinstance(f, dict))
        return ok, "Built the right query plan." if ok else "Missed the status = paid filter."

    return {
        "key": "query_plan_accuracy",
        "label": "Turns a question into a data query",
        "messages": [
            {"role": "system", "content": (
                "Database tables: orders(id, total_amount, status: 'paid' or 'refunded', created_at), customers(id, name). "
                "Turn the question into a query plan. Reply with JSON only."
            )},
            {"role": "user", "content": "How many paid orders are there?"},
        ],
        "schema": schema,
        "verify": verify,
    }


def _correction() -> Check:
    schema = {
        "type": "object",
        "properties": {"publish_time": {"type": "string"}, "frequency": {"type": "string"}},
        "required": ["publish_time", "frequency"],
    }

    def verify(d: Dict[str, Any]) -> Tuple[bool, str]:
        t = str(d.get("publish_time", "")).replace(" ", "")
        ok_time = t in ("10:30", "10:30am", "10.30")
        ok_freq = str(d.get("frequency", "")).lower() == "daily"
        if ok_time and ok_freq:
            return True, "Applied the change and kept the rest."
        if not ok_time:
            return False, f"Time became '{d.get('publish_time')}' instead of 10:30."
        return False, f"Changed frequency to '{d.get('frequency')}' although only the time was corrected."

    return {
        "key": "slot_correction",
        "label": "Applies a correction",
        "messages": [
            {"role": "system", "content": "Current settings: {\"publish_time\": \"09:00\", \"frequency\": \"daily\"}. Apply the user's correction and return the full settings as JSON."},
            {"role": "user", "content": "Actually, make it 10:30 instead."},
        ],
        "schema": schema,
        "verify": verify,
    }


CHECKS: List[Callable[[], Check]] = [_json_format, _tool_choice, _query_plan, _correction]


def run(provider: BaseAIProvider, budget_seconds: float = 240.0) -> Dict[str, Any]:
    """Runs every check with temperature 0; each gets an equal share of the time budget."""
    start = time.monotonic()
    share = max(20.0, budget_seconds / len(CHECKS))
    results = []
    for make in CHECKS:
        check = make()
        t0 = time.monotonic()
        try:
            raw = provider.chat_structured(check["messages"], check["schema"], timeout=share, temperature=0.0, deadline=t0 + share)
            data = json.loads(raw) if isinstance(raw, str) else raw
            passed, details = check["verify"](data if isinstance(data, dict) else {})
        except json.JSONDecodeError:
            passed, details = False, "The answer was not valid JSON."
        except Exception as e:  # provider errors, timeouts
            passed, details = False, f"{type(e).__name__}: {str(e)[:160]}"
        results.append({
            "key": check["key"],
            "label": check["label"],
            "passed": bool(passed),
            "details": details,
            "seconds": round(time.monotonic() - t0, 2),
        })
    passed = sum(1 for r in results if r["passed"])
    return {
        "checks": results,
        "passed": passed,
        "total": len(results),
        "score": round(100 * passed / len(results)),
        "seconds": round(time.monotonic() - start, 2),
    }
