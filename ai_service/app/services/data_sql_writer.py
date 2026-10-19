"""
SQL writer for the data assistant: the user's model writes ONE read-only SELECT for a question,
from the live schema slice Laravel sends (secret columns are never included). The result is only a
proposal: Laravel sends it through the validated read gate (sql_analyzer.validate_select) and runs it
read-only with a timeout. When the gate or the database rejects it, the caller retries with the error.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from ai_service.app.providers.base import ProviderError
from ai_service.app.providers.factory import AIProviderFactory

logger = logging.getLogger(__name__)

SQL_WRITER_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "clarification": {"type": "string"},
    },
    "required": ["sql", "assumptions", "clarification"],
}

RULES = """You write ONE read-only {dialect} SELECT statement that answers the user's question from their database.
Rules:
- Use only the tables and columns listed below, spelled exactly. Join tables only through the listed references (a.col -> b.col).
- Every comparison must point the way the words do: "out of stock"/"none"/"zero" = 0, "more than N" = > N, "at least N" = >= N, "most" = ORDER BY ... DESC, "least" = ASC.
- Never add filters the question does not ask for (no status, date or other conditions unless the user said so): "average order total" means over all orders.
- Join only the tables the question needs. Joining a child table (e.g. order_items to orders) repeats the parent rows and inflates COUNT/SUM.
- "Which/who has the most/least X" or "top N": GROUP BY the entity's id (and its name/title/email columns), COUNT or SUM the X, ORDER BY that value DESC (most) or ASC (least). Use LIMIT 5 (or N if asked) so ties are visible. Give the count/sum a clear alias.
- When returning people or things, include readable columns (name, title, email, order_no ...) next to ids.
- Status words must use the exact values listed for that column (for example a refund is the value 'refunded' if that is listed).
- Dates: "today" = DATE(col) = CURDATE(), "this month" = YEAR and MONTH of col equal the current ones, "last N days" = col >= NOW() - INTERVAL N DAY. Prefer created_at-style columns for "when".
- Always end with LIMIT (50 unless the question asks for a different number). One statement, no semicolons, no comments.
- The question may be in Hindi, Hinglish or another language: understand it, but use the English table and column names.
- If the listed tables cannot answer the question, return "sql": "" and put a short question or explanation in "clarification".
- "assumptions": each interpretation you made, in plain words (e.g. "customers are rows of users", "refund = orders.status 'refunded'").
Return JSON: {{"sql": "...", "assumptions": ["..."], "clarification": ""}}"""


def describe_schema(schema_slice: Dict[str, Any]) -> str:
    """Compact, model-friendly schema: one line per table with column types and references."""
    refs: Dict[str, Dict[str, str]] = {}
    for fk in schema_slice.get("foreign_keys") or []:
        cols, ref_cols = fk.get("columns") or [], fk.get("ref_columns") or []
        for c, rc in zip(cols, ref_cols):
            refs.setdefault(fk.get("table", ""), {})[c] = f"{fk.get('ref_table')}.{rc}"
    lines = []
    for table, meta in (schema_slice.get("tables") or {}).items():
        parts = []
        for col, cm in (meta.get("columns") or {}).items():
            typ = str(cm.get("column_type") or cm.get("type") or "").strip()
            tag = []
            if cm.get("is_primary"):
                tag.append("PK")
            if col in refs.get(table, {}):
                tag.append(f"-> {refs[table][col]}")
            if cm.get("values"):
                tag.append("values: " + ", ".join(repr(v) for v in cm["values"][:15]))
            parts.append(f"{col} {typ}" + (f" [{'; '.join(tag)}]" if tag else ""))
        rows = meta.get("approx_row_count")
        lines.append(f"- {table}({', '.join(parts)})" + (f"  ~{rows} rows" if rows else ""))
    return "\n".join(lines)


def write_select(
    question: str,
    schema_slice: Dict[str, Any],
    dialect: str = "mysql",
    timezone: str = "UTC",
    previous: Optional[List[Dict[str, str]]] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    deadline_seconds: float = 240.0,
) -> Dict[str, Any]:
    deadline = time.monotonic() + max(20.0, deadline_seconds)
    d = "PostgreSQL" if str(dialect).lower() in ("postgres", "postgresql", "pgsql") else "MySQL"
    system = RULES.format(dialect=d)
    user = (
        f"TABLES:\n{describe_schema(schema_slice)}\n\n"
        f"Timezone for dates: {timezone}\n\n"
        f"QUESTION: {question}"
    )
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for p in previous or []:
        messages.append({"role": "assistant", "content": json.dumps({"sql": p.get("sql", ""), "assumptions": [], "clarification": ""})})
        messages.append({"role": "user", "content": f"That query was rejected: {p.get('error', '')}\nWrite a corrected query that follows the rules."})

    name = (provider or "ollama").lower()
    try:
        llm = AIProviderFactory.get_provider(name, model, api_key)
        raw = llm.chat_structured(messages, SQL_WRITER_SCHEMA, timeout=max(10.0, deadline - time.monotonic()),
                                  temperature=0.0, deadline=deadline)
    except ProviderError as e:
        return {"success": False, "error_category": e.category, "error": str(e)}
    except Exception as e:  # provider misconfiguration, network
        logger.warning("SQL writer provider failure: %s", e)
        return {"success": False, "error_category": "MODEL_UNAVAILABLE", "error": str(e)}

    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {"success": False, "error_category": "MODEL_OUTPUT_INVALID", "error": "The model did not return JSON."}
    sql = str(data.get("sql") or "").strip().rstrip(";").strip()
    return {
        "success": True,
        "sql": sql,
        "assumptions": [str(a) for a in (data.get("assumptions") or []) if str(a).strip()][:8],
        "clarification": str(data.get("clarification") or "").strip(),
        "model_used": getattr(llm, "model", model),
    }
