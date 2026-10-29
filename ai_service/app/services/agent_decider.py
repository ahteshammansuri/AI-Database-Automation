"""
AgentDecider: one step of Orbit's observe-act loop.

Every meaningful user turn reaches the configured model here, together with the
live runtime context assembled by Laravel, the model-visible tool schemas from
Laravel's registry, retrieved RAG context, and the real tool observations made so
far in this turn. The model returns a single typed AgentDecision.

There is no keyword routing and no canned fallback: if the model is unavailable or
keeps producing invalid output, the response says so with an error category and
Laravel reports a service failure to the user.
"""
import hashlib
import json
import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from pydantic import ValidationError

from ai_service.app.config import settings
import numpy as np

from ai_service.app.providers.base import ProviderError
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.rag.service import rag_service
from ai_service.app.services.schema_context import relevant_tables
from ai_service.app.schemas.agent import (
    DECISION_KINDS,
    EMOTION_HINTS,
    KIND_MEANINGS,
    RESPONSE_STYLES,
    SECURE_INPUT_TYPES,
    AgentDecision,
    DecideRequest,
    DecideResponse,
    RagInfo,
    RetrievedChunk,
)

logger = logging.getLogger(__name__)

MAX_OBSERVATION_CHARS = 1800
MAX_CONTEXT_CHARS = 12000
# Observations kept verbatim; earlier ones in a long turn are condensed to their outcome.
RECENT_OBSERVATIONS_IN_FULL = 6

# Nothing here tells the model how to behave in a situation. Each call is grounded in what the request brings: the
# administrators' role and principles (system_prompt / system_instructions, managed in the admin panel), the decision
# protocol below (generated from the schema), the live runtime context, and what retrieval finds for this request in
# Orbit's knowledge, the user's documents and the schema of their databases.
KNOWLEDGE_CHARS = 6000
SCHEMA_CHARS = 3600


def protocol_text() -> str:
    """The decision protocol: what each kind and field means, from the schema (the contract, like a signature)."""
    lines = ["DECISION PROTOCOL (return one JSON object per call).", "kind is one of:"]
    lines += [f"- {kind}: {meaning}" for kind, meaning in KIND_MEANINGS.items()]
    lines.append("fields:")
    for name, field in AgentDecision.model_fields.items():
        if field.description:
            lines.append(f"- {name}: {field.description}")
    return "\n".join(lines)


# On-screen steps a decision may chain in `then` (the server still refuses any consequential press).
THEN_TOOLS = {"go_to_page", "open_form", "fill_fields", "choose_option", "show_me", "press"}


def build_decision_schema(tool_names: List[str]) -> Dict[str, Any]:
    """JSON schema used to constrain the model's output. Tool names are an enum of available tools."""
    tool_name_schema: Dict[str, Any] = {"type": "string"}
    if tool_names:
        tool_name_schema = {"type": "string", "enum": tool_names}
    return {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": DECISION_KINDS},
            "speech_text": {"type": "string"},
            "tool_call": {
                "type": "object",
                "properties": {"name": tool_name_schema, "args": {"type": "object"}},
                "required": ["name", "args"],
            },
            "plan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"tool": {"type": "string"}, "purpose": {"type": "string"}},
                    "required": ["tool"],
                },
            },
            "then": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "args": {"type": "object"}},
                    "required": ["name", "args"],
                },
            },
            "finish_after": {"type": "boolean"},
            "thought": {"type": "string"},
            "missing_fields": {"type": "array", "items": {"type": "string"}},
            "secure_input_type": {"type": "string", "enum": SECURE_INPUT_TYPES},
            "cancel_action": {"type": "string", "enum": ["STOP", "PAUSE", "RESUME"]},
            "slot_updates": {"type": "object"},
            "response_style": {"type": "string", "enum": RESPONSE_STYLES},
            "emotion_hint": {"type": "string", "enum": EMOTION_HINTS},
        },
        "required": ["kind", "speech_text"],
    }


def _compact_json(value: Any, limit: int) -> str:
    text = json.dumps(value, default=str, separators=(",", ":"), ensure_ascii=False)
    if len(text) > limit:
        text = text[:limit] + "…(truncated)"
    return text


# Decision-critical keys first; long lists after, shortened before anything is cut.
_CONTEXT_FIRST = ("task", "browser_present", "now", "user", "user_timezone", "credentials_captured", "model", "page",
                  "pending_approvals", "data_hint")
_CONTEXT_SHRINK = ("knowledge_documents", "data_autopilots", "recent_runs", "conversation_memory", "focused_schema",
                   "automations", "connections")


