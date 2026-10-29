"""
Token usage of the model calls made while serving one request.

Providers record each call (provider, model, prompt and completion tokens as reported by the provider); a middleware
returns the totals to Laravel in the `X-AI-Usage` response header, and Laravel stores them per customer. Nothing here
contains prompts, outputs or keys. Calls whose provider reports no counts are recorded with zero tokens.
"""
import json
from contextvars import ContextVar
from typing import Any, Dict, List, Optional

HEADER = "X-AI-Usage"

_calls: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar("ai_usage_calls", default=None)
# Why another model answered than the one chosen (e.g. "gemini-3.5-flash: quota used up"), for this request.
_notes: ContextVar[Optional[List[str]]] = ContextVar("ai_usage_notes", default=None)


def note(text: str) -> None:
    """Remember a fallback reason for the current request (shown to the user, never a secret)."""
    notes = _notes.get()
    if notes is None:
        notes = []
        _notes.set(notes)
    if text and text not in notes:
        notes.append(text[:200])


def notes() -> List[str]:
    return list(_notes.get() or [])


def begin() -> List[Dict[str, Any]]:
    """Start collecting for the current request; returns the list the providers append to."""
    calls: List[Dict[str, Any]] = []
    _calls.set(calls)
    _notes.set([])
    return calls


def _count(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def record(provider: str, model: Optional[str], prompt_tokens: Any = 0, completion_tokens: Any = 0, kind: str = "chat") -> None:
    calls = _calls.get()
    if calls is None:
        return
    calls.append({
        "provider": str(provider or "unknown")[:40],
        "model": str(model or "")[:120],
        "kind": kind,
        "prompt_tokens": _count(prompt_tokens),
        "completion_tokens": _count(completion_tokens),
    })


def record_openai(model: Optional[str], data: Dict[str, Any], kind: str = "chat") -> None:
    u = data.get("usage") or {}
    record("openai", data.get("model") or model, u.get("prompt_tokens"), u.get("completion_tokens"), kind)


def record_gemini(model: Optional[str], data: Dict[str, Any], kind: str = "chat") -> None:
    u = data.get("usageMetadata") or {}
    record("gemini", model, u.get("promptTokenCount"), u.get("candidatesTokenCount"), kind)


def record_anthropic(model: Optional[str], data: Dict[str, Any], kind: str = "chat") -> None:
    u = data.get("usage") or {}
    record("anthropic", data.get("model") or model, u.get("input_tokens"), u.get("output_tokens"), kind)


def record_ollama(model: Optional[str], data: Dict[str, Any], kind: str = "chat") -> None:
    record("ollama", data.get("model") or model, data.get("prompt_eval_count"), data.get("eval_count"), kind)


def summary(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Totals per provider, model and kind."""
    totals: Dict[tuple, Dict[str, Any]] = {}
    for c in calls:
        key = (c["provider"], c["model"], c["kind"])
        t = totals.setdefault(key, {"provider": c["provider"], "model": c["model"], "kind": c["kind"], "calls": 0, "prompt_tokens": 0, "completion_tokens": 0})
        t["calls"] += 1
        t["prompt_tokens"] += c["prompt_tokens"]
        t["completion_tokens"] += c["completion_tokens"]
    return list(totals.values())


def header_value(calls: List[Dict[str, Any]]) -> str:
    return json.dumps(summary(calls), separators=(",", ":"))
