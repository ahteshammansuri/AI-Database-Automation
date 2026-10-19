"""
Small, focused model calls for Orbit's data questions. A long multi-purpose agent prompt makes a small
local model (e.g. qwen2.5:3b) miss what the user wants; these prompts ask one thing each:

- route():  is this message a single read-only question about the user's own data? Restate it in English.
- answer(): write the reply from the verified query result, in the user's language.

Laravel only calls route() when the message names tables/values of the user's own schema (data_hint), runs
the database tool itself through its policy gate, and falls back to the full agent loop for anything else.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional

from ai_service.app.providers.base import ProviderError
from ai_service.app.providers.factory import AIProviderFactory

logger = logging.getLogger(__name__)

ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["data_question", "open_page", "other"]},
        "question": {"type": "string"},
        "page": {"type": "string"},
    },
    "required": ["kind", "question", "page"],
}

PAGES_PROMPT = """
"open_page" = the whole message only asks to open/show/go to one portal page (no other task). Put its route in "page". Pages: {pages}"""

ROUTE_PROMPT = """Decide what the user wants. Their database "{connection}" has tables: {tables}.{values}
"data_question" = the whole message is ONE read-only question about the data in that database: who/which has the most or least, how many, totals, lists, lookups, comparisons, dates.
"other" = anything else: changing or deleting data, doing something in the portal (create, open, connect, approve, remove...), questions about the portal itself, greetings, or several different requests.
The message may be in Hindi, Hinglish or another language. If it is a data_question, restate it as one clear English question with every detail (what to count or rank, filters, dates). Hinglish hints: "kaun sa" = which, "sabse jyada/zyada" = the most, "sabse kam" = the least, "kitne" = how many, "jisne" = who has.
Return JSON: {{"kind": "...", "question": "...", "page": ""}}"""

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"speech_text": {"type": "string"}},
    "required": ["speech_text"],
}

ANSWER_PROMPT = """You are Orbit. Answer the user's question using ONLY the verified result below. Rules:
- Reply in the same language and style the user wrote in (Hinglish stays Hinglish, Hindi stays Hindi, English stays English). Do not repeat the question.
- Start with the direct answer as a complete sentence. FACTS is the verified answer: your reply MUST contain every name and number listed under MUST INCLUDE, written exactly (names in their original spelling, numbers as digits). If FACTS says there is a tie, say it is a tie and name everyone in it.
- Masked values (like a***@gmail.com) stay masked. Never invent rows, names or numbers. 1-3 short sentences, no markdown tables.
- If the result is an error, say plainly that it could not be answered and give the reason in simple words.
Return JSON: {"speech_text": "..."}"""


def _call(messages: List[Dict[str, str]], schema: Dict[str, Any], provider: Optional[str], model: Optional[str],
          api_key: Optional[str], deadline_seconds: float) -> Dict[str, Any]:
    deadline = time.monotonic() + max(15.0, deadline_seconds)
    try:
        llm = AIProviderFactory.get_provider((provider or "ollama").lower(), model, api_key)
        raw = llm.chat_structured(messages, schema, timeout=max(10.0, deadline - time.monotonic()), temperature=0.0, deadline=deadline)
        return {"success": True, "data": json.loads(raw)}
    except ProviderError as e:
        return {"success": False, "error_category": e.category, "error": str(e)}
    except (TypeError, ValueError):
        return {"success": False, "error_category": "MODEL_OUTPUT_INVALID", "error": "The model did not return JSON."}
    except Exception as e:  # provider misconfiguration, network
        logger.warning("Fast-path model call failed: %s", e)
        return {"success": False, "error_category": "MODEL_UNAVAILABLE", "error": str(e)}


def route(utterance: str, hint: Dict[str, Any], history: Optional[List[Dict[str, str]]] = None,
          provider: Optional[str] = None, model: Optional[str] = None, api_key: Optional[str] = None,
          deadline_seconds: float = 120.0, pages: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    values = hint.get("values") or []
    system = ROUTE_PROMPT.format(
        connection=hint.get("connection", "database"),
        tables=", ".join(hint.get("all_tables") or hint.get("tables") or []) or "(none connected)",
        values=(" Stored values mentioned: " + "; ".join(values) + ".") if values else "",
    )
    routes = [p.get("route") for p in pages or [] if p.get("route")]
    if routes:
        system += PAGES_PROMPT.format(pages=", ".join(f"{p['route']} ({p.get('title', '')})" for p in pages if p.get("route")))
    user = ""
    if history:
        user += "Recent conversation:\n" + "\n".join(f"{m.get('role')}: {str(m.get('content', ''))[:200]}" for m in history[-4:]) + "\n\n"
    user += f"Message: {utterance}"
    out = _call([{"role": "system", "content": system}, {"role": "user", "content": user}], ROUTE_SCHEMA,
                provider, model, api_key, deadline_seconds)
    if not out["success"]:
        return out
    data = out["data"] if isinstance(out["data"], dict) else {}
    kind = data.get("kind") if data.get("kind") in ("data_question", "open_page", "other") else "other"
    question = str(data.get("question") or "").strip()
    page = str(data.get("page") or "").strip()
    if (kind == "data_question" and not question) or (kind == "open_page" and page not in routes):
        kind = "other"
    return {"success": True, "kind": kind, "question": question, "page": page if kind == "open_page" else ""}


def answer(utterance: str, result: Dict[str, Any], provider: Optional[str] = None, model: Optional[str] = None,
           api_key: Optional[str] = None, deadline_seconds: float = 120.0, missing: Optional[List[str]] = None) -> Dict[str, Any]:
    compact = {k: result.get(k) for k in ("success", "error", "row_count", "columns", "assumptions") if result.get(k) is not None}
    compact["rows"] = (result.get("rows") or [])[:10]
    user = f"User's question: {utterance}\n\n"
    if result.get("message"):
        user += f"FACTS: {result['message']}\n"
    if result.get("facts"):
        user += f"MUST INCLUDE: {', '.join(str(f) for f in result['facts'])}\n"
    user += f"\nQuery result (JSON):\n{json.dumps(compact, ensure_ascii=False, default=str)[:4000]}"
    if missing:
        user += f"\n\nYour previous reply left out: {', '.join(missing)}. Write it again and include them."
    out = _call([{"role": "system", "content": ANSWER_PROMPT}, {"role": "user", "content": user}], ANSWER_SCHEMA,
                provider, model, api_key, deadline_seconds)
    if not out["success"]:
        return out
    text = str((out["data"] or {}).get("speech_text") or "").strip() if isinstance(out["data"], dict) else ""
    if not text:
        return {"success": False, "error_category": "MODEL_OUTPUT_INVALID", "error": "Empty answer."}
    return {"success": True, "speech_text": text}
