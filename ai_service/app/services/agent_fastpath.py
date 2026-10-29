"""
Small, focused model calls for Orbit:

- route():  is the message one read-only question about the user's data (and in which database), a request to open
            one page, or anything else? The tables and pages it could be about are retrieved first (embeddings and
            shared words); when nothing matches, no model call is made at all.
- answer(): the reply to the user from a verified result, in the user's language.

The instructions for both calls are the administrators' (Admin › Settings › Orbit, sent by Laravel with each request);
this module only supplies what was retrieved and the JSON shape of the answer. Laravel runs any database tool itself
through its policy gate and falls back to the full agent loop for anything else.
"""
import json
import logging
import time
from typing import Any, Dict, List, Optional, Sequence

from ai_service.app.providers.base import ProviderError
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.rag.service import rag_service
from ai_service.app.schemas.agent import SchemaDocument
from ai_service.app.services.schema_context import by_database, relevant_tables

logger = logging.getLogger(__name__)

ROUTE_KINDS = ["data_question", "open_page", "other"]
ROUTE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ROUTE_KINDS},
        "question": {"type": "string"},
        "page": {"type": "string"},
        "connection_id": {"type": "integer"},
    },
    "required": ["kind", "question", "page"],
}

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"speech_text": {"type": "string"}},
    "required": ["speech_text"],
}

PAGES_TOP_K = 4


def _shape(schema: Dict[str, Any]) -> str:
    """The answer's JSON shape, from its schema (protocol, not instructions)."""
    return "Return JSON with: " + ", ".join(
        f"{k} ({'|'.join(v['enum']) if v.get('enum') else v.get('type')})" for k, v in schema["properties"].items())


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


def _other(reason: str) -> Dict[str, Any]:
    return {"success": True, "kind": "other", "question": "", "page": "", "connection_id": None, "reason": reason}


def relevant_pages(query: str, pages: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """The portal pages the message could be about, by meaning and shared words (title, route and description)."""
    pages = [p for p in pages or [] if p.get("route")]
    texts = [f"{p.get('title', '')} {p['route'].replace('/', ' ').replace('-', ' ')} {p.get('description') or ''}" for p in pages]
    names = [f"{p.get('title', '')} {p['route']}" for p in pages]
    return [pages[i] for i, _ in rag_service.rank_texts(query, texts, top_k=PAGES_TOP_K, names=names)]


def route(utterance: str, history: Optional[List[Dict[str, str]]] = None, provider: Optional[str] = None,
          model: Optional[str] = None, api_key: Optional[str] = None, deadline_seconds: float = 120.0,
          pages: Optional[List[Dict[str, str]]] = None, schema_documents: Optional[Sequence[SchemaDocument]] = None,
          instructions: Optional[str] = None) -> Dict[str, Any]:
    if not (instructions or "").strip():
        return _other("NOT_CONFIGURED")
    recent = [str(m.get("content", ""))[:300] for m in (history or [])[-2:]]
    query = " ".join(recent + [utterance])
    tables = relevant_tables(query, schema_documents or [])
    candidate_pages = relevant_pages(query, pages or [])
    if not tables and not candidate_pages:
        return _other("NOTHING_MATCHED")  # nothing specific: the agent loop decides, no model call spent here

    system = instructions.strip()
    if tables:
        system += "\n\nDATABASES (only the tables that match this message):\n" + by_database(tables)
    if candidate_pages:
        system += "\n\nPAGES:\n" + "\n".join(
            f"- {p['route']} ({p.get('title', '')}){': ' + p['description'] if p.get('description') else ''}" for p in candidate_pages)
    system += "\n\n" + _shape(ROUTE_SCHEMA)
    user = ""
    if history:
        user += "Recent conversation:\n" + "\n".join(f"{m.get('role')}: {str(m.get('content', ''))[:200]}" for m in history[-4:]) + "\n\n"
    user += f"Message: {utterance}"
    out = _call([{"role": "system", "content": system}, {"role": "user", "content": user}], ROUTE_SCHEMA,
                provider, model, api_key, deadline_seconds)
    if not out["success"]:
        return out

    data = out["data"] if isinstance(out["data"], dict) else {}
    kind = data.get("kind") if data.get("kind") in ROUTE_KINDS else "other"
    question = str(data.get("question") or "").strip()
    page = str(data.get("page") or "").strip()
    candidates = {d.connection_id for d, _ in tables}
    try:
        connection_id = int(data.get("connection_id")) if data.get("connection_id") is not None else None
    except (TypeError, ValueError):
        connection_id = None
    if connection_id is None and len(candidates) == 1:
        connection_id = next(iter(candidates))
    # Only what was offered: a database the message's tables are in, a page that was listed.
    if kind == "data_question" and (not question or connection_id not in candidates):
        return _other("DATABASE_NOT_CLEAR" if question else "NO_QUESTION")
    if kind == "open_page" and page not in {p["route"] for p in candidate_pages}:
        return _other("PAGE_NOT_LISTED")
    return {
        "success": True,
        "kind": kind,
        "question": question if kind == "data_question" else "",
        "page": page if kind == "open_page" else "",
        "connection_id": connection_id if kind == "data_question" else None,
    }


def answer(utterance: str, result: Dict[str, Any], provider: Optional[str] = None, model: Optional[str] = None,
           api_key: Optional[str] = None, deadline_seconds: float = 120.0, missing: Optional[List[str]] = None,
           instructions: Optional[str] = None) -> Dict[str, Any]:
    if not (instructions or "").strip():
        return {"success": False, "error_category": "NOT_CONFIGURED", "error": "No reply instructions are set."}
    compact = {k: result.get(k) for k in ("success", "error", "row_count", "columns", "assumptions") if result.get(k) is not None}
    compact["rows"] = (result.get("rows") or [])[:10]
    user = f"User's message: {utterance}\n\n"
    if result.get("message"):
        user += f"FACTS: {result['message']}\n"
    if result.get("facts"):
        user += f"MUST INCLUDE: {', '.join(str(f) for f in result['facts'])}\n"
    user += f"\nResult (JSON):\n{json.dumps(compact, ensure_ascii=False, default=str)[:4000]}"
    if missing:
        user += f"\n\nYour previous reply left out: {', '.join(missing)}. Write it again and include them."
    system = instructions.strip() + "\n\n" + _shape(ANSWER_SCHEMA)
    out = _call([{"role": "system", "content": system}, {"role": "user", "content": user}], ANSWER_SCHEMA,
                provider, model, api_key, deadline_seconds)
    if not out["success"]:
        return out
    text = str((out["data"] or {}).get("speech_text") or "").strip() if isinstance(out["data"], dict) else ""
    if not text:
        return {"success": False, "error_category": "MODEL_OUTPUT_INVALID", "error": "Empty answer."}
    return {"success": True, "speech_text": text}