def _compact_context(ctx: Dict[str, Any], limit: int) -> str:
    """
    The runtime context within `limit` characters without losing what decides the turn: priority keys come first, and
    when it is too long the longest lists are shortened (keeping their first items and a count of the rest).
    """
    ctx = json.loads(json.dumps(ctx, default=str))  # a copy: shortening must not change the request
    ordered = {k: ctx[k] for k in _CONTEXT_FIRST if k in ctx}
    ordered.update({k: v for k, v in ctx.items() if k not in ordered})

    def size(v: Any) -> int:
        return len(json.dumps(v, default=str, separators=(",", ":"), ensure_ascii=False))

    for _ in range(12):
        if size(ordered) <= limit:
            break
        shrunk = False
        for key in _CONTEXT_SHRINK:
            holder, field = ordered, key
            if key == "focused_schema" and isinstance(ordered.get(key), dict):
                holder, field = ordered[key], "tables"
            items = holder.get(field) if isinstance(holder, dict) else None
            if isinstance(items, list) and len(items) > 3:
                keep = max(3, len(items) // 2)
                more = len(items) - keep + int(holder.get(f"{field}_more", 0) or 0)
                holder[field] = items[:keep]
                holder[f"{field}_more"] = more
                shrunk = True
                if size(ordered) <= limit:
                    break
        if not shrunk:
            break
    return _compact_json(ordered, limit)


_TYPE_ABBR = {"string": "str", "integer": "int", "number": "num", "boolean": "bool", "array": "list", "object": "obj"}


def _signature(parameters: Dict[str, Any]) -> str:
    """Compact one-line parameter signature, e.g. (connection_id:int, host:str, schedule_type:DAILY|WEEKLY; required: name)."""
    props = parameters.get("properties") or {}
    parts = []
    for name, spec in props.items():
        spec = spec or {}
        if spec.get("enum"):
            parts.append(f"{name}:{'|'.join(str(e) for e in spec['enum'])}")
        else:
            parts.append(f"{name}:{_TYPE_ABBR.get(spec.get('type'), spec.get('type', 'any'))}")
    sig = ", ".join(parts)
    required = parameters.get("required") or []
    if required:
        sig += f"; required: {', '.join(required)}"
    return f"({sig})"


# Only one agent decision uses the local model at a time (a CPU-only Ollama serialises anyway;
# queuing here keeps each request's deadline honest instead of timing out inside Ollama).
_MODEL_LOCK = threading.Lock()
_TOOL_VEC_CACHE: Dict[str, Any] = {}


def _tool_vector(text: str):
    key = hashlib.sha1(text.encode("utf-8")).hexdigest()
    if key not in _TOOL_VEC_CACHE:
        _TOOL_VEC_CACHE[key] = rag_service.embedder.encode(text)
    return _TOOL_VEC_CACHE[key]


def select_tools(req: DecideRequest, retrieved: Optional[List[RetrievedChunk]] = None) -> List[str]:
    """
    Which available tools get a full description: the on-screen tools (Orbit operates any page with them), tools used
    or pending in this task, tools the retrieved knowledge names for this situation, then the most relevant others by
    embedding similarity to the request. Every other available tool is still listed by name (and callable).
    """
    available = [t for t in req.tool_schemas if t.available]
    names = {t.name for t in available}
    chosen: List[str] = [t.name for t in available if t.side_effect_class == "ui"]
    for o in req.observations:
        if o.tool in names and o.tool not in chosen:
            chosen.append(o.tool)
    pending = ((req.runtime_context.get("task") or {}).get("awaiting_confirmation_for") or {}).get("tool")
    if pending in names and pending not in chosen:
        chosen.append(pending)
    knowledge = " ".join(c.text for c in (retrieved or []) if c.scope != "schema")
    for t in available:
        if t.name not in chosen and re.search(rf"\b{re.escape(t.name)}\b", knowledge):
            chosen.append(t.name)

    budget = settings.AGENT_MAX_TOOLS - len(chosen)
    rest = [t for t in available if t.name not in chosen]
    if budget > 0 and rest:
        try:
            q_text = req.utterance
            if req.conversation_summary:
                last_messages = [str(m.get("content", "")) for m in req.conversation_summary[-2:]]
                q_text = " ".join(last_messages + [req.utterance])
            q = rag_service.embedder.encode(q_text)
            scored = []
            for t in rest:
                v = _tool_vector(f"{t.name.replace('_', ' ')}: {t.description}")
                if v.shape == q.shape:
                    scored.append((float(np.dot(q, v)), t.name))
            scored.sort(reverse=True)
            chosen += [n for _, n in scored[:budget]]
        except Exception as e:  # selection is an optimisation; fall back to listing in order
            logger.warning("Tool selection failed: %s", type(e).__name__)
            chosen += [t.name for t in rest[:budget]]
    return chosen


def _describe_tools(req: DecideRequest, offered: List[str]) -> str:
    """Compact tool listing: full signatures for offered tools, list for the rest."""
    lines = []
    by_name = {t.name: t for t in req.tool_schemas}
    for name in offered:
        t = by_name.get(name)
        if not t:
            continue
        flags = t.side_effect_class + (", needs confirmation" if t.requires_confirmation else "")
        desc = " ".join(t.description.split())[:200]
        lines.append(f"- {t.name}{_signature(t.parameters)} [{flags}]: {desc}")
    others = [t.name for t in req.tool_schemas if t.name not in offered and t.available]
    text = "\n".join(lines) if lines else "(no tools available)"
    if others:
        text += "\nOTHER TOOLS (callable by name):\n- " + ", ".join(others)
    return text


class AgentDecider:
    @staticmethod
    def retrieval_query(req: DecideRequest, with_page: bool = True) -> str:
        """
        What retrieval searches for: the utterance with the turns it answers, and (for Orbit's knowledge and the portal
        surfaces, not for the user's tables) the page it was said on.
        """
        parts = [str(m.get("content", ""))[:300] for m in (req.conversation_summary or [])[-2:]]
        parts.append(req.utterance)
        page = req.runtime_context.get("page") or {}
        where = page.get("title") or page.get("route") or page.get("currentPath")
        if with_page and where:
            parts.append(f"(page: {where})")
        return " ".join(p for p in parts if p).strip()

    @staticmethod
    def retrieve_schema(req: DecideRequest, query: str) -> List[RetrievedChunk]:
        """The tables of the user's databases the request is about (schema_context: same-named tables come along)."""
        return [
            RetrievedChunk(source_id=f"schema:{d.connection_id}:{d.table}", scope="schema", text=d.text or d.table,
                           score=round(score, 4), heading=f"{d.connection} › {d.table}")
            for d, score in relevant_tables(query, req.schema_documents)
        ]

    @classmethod
    def retrieve(cls, req: DecideRequest) -> RagInfo:
        """Real retrieval (Orbit's knowledge, the user's documents and their tables) or this turn's earlier chunks."""
        if req.retrieved_context is not None:
            chunks = req.retrieved_context
            return RagInfo(
                attempted=True,
                count=len(chunks),
                source_ids=[c.source_id for c in chunks],
                chunks=chunks,
                index_version=None,
            )
        if not req.use_rag:
            return RagInfo(attempted=False)

        query = cls.retrieval_query(req)
        try:
            result = rag_service.retrieve_for_agent(user_id=req.user_id, query_text=query)
            # The page the user is on is about the portal, not their data: it never steers which tables are retrieved.
            chunks = [RetrievedChunk(**c) for c in result["chunks"]] + cls.retrieve_schema(req, cls.retrieval_query(req, with_page=False))
        except Exception as e:  # retrieval failure is reported, never hidden
            logger.warning("Agent RAG retrieval failed: %s", type(e).__name__)
            return RagInfo(attempted=True, error=f"Retrieval failed: {type(e).__name__}")
        return RagInfo(
            attempted=True,
            count=len(chunks),
            source_ids=[c.source_id for c in chunks],
            index_version=result.get("index_version"),
            embedding_backend=result.get("embedding_backend"),
            chunks=chunks,
        )

    @staticmethod
    def _sources(chunks: List[RetrievedChunk], budget: int, each: int) -> str:
        parts = []
        for c in chunks:
            snippet = c.text.strip()[:each]
            if budget - len(snippet) < 0:
                break
            budget -= len(snippet)
            heading = f" — {c.heading}" if c.heading else ""
            parts.append(f"<source id=\"{c.source_id}\" scope=\"{c.scope}\"{heading}>\n{snippet}\n</source>")
        return "\n".join(parts)

    @classmethod
    def portal_text(cls, req: DecideRequest) -> str:
        """
        The on-screen surfaces: fields and actions of the current page's surfaces and of those the request is about
        (retrieved like knowledge), titles of the others (read_screen and open_form show any of them in full).
        """
        if not req.portal_map:
            return ""
        current = (req.runtime_context.get("page") or {}).get("route") or ""
        texts = [" ".join(str(x) for x in [s.get("title"), s.get("surface"), s.get("page"), s.get("purpose") or "",
                                          " ".join(s.get("fields") or []), " ".join(s.get("actions") or [])]) for s in req.portal_map]
        try:
            names = [f"{s.get('title')} {s.get('surface')}" for s in req.portal_map]
            relevant = {i for i, _ in rag_service.rank_texts(cls.retrieval_query(req), texts, top_k=4, names=names)}
        except Exception as e:  # ranking is an optimisation: without it every surface is shown in full
            logger.warning("Surface ranking failed: %s", type(e).__name__)
            relevant = set(range(len(req.portal_map)))
        everything = not current and not relevant
        lines = []
        for i, s in enumerate(req.portal_map):
            page = s.get("page") or ""
            if everything or page == current or i in relevant:
                fields = ", ".join(s.get("fields") or []) or "-"
                actions = ", ".join(s.get("actions") or []) or "-"
                lines.append(f"- {s.get('surface')} on {page} ({s.get('title')}): fields [{fields}]; actions [{actions}]")
            else:
                lines.append(f"- {s.get('surface')} on {page} ({s.get('title')})")
        return "PORTAL MAP (surfaces you can operate; * required field, ! consequential):\n" + "\n".join(lines)

    @classmethod
    def build_messages(cls, req: DecideRequest, rag: RagInfo, offered: Optional[List[str]] = None) -> Tuple[List[Dict[str, str]], bool]:
        """Returns (messages, rag_included)."""
        if offered is None:
            offered = [t.name for t in req.tool_schemas if t.available]
        # Stable text first (role, protocol) so the model server can reuse its cached prompt prefix; the tool list
        # and the portal map, both chosen per request, come after it.
        brand = lambda text: text.strip().replace("{product}", req.product_name).replace("{brand}", req.product_name)
        system_parts = []
        if req.system_prompt and req.system_prompt.strip():
            system_parts.append(brand(req.system_prompt))
        if req.system_instructions and req.system_instructions.strip():
            system_parts.append(f"ADDITIONAL INSTRUCTIONS:\n{brand(req.system_instructions)}")
        system_parts.append(protocol_text())
        system_parts.append(f"TOOLS:\n{_describe_tools(req, offered)}")
        system = "\n\n".join(system_parts)

        portal = cls.portal_text(req)
        sections = ([portal] if portal else []) + [
            f"RUNTIME CONTEXT (live application state, authoritative; *_more counts items left out, use a list tool for them):\n{_compact_context(req.runtime_context, MAX_CONTEXT_CHARS)}",
            f"SLOTS (non-secret values kept for this request or remembered from earlier in the conversation; what the user says now takes precedence):\n{_compact_json(req.slots, 1200)}",
        ]
        if req.conversation_summary:
            sections.append(
                "RECENT CONVERSATION (oldest first):\n"
                + "\n".join(f"{m.get('role', '?')}: {str(m.get('content', ''))[:300]}" for m in req.conversation_summary)
            )

        knowledge = cls._sources([c for c in rag.chunks if c.scope != "schema"], KNOWLEDGE_CHARS, 1000)
        schema = cls._sources([c for c in rag.chunks if c.scope == "schema"], SCHEMA_CHARS, 700)
        if knowledge:
            sections.append("RETRIEVED KNOWLEDGE (Orbit's knowledge and the user's documents that match this request; "
                            "ground answers and steps in it):\n" + knowledge)
        if schema:
            sections.append("RETRIEVED SCHEMA (tables of the user's databases that match this request; the same table "
                            "name can exist in more than one database):\n" + schema)
        rag_included = bool(knowledge or schema)

        if req.observations:
            obs_lines = []
            recent_from = max(0, len(req.observations) - RECENT_OBSERVATIONS_IN_FULL)
            for idx, o in enumerate(req.observations):
                if idx < recent_from:
                    # Older steps: outcome only, so long multi-step turns stay inside the context window.
                    r = o.result if isinstance(o.result, dict) else {}
                    brief = {k: r[k] for k in ("success", "status", "error_category", "safe_message", "message") if k in r}
                    obs_lines.append(f"#{o.iteration} {o.tool}({_compact_json(o.args, 120)}) -> {_compact_json(brief, 240)}")
                    continue
                obs_lines.append(
                    f"#{o.iteration} {o.tool}({_compact_json(o.args, 300)}) -> {_compact_json(o.result, MAX_OBSERVATION_CHARS)}"
                )
            sections.append("OBSERVATIONS (real results of tools you called this turn, in order):\n" + "\n".join(obs_lines))
        else:
            sections.append("OBSERVATIONS: none yet this turn.")

        sections.append(f"CURRENT UTTERANCE:\n{req.utterance}")
        sections.append("Return the next decision as one JSON object.")

        return [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(sections)},
        ], rag_included

    @classmethod
    def validate_decision(cls, raw: str, available_tools: List[str]) -> AgentDecision:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"output was not valid JSON ({e.msg})")
        if not isinstance(data, dict):
            raise ValueError("output must be a JSON object")
        # Optional fields sent as null by some models are treated as absent.
        data = {k: v for k, v in data.items() if v is not None}
        if data.get("kind") != "CALL_TOOL":
            data.pop("tool_call", None)
            data.pop("then", None)
            data.pop("finish_after", None)
        if isinstance(data.get("then"), dict):
            data["then"] = [data["then"]]
        if isinstance(data.get("thought"), str):
            data["thought"] = data["thought"][:240]
        # A plain question to the user (no secret box, no missing form fields) is a clarification.
        if data.get("kind") == "WAIT_FOR_USER" and not data.get("secure_input_type") and not data.get("missing_fields"):
            data["kind"] = "ASK_CLARIFICATION"
        if isinstance(data.get("slot_updates"), list):
            data["slot_updates"] = {}
        if isinstance(data.get("plan"), dict):
            data["plan"] = [data["plan"]]

        decision = AgentDecision.model_validate(data)
        if decision.tool_call and decision.tool_call.name not in available_tools:
            raise ValueError(
                f"tool '{decision.tool_call.name}' is not an available tool; choose one of {available_tools}"
            )
        bad = [t.name for t in decision.then if t.name not in THEN_TOOLS or t.name not in available_tools]
        if bad:
            raise ValueError(f"`then` may only hold on-screen steps {sorted(THEN_TOOLS)}; not {bad}")
        return decision

    @classmethod
    def decide(cls, req: DecideRequest) -> DecideResponse:
        started = time.monotonic()
        deadline = started + req.deadline_seconds
        provider_name = (req.provider or "ollama").lower()
        rag = cls.retrieve(req)
        offered = select_tools(req, rag.chunks)
        rag.offered_tools = offered
        messages, rag_included = cls.build_messages(req, rag, offered)
        rag.used = rag_included
        if not rag_included:
            rag.chunks = []
            rag.source_ids = []
            rag.count = 0

        available = [t.name for t in req.tool_schemas if t.available]
        candidate_tools = list(dict.fromkeys(offered + [o.tool for o in req.observations] + available[:4]))
        schema = build_decision_schema(candidate_tools or available)

        def done(**kw) -> DecideResponse:
            return DecideResponse(rag=rag, provider_used=provider_name,
                                  duration_ms=int((time.monotonic() - started) * 1000), **kw)

        try:
            provider = AIProviderFactory.get_provider(provider_name, req.model, req.api_key)
        except ProviderError as e:
            return done(success=False, error_category=e.category, error_message=str(e))
        model_used = getattr(provider, "model", None) or getattr(provider, "model_name", None)

        is_local = provider_name in ("ollama", "local")
        acquired = False
        if is_local:
            wait = deadline - time.monotonic() - 5
            if wait <= 0 or not _MODEL_LOCK.acquire(timeout=wait):
                return done(success=False, error_category="MODEL_BUSY_OR_SLOW", model_used=model_used,
                            error_message="Another Orbit request was using the local model for the whole time budget.")
            acquired = True
        try:
            repairs = 0
            last_error: Optional[str] = None
            while True:
                try:
                    raw = provider.chat_structured(messages, schema, timeout=settings.AGENT_MODEL_TIMEOUT,
                                                   deadline=deadline - 2,
                                                   **({"temperature": req.temperature} if req.temperature is not None else {}))
                except ProviderError as e:
                    return done(success=False, error_category=e.category, error_message=str(e),
                                model_used=model_used, repairs=repairs)
                try:
                    decision = cls.validate_decision(raw, available)
                    return done(success=True, decision=decision, model_used=model_used, repairs=repairs)
                except (ValueError, ValidationError) as e:
                    last_error = str(e)[:600]
                    logger.warning("Agent decision invalid (repair %d): %s | output: %s", repairs, last_error[:300], raw[:400])
                    # Only repair if there is realistically time for another model call.
                    if repairs >= req.max_repairs or deadline - time.monotonic() < 45:
                        break
                    repairs += 1
                    messages = messages + [
                        {"role": "assistant", "content": raw[:2000]},
                        {"role": "user", "content": f"That decision was invalid: {last_error}\nReturn a corrected decision as one JSON object."},
                    ]
        finally:
            if acquired:
                _MODEL_LOCK.release()

        return done(success=False, error_category="MODEL_OUTPUT_INVALID",
                    error_message=f"The model did not produce a valid decision after {repairs} repair attempt(s): {last_error}",
                    model_used=model_used, repairs=repairs)
