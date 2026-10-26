"""
Realistic sample rows for one table, written by the customer's model from the column rules Laravel sends (types,
lengths, allowed values, unique columns, and the existing parent records a linked column may point at). The model never
sees or touches the database; Laravel validates every value again before anything is written.
"""
import json
import time
from typing import Any, Dict, List, Optional

from ai_service.app.providers.base import BaseAIProvider

BATCH = 8


def _column_schema(c: Dict[str, Any]) -> Dict[str, Any]:
    family = c.get("family")
    if c.get("link"):
        ids = [o["id"] for o in c["link"].get("options", [])]
        return {"type": ["integer", "string"], "enum": ids} if ids else {"type": ["integer", "string", "null"]}
    if c.get("enum"):
        return {"type": "string", "enum": c["enum"]}
    if family == "integer":
        return {"type": "integer"}
    if family == "decimal":
        return {"type": "number"}
    if family == "boolean":
        return {"type": "boolean"}
    return {"type": "string"}


def _describe(c: Dict[str, Any]) -> str:
    bits = [f"- {c['name']} ({c.get('type') or c.get('family')})"]
    if c.get("link"):
        opts = ", ".join(f"{o['id']}={o.get('label') or o['id']}" for o in c["link"].get("options", [])[:40])
        bits.append(f"links to {c['link']['table']}; use one of these ids: {opts}")
    if c.get("enum"):
        bits.append("one of: " + ", ".join(c["enum"]))
    if c.get("max_length"):
        bits.append(f"max {c['max_length']} characters")
    if c.get("unique"):
        bits.append("must be different in every row")
    if c.get("nullable"):
        bits.append("may be null")
    if c.get("family") in ("date",):
        bits.append("format YYYY-MM-DD")
    if c.get("family") in ("timestamp_tz", "timestamp_naive"):
        bits.append("format YYYY-MM-DD HH:MM:SS")
    if c.get("family") == "time":
        bits.append("format HH:MM")
    if c.get("family") == "json":
        bits.append("a JSON string")
    if c.get("comment"):
        bits.append(f"meaning: {c['comment']}")
    return "; ".join(bits)


def generate(provider: BaseAIProvider, table: str, columns: List[Dict[str, Any]], count: int, instructions: str,
             existing_unique: Dict[str, List[str]], budget_seconds: float, temperature: Optional[float]) -> Dict[str, Any]:
    started = time.monotonic()
    names = [c["name"] for c in columns]
    unique_cols = [c["name"] for c in columns if c.get("unique")]
    taken: Dict[str, set] = {n: set(map(str, existing_unique.get(n, [])[:200])) for n in unique_cols}
    rows: List[Dict[str, Any]] = []
    problems: List[str] = []
    rules = "\n".join(_describe(c) for c in columns)

    attempts = 0
    while len(rows) < count and attempts < (count // BATCH + 3):
        attempts += 1
        want = min(BATCH, count - len(rows))
        left = budget_seconds - (time.monotonic() - started)
        if left < 15:
            problems.append("Stopped early: the time limit was reached.")
            break
        avoid = {n: sorted(v)[-30:] for n, v in taken.items() if v}
        schema = {
            "type": "object",
            "properties": {"rows": {"type": "array", "items": {
                "type": "object",
                "properties": {c["name"]: _column_schema(c) for c in columns},
                "required": names,
            }}},
            "required": ["rows"],
        }
        messages = [
            {"role": "system", "content": (
                f"You create realistic, varied sample rows for the database table `{table}`. Reply with JSON only: "
                '{"rows": [ {column: value, ...}, ... ]}. Follow every column rule exactly. Use plausible, natural values '
                "(no lorem ipsum, no 'test', no placeholders)."
            )},
            {"role": "user", "content": (
                f"Create {want} rows.\nColumns:\n{rules}\n"
                + (f"What the rows should be about: {instructions}\n" if instructions else "")
                + (f"Do not reuse these values for unique columns: {json.dumps(avoid, ensure_ascii=False)}\n" if avoid else "")
            )},
        ]
        try:
            raw = provider.chat_structured(messages, schema, timeout=left, temperature=0.8 if temperature is None else temperature,
                                           deadline=time.monotonic() + left, max_output_tokens=min(4096, 220 * want + 200))
            data = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            problems.append("The model returned text that was not valid JSON; tried again.")
            continue
        except Exception as e:  # provider errors and timeouts end the batch honestly
            problems.append(f"{type(e).__name__}: {str(e)[:160]}")
            break
        for r in (data or {}).get("rows", []) if isinstance(data, dict) else []:
            if not isinstance(r, dict):
                continue
            row = {n: r.get(n) for n in names if n in r}
            dup = next((n for n in unique_cols if row.get(n) is not None and str(row[n]) in taken[n]), None)
            if dup:
                continue
            for n in unique_cols:
                if row.get(n) is not None:
                    taken[n].add(str(row[n]))
            rows.append(row)
            if len(rows) >= count:
                break

    return {"rows": rows, "requested": count, "problems": problems, "seconds": round(time.monotonic() - started, 2)}
