"""
Understanding a customer's table the way a person would, with the customer's own model:

- interpret_table(): what each column stores (its role, in the platform's vocabulary), what it means in plain words,
  what its coded values mean (status 1 = Published), and which table it points to when it only stores an id (a banner
  that holds the id of a row in an uploads table). The model gets three kinds of context: semantic hints (each
  column's embedding compared with the role descriptions), passages retrieved from the customer's FAISS index (their
  knowledge documents and the table profiles of their schema scans), and the values actually stored (bounded counts,
  sent by Laravel). The answer is constrained JSON and is validated here and again in Laravel; nothing is invented
  for a column that does not exist or a value that is not stored. Without a model, the embedding hints alone are
  returned and marked as such.
- choose_parent(): after a piece of content is written, decide whether one of the existing parent records (categories,
  topics ...) is its right home or a new one is needed. Embeddings rank the existing names against the content; the
  model decides and names a new parent; a new name that means the same as an existing one is mapped to it.

The service never sees the customer's database; Laravel sends only metadata and bounded value counts.
"""
import json
import logging
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence

import numpy as np

from ai_service.app.providers.base import BaseAIProvider
from ai_service.app.rag.service import rag_service
from ai_service.app.rag.vector_cache import vector_cache

logger = logging.getLogger(__name__)

# The platform's vocabulary for what a column stores: each role decides how an automation fills the column.
ROLES: Dict[str, str] = {
    "title": "the headline or name of the record, shown as its title",
    "slug": "a URL-friendly identifier made from the title, lowercase words joined by dashes",
    "summary": "a short teaser, excerpt or one-to-two sentence description",
    "body": "the main long text or article content, as rich text, HTML or Markdown",
    "seo_title": "the page title used by search engines (meta title)",
    "seo_description": "the short description used by search engines (meta description)",
    "keywords": "keywords or tags written as text, separated by commas",
    "image": "a picture shown with the record, stored in this column as an image web address or file path",
    "image_reference": "a picture shown with the record, stored as the id of a row in a media or uploads table",
    "file_reference": "a document, video or audio file, stored as the id of a row in a media or uploads table",
    "status": "a coded state of the record, such as published or draft, active or inactive",
    "type": "a coded kind of the record chosen from a short list, not a link to another table",
    "flag": "a yes or no switch stored as a number or a boolean",
    "link": "the id of a row in another table, such as a parent, owner, author or category",
    "datetime": "the date or time of an event, such as published, created, updated, starts or ends",
    "url": "a web address or link to a page",
    "number": "a measured or counted quantity, such as a price, rating, count, position or stock",
    "contact": "personal contact data such as an email address or phone number",
    "json": "structured data stored as JSON",
    "code": "an identifier or code, such as a SKU or reference number, that is not a link",
    "text": "any other short text",
    "internal": "bookkeeping the application fills itself, such as tokens, counters or ids from other systems",
    "file_url": "the full web address (http...) of a stored file",
    "file_path": "the path of a stored file inside the application's own storage",
    "file_name": "the original or display name of a file",
    "file_extension": "the file extension, such as png or jpg",
    "file_mime": "the MIME type of a file, such as image/png",
    "file_kind": "the kind of a stored file, such as image, video or document",
    "file_size": "the size of a file in bytes",
    "image_width": "the width of an image in pixels",
    "image_height": "the height of an image in pixels",
}
CODED_ROLES = {"status", "type", "flag"}


_DIMENSIONS: Dict[str, int] = {}


def _vectors(texts: Sequence[str]) -> List[Optional[np.ndarray]]:
    """Embedding of each text (cached across requests); computed inline when not cached yet."""
    if not texts:
        return []
    emb = rag_service.embedder
    backend = emb.backend
    if backend not in _DIMENSIONS:
        _DIMENSIONS[backend] = int(emb.encode("dimension probe").shape[0])
    dim = _DIMENSIONS[backend]
    out = vector_cache.vectors(list(texts), emb.backend, emb.encode_batch, dim)
    missing = [i for i, v in enumerate(out) if v is None]
    if missing:
        fresh = emb.encode_batch([texts[i] for i in missing])
        for j, i in enumerate(missing):
            out[i] = fresh[j]
    return out


def semantic_backend() -> str:
    return rag_service.embedder.backend


def _column_text(table: str, c: Dict[str, Any]) -> str:
    words = re.sub(r"[_\-]+", " ", re.sub(r"([a-z])([A-Z])", r"\1 \2", str(c.get("name", "")))).lower()
    bits = [f"column {words} in table {table.replace('_', ' ')}", f"stored as {c.get('type') or c.get('family')}"]
    if c.get("comment"):
        bits.append(str(c["comment"]))
    if c.get("link"):
        bits.append(f"points to {c['link']}")
    return ", ".join(bits)


def role_hints(table: str, columns: List[Dict[str, Any]], top: int = 3) -> Dict[str, List[Dict[str, Any]]]:
    """For each column, the roles whose descriptions are closest in meaning (relative to the other roles)."""
    role_names = list(ROLES)
    role_vecs = _vectors([f"{r.replace('_', ' ')}: {d}" for r, d in ROLES.items()])
    col_vecs = _vectors([_column_text(table, c) for c in columns])
    hints: Dict[str, List[Dict[str, Any]]] = {}
    for c, v in zip(columns, col_vecs):
        if v is None:
            continue
        sims = np.array([float(np.dot(v, rv)) if rv is not None and rv.shape == v.shape else -1.0 for rv in role_vecs])
        median = float(np.median(sims))
        order = np.argsort(-sims)[:top]
        hints[c["name"]] = [{"role": role_names[i], "score": round(float(sims[i] - median), 3)} for i in order]
    return hints


def _retrieve(user_id: Optional[int], query: str, top_k: int = 4) -> List[str]:
    """Passages from the customer's own index (knowledge documents and table profiles), best first."""
    if not user_id:
        return []
    try:
        hits = rag_service.query(user_id, query, top_k=top_k)
    except Exception as e:  # retrieval only adds context
        logger.debug("schema interpreter retrieval failed: %s", e)
        return []
    return [h["text"][:900] for h in hits if h.get("text")]


SETTLED_FAMILIES = {"date", "time", "timestamp_tz", "timestamp_naive", "json", "boolean", "enum", "binary"}
MEDIA_CONCEPT = "a table of stored files: each row is one uploaded file with its name, path or web address, extension, type and size"


def settled(c: Dict[str, Any]) -> bool:
    """The type or a known link already says what the column is; the model is not asked about it."""
    return bool(c.get("is_pk") or c.get("link")) or c.get("family") in SETTLED_FAMILIES


def media_tables(other_tables: List[Dict[str, Any]]) -> List[str]:
    """Tables whose columns read like a table of stored files, by meaning (embeddings), plus those already known."""
    known = [t["name"] for t in other_tables if t.get("media")]
    texts = [f"table {t['name'].replace('_', ' ')}: {t.get('description') or ''}" for t in other_tables]
    if len(texts) < 3:
        # Too few tables to compare with each other: each one is judged by its own columns.
        return [t["name"] for t in other_tables if file_table(t)]
    vecs = _vectors([MEDIA_CONCEPT] + texts)
    concept = vecs[0]
    sims = [float(np.dot(concept, v)) if concept is not None and v is not None and v.shape == concept.shape else -1.0 for v in vecs[1:]]
    median = float(np.median(sims))
    # Clearly closer in meaning to "a table of stored files" than the typical table of this database.
    ranked = sorted(zip(other_tables, sims), key=lambda x: x[1], reverse=True)
    found = [t["name"] for t, sim in ranked if sim - median >= 0.08]
    return list(dict.fromkeys(known + found))[:4]


def _describe_column(c: Dict[str, Any], hints: List[Dict[str, Any]]) -> str:
    parts = [f"{c['name']} {c.get('type') or c.get('family')}", "required" if not c.get("nullable", True) else "optional"]
    if c.get("default") not in (None, ""):
        parts.append(f"default {c['default']}")
    if c.get("values"):
        parts.append("values " + ", ".join(f"{v['value']}x{v['count']}" for v in c["values"][:12]))
    if c.get("samples"):
        parts.append("e.g. " + " | ".join(str(x)[:50] for x in c["samples"][:2]))
    if c.get("comment"):
        parts.append(str(c["comment"])[:80])
    if hints:
        parts.append("near: " + ", ".join(h["role"] for h in hints[:2]))
    return "- " + "; ".join(parts)


def _schema(names: List[str], tables: List[str]) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "maxLength": 160},
            "columns": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "enum": names},
                    "role": {"type": "string", "enum": list(ROLES)},
                    "meaning": {"type": "string", "maxLength": 80},
                    "references_table": {"type": ["string", "null"], **({"enum": tables + [None]} if tables else {})},
                    "value_names": {"type": "array", "items": {
                        "type": "object",
                        "properties": {"value": {"type": "string", "maxLength": 64}, "name": {"type": "string", "maxLength": 30}},
                        "required": ["value", "name"],
                    }, "maxItems": 15},
                },
                "required": ["name", "role", "meaning"],
            }},
        },
        "required": ["summary", "columns"],
    }


def _clean_name(text: Any, limit: int) -> str:
    s = re.sub(r"\s+", " ", str(text or "")).strip().strip("\"'`.")
    return s[:limit]


REFERENCE_ROLES = ("link", "image_reference", "file_reference")
FILE_FACT_ROLES = {"file_url", "file_path", "file_name", "file_extension", "file_mime", "file_kind", "file_size", "image_width", "image_height"}
FILE_SIGNAL_ROLES = FILE_FACT_ROLES | {"image_reference", "file_reference"}
# What a reference into a table of files holds, told apart by the meaning of the column.
REFERENCE_KINDS = {
    "link": "a related record, such as a parent, owner, author, product or category",
    "image_reference": "a picture, such as a photo, banner, cover, logo or thumbnail",
    "file_reference": "a document, video or audio file, such as a PDF, a recording or an attachment",
}
_TEXT, _NUMBER = {"string", "text"}, {"integer", "decimal"}
# The column types a role can be stored in (Laravel applies the same rule to the answer).
ROLE_FAMILIES: Dict[str, set] = {
    **{r: _TEXT for r in ("title", "slug", "summary", "body", "seo_title", "seo_description", "keywords", "image", "url",
                          "contact", "text", "code", "file_url", "file_path", "file_name", "file_extension", "file_mime")},
    **{r: _NUMBER for r in ("number", "file_size", "image_width", "image_height")},
    "flag": {"integer", "boolean"},
    "status": {"integer", "string"}, "type": {"integer", "string"}, "file_kind": {"integer", "string"},
    "json": {"json", "text", "string"},
    "datetime": {"date", "time", "timestamp_tz", "timestamp_naive", "integer"},
}
GENERIC_ROLES = {"text", "number"}
CONTENT_ROLES = {"title", "slug", "summary", "body", "seo_title", "seo_description", "keywords", "text"}


def meaning_role(col: Dict[str, Any], meaning: str) -> Optional[str]:
    """The role whose description is closest to what the model said the column holds, among roles its type allows."""
    family = col.get("family")
    roles = [r for r, fams in ROLE_FAMILIES.items() if family in fams]
    if not roles or not meaning:
        return None
    vecs = _vectors([f"{col['name'].replace('_', ' ')}: {meaning}"] + [f"{r.replace('_', ' ')}: {ROLES[r]}" for r in roles])
    query = vecs[0]
    scores = [float(np.dot(query, v)) if query is not None and v is not None and v.shape == query.shape else -1.0 for v in vecs[1:]]
    return roles[int(np.argmax(scores))] if max(scores) > -1.0 else None


def file_table(t: Dict[str, Any]) -> bool:
    """
    A table keeps files when its own reading says so, or when at least two of its columns (besides the key) read
    closest to a file role (path, web address, MIME type, size, a file kept in a table of files ...), by the same
    embedding hints every column gets.
    """
    if t.get("media"):
        return True
    cols = [{"name": str(n)} for n in t.get("columns") or [] if str(n) != str(t.get("key"))]
    if len(cols) < 2:
        return False
    hints = role_hints(str(t.get("name", "")), cols, top=1)
    return sum(1 for h in hints.values() if h and h[0]["role"] in FILE_SIGNAL_ROLES) >= 2


def _reference_role(col: Dict[str, Any], role: str, meaning: str, into_files: bool) -> str:
    """
    The model said this id column stores the id of a row in another table, so it is a reference whatever word it used
    (a "status" whose meaning is "id of the cover image"). Only an id into a table of files can be a picture or file,
    and only when the meaning the model wrote reads closer to a picture or file than to a related record (a product
    table whose columns hold upload ids is not a table of files for its own product_id).
    """
    if role in ("image_reference", "file_reference"):
        return role
    if role in ("image", "file_url", "file_path", "file_name"):
        return "image_reference" if role == "image" else "file_reference"
    if not into_files:
        return "link"
    kinds = list(REFERENCE_KINDS)
    vecs = _vectors([f"{col['name'].replace('_', ' ')}: {meaning or role}"] + [REFERENCE_KINDS[k] for k in kinds])
    query = vecs[0]
    scores = [float(np.dot(query, v)) if query is not None and v is not None and v.shape == query.shape else -1.0 for v in vecs[1:]]
    return kinds[int(np.argmax(scores))]


def _validate(raw: Dict[str, Any], columns: List[Dict[str, Any]], tables: List[str],
              is_file_table: Callable[[str], bool] = lambda name: False) -> Dict[str, Dict[str, Any]]:
    """Keep only what fits the real table: known columns, known roles, observed values, existing tables."""
    by_name = {c["name"]: c for c in columns}
    out: Dict[str, Dict[str, Any]] = {}
    for item in raw.get("columns", []) if isinstance(raw, dict) else []:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        col = by_name.get(name)
        role = item.get("role")
        if col is None or role not in ROLES or name in out:
            continue
        meaning = _clean_name(item.get("meaning"), 200)
        ref = item.get("references_table")
        ref = ref if isinstance(ref, str) and ref in tables else None
        closest = meaning_role(col, meaning)
        if ref and col.get("family") in ("integer", "uuid"):
            role = _reference_role(col, role, meaning, is_file_table(ref))
        elif closest and (role in GENERIC_ROLES or any(role in group and closest in group for group in (FILE_FACT_ROLES, CONTENT_ROLES))):
            # A catch-all word ("text") for a column the model itself described as "File URL", or the wrong one of
            # close roles ("seo_description" for "Item title or name", "file_kind" for "File MIME type"): the model's
            # own words name the column better than its pick from the long list of roles.
            role = closest
        allowed = {str(v["value"]) for v in col.get("values") or []} | {str(v) for v in col.get("enum") or []}
        names: Dict[str, str] = {}
        for vn in item.get("value_names") or []:
            if not isinstance(vn, dict):
                continue
            v = _clean_name(vn.get("value"), 64)
            label = _clean_name(vn.get("name"), 40)
            if v in allowed and label and label.lower() != v.lower():
                names[v] = label
        # meaning_role is what Laravel falls back to when it finds that a claimed link matches no stored value.
        out[name] = {"role": role, "meaning": meaning, "references_table": ref, "value_names": names, "meaning_role": closest}
    return out


def interpret_table(provider: Optional[BaseAIProvider], table: str, columns: List[Dict[str, Any]], other_tables: List[Dict[str, Any]],
                    user_id: Optional[int], budget_seconds: float = 240.0, temperature: float = 0.1,
                    provider_error: Optional[str] = None, focus: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    `columns` describe the whole table (context and embedding hints); `focus` names the columns the model is asked
    about in this call (default: every column the type and known links do not settle). Callers send small batches.
    """
    started = time.monotonic()
    hints = role_hints(table, columns)
    # Most telling first: coded values, then numbers that may be ids of other tables, then text.
    open_cols = sorted((c for c in columns if not settled(c)),
                       key=lambda c: (0 if c.get("values") else 1 if c.get("family") == "integer" else 2))
    ask = [c for c in open_cols if c["name"] in focus] if focus is not None else open_cols
    media = media_tables(other_tables) if other_tables else []

    result: Dict[str, Any] = {
        "table": table,
        "source": "embeddings",
        "embedding_backend": semantic_backend(),
        "hints": hints,
        "open_columns": [c["name"] for c in open_cols],
        "media_tables": media,
        "columns": {},
        "summary": "",
        "passages_used": 0,
        "problems": [provider_error] if provider_error else [],
    }
    if provider is None or not ask:
        result["seconds"] = round(time.monotonic() - started, 2)
        return result

    # Tables an id column here might point to: the closest in meaning to this table and the asked columns, and media tables.
    names = [str(t.get("name")) for t in other_tables if t.get("name")]
    candidates: List[Dict[str, Any]] = []
    if names and len(names) <= 12:
        candidates = list(other_tables)
    elif names:
        query = f"{table} " + " ".join(c["name"] for c in ask)
        ranked = rag_service.rank_texts(query, [t.get("description") or t["name"] for t in other_tables], top_k=6,
                                        names=names, min_margin=0.0, min_lexical=0.2)
        keep = [names[i] for i, _ in ranked] + media
        by = {t["name"]: t for t in other_tables}
        candidates = [by[n] for n in dict.fromkeys(keep) if n in by][:8]
    tables = [t["name"] for t in candidates]
    # Only tables the model itself already read as file tables are labelled; others it judges from their columns.
    confirmed = {t["name"] for t in other_tables if t.get("media")}
    listed = "; ".join(f"{t['name']}({(t.get('description') or '')[:90]}){' [files]' if t['name'] in confirmed else ''}" for t in candidates) or "none"
    passages = _retrieve(user_id, f"{table}: meaning of {', '.join(c['name'] for c in ask)}", top_k=2)
    result["passages_used"] = len(passages)
    notes = ("\nNotes from the customer's documents:\n" + "\n".join(p[:400] for p in passages)) if passages else ""

    messages = [
        {"role": "system", "content": (
            "You are a database analyst. For each listed column return: role (from the allowed roles), meaning (at most 12 "
            "words), references_table when the column stores the id of a row in one of the other tables (a number whose "
            "meaning is a picture or file kept in a table of files, judged from that table's columns, is image_reference "
            "or file_reference to that table), "
            "and value_names giving a short plain name to every stored value of a coded column. Use the stored values and "
            "examples as evidence. summary: one sentence saying what one row of this table is. JSON only."
        )},
        {"role": "user", "content": (
            f"Table {table}. Other tables: {listed}.\nColumns:\n" + "\n".join(_describe_column(c, hints.get(c["name"], [])) for c in ask) + notes
        )},
    ]
    left = budget_seconds - (time.monotonic() - started)
    try:
        raw = provider.chat_structured(messages, _schema([c["name"] for c in ask], tables), timeout=left,
                                       temperature=temperature, deadline=time.monotonic() + left,
                                       max_output_tokens=min(2000, 130 * len(ask) + 160))
        data = json.loads(raw) if isinstance(raw, str) else raw
        by_table = {t["name"]: t for t in candidates}
        seen: Dict[str, bool] = {}

        def is_file_table(name: str) -> bool:
            if name not in seen:
                seen[name] = name in media or file_table(by_table.get(name, {}))
            return seen[name]

        result["columns"] = _validate(data, ask, tables, is_file_table)
        result["summary"] = _clean_name(data.get("summary"), 300) if isinstance(data, dict) else ""
        result["source"] = "model" if result["columns"] else "embeddings"
        _name_values(provider, table, ask, result, budget_seconds - (time.monotonic() - started), temperature)
    except json.JSONDecodeError:
        result["problems"].append("The model returned text that was not valid JSON.")
    except Exception as e:  # provider down, slow or refused: the embedding hints still stand
        result["problems"].append(f"{type(e).__name__}: {str(e)[:160]}")
    result["seconds"] = round(time.monotonic() - started, 2)
    return result


def _name_values(provider: BaseAIProvider, table: str, asked: List[Dict[str, Any]], result: Dict[str, Any], left: float, temperature: float) -> None:
    """A short second question for coded columns the first answer left unnamed: a plain name for every stored value."""
    todo = [c for c in asked if c.get("values") and c["name"] in result["columns"] and not result["columns"][c["name"]]["value_names"]
            and result["columns"][c["name"]]["role"] in CODED_ROLES]
    if not todo or left < 20:
        return
    # Every stored value is a required key, so the constrained answer cannot leave one out (an empty list was allowed
    # before and is what a small model returned).
    stored = {c["name"]: [str(v["value"]) for v in c["values"][:15]] for c in todo}
    schema = {"type": "object", "properties": {
        name: {"type": "object", "properties": {v: {"type": "string", "minLength": 1, "maxLength": 30} for v in values},
               "required": values, "additionalProperties": False}
        for name, values in stored.items()
    }, "required": list(stored), "additionalProperties": False}
    lines = "\n".join(
        f"- {c['name']}: {result['columns'][c['name']]['meaning'] or result['columns'][c['name']]['role']}; stored values "
        + ", ".join(f"{v['value']} ({v['count']} rows)" for v in c["values"][:15])
        for c in todo
    )
    messages = [
        {"role": "system", "content": (
            "You name the codes stored in database columns. Give every stored value a short plain name (1-3 words), "
            "such as Active, Hidden or Published. Answer as {column: {stored value: name}}. JSON only.")},
        {"role": "user", "content": f"Table {table}.\n{lines}"},
    ]
    try:
        raw = provider.chat_structured(messages, schema, timeout=left, temperature=temperature,
                                       deadline=time.monotonic() + left, max_output_tokens=45 * sum(len(c["values"]) for c in todo) + 120)
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:  # the column meanings still stand without value names
        result["problems"].append(f"Value names: {type(e).__name__}: {str(e)[:120]}")
        return
    for name, values in stored.items():
        given = data.get(name) if isinstance(data, dict) else None
        if not isinstance(given, dict):
            continue
        names = {}
        for v, label in given.items():
            v, label = _clean_name(v, 64), _clean_name(label, 40)
            if v in values and label and label.lower() != v.lower():
                names[v] = label
        result["columns"][name]["value_names"] = names


def judge_link(provider: Optional[BaseAIProvider], table: str, column: str, meaning: str, ref_table: str,
               rows: List[Dict[str, Any]], budget_seconds: float = 90.0, temperature: float = 0.1,
               provider_error: Optional[str] = None) -> Dict[str, Any]:
    """
    The model read a column as a coded state ("Item visibility status") and also as the id of rows in another table.
    The stored values are shown next to the rows they would point to, and the model says which reading holds: a link
    (each value is that row) or a code (values with their own meaning that only happen to equal some ids), naming
    every value in case it is a code. The names are asked separately, from the meaning and the values alone, so the
    names of the rows shown for the decision are not copied. Without a model the link stands; the values did match
    the table's keys.
    """
    out: Dict[str, Any] = {"decision": "link", "reason": "", "value_names": {}, "source": "fallback",
                           "problems": [provider_error] if provider_error else []}
    values = [str(r.get("value")) for r in rows if r.get("value") is not None][:15]
    if provider is None or not values:
        return out
    shown = "; ".join(f"{r['value']} -> {_clean_name(r.get('label'), 60) or '(no name)'}" for r in rows[:15])
    schema = {"type": "object", "properties": {
        "decision": {"type": "string", "enum": ["link", "code"]},
        "reason": {"type": "string", "maxLength": 120},
    }, "required": ["decision", "reason"], "additionalProperties": False}
    messages = [
        {"role": "system", "content": (
            "You check one database column. link: each stored value is the id of the row of the other table shown next "
            "to it, and that row is what the value stands for. code: the values are codes with their own meaning (such "
            "as 1 = Active, 2 = Hidden) that only happen to equal some ids there. JSON only.")},
        {"role": "user", "content": f"Column {table}.{column}: {meaning or column}. Stored values and the {ref_table} rows with those ids: {shown}."},
    ]
    started = time.monotonic()
    try:
        raw = provider.chat_structured(messages, schema, timeout=budget_seconds, temperature=temperature,
                                       deadline=started + budget_seconds, max_output_tokens=120)
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:  # the values matched the table's keys, so the link stands
        out["problems"].append(f"{type(e).__name__}: {str(e)[:160]}")
        return out
    if not isinstance(data, dict) or data.get("decision") not in ("link", "code"):
        return out
    out.update({"decision": data["decision"], "reason": _clean_name(data.get("reason"), 200), "source": "model"})
    if data["decision"] == "code":
        asked = [{"name": column, "values": [{"value": r.get("value"), "count": r.get("count") or 1} for r in rows[:15] if r.get("value") is not None]}]
        named = {"columns": {column: {"role": "status", "meaning": meaning, "references_table": None, "value_names": {}}}, "problems": out["problems"]}
        _name_values(provider, table, asked, named, budget_seconds - (time.monotonic() - started), temperature)
        out["value_names"] = named["columns"][column]["value_names"]
    out["seconds"] = round(time.monotonic() - started, 2)
    return out


def _similarity(a: str, b: str) -> float:
    va, vb = _vectors([a, b])
    if va is None or vb is None or va.shape != vb.shape:
        return 0.0
    return float(np.dot(va, vb))


def choose_parent(provider: Optional[BaseAIProvider], entity: str, content: Dict[str, Any], candidates: List[str],
                  allow_new: bool, budget_seconds: float = 120.0, temperature: float = 0.1,
                  provider_error: Optional[str] = None) -> Dict[str, Any]:
    started = time.monotonic()
    labels = [c for c in dict.fromkeys(_clean_name(x, 120) for x in candidates) if c]
    title = _clean_name(content.get("title"), 200)
    summary = _clean_name(content.get("summary"), 500)
    topic = _clean_name(content.get("topic"), 300)
    suggestion = _clean_name(content.get("suggestion"), 80)
    query = ". ".join(x for x in [title, summary, f"Topic: {topic}" if topic else ""] if x) or suggestion

    ranked: List[Dict[str, Any]] = []
    if labels and query:
        vecs = _vectors([query] + labels)
        q = vecs[0]
        for label, v in zip(labels, vecs[1:]):
            score = float(np.dot(q, v)) if q is not None and v is not None and v.shape == q.shape else 0.0
            ranked.append({"label": label, "score": round(score, 4)})
        ranked.sort(key=lambda r: r["score"], reverse=True)
    out: Dict[str, Any] = {"entity": entity, "ranked": ranked[:8], "source": "embeddings", "problems": [provider_error] if provider_error else []}

    def existing(name: str) -> Optional[str]:
        folded = name.casefold()
        return next((l for l in labels if l.casefold() == folded), None)

    def same_as_existing(name: str) -> Optional[str]:
        """An existing parent that means the same as a new name ("Food & Drink" for "Food and Drink")."""
        hit = existing(name)
        if hit or not labels:
            return hit
        best = max(labels, key=lambda l: _similarity(name, l))
        return best if _similarity(name, best) >= 0.92 else None

    decision, label, reason = None, None, ""
    if provider is not None and query:
        shown = ranked[:12] or [{"label": l, "score": 0.0} for l in labels[:12]]
        options = "\n".join(f"- {r['label']}" for r in shown) or "(none yet)"
        rule = (f"Choose an existing {entity} only if it is clearly the right home for this content. If none of them fits, "
                f"choose \"new\" and give a short {entity} name (1-3 words, Title Case) that fits this content and similar future content."
                if allow_new else f"You must choose one of the existing {entity} names.")
        schema = {
            "type": "object",
            "properties": {
                "decision": {"type": "string", "enum": ["existing", "new"] if allow_new else ["existing"]},
                "existing_name": {"type": ["string", "null"], **({"enum": [r["label"] for r in shown] + [None]} if shown else {})},
                "new_name": {"type": ["string", "null"]},
                "reason": {"type": "string"},
            },
            "required": ["decision", "reason"],
        }
        messages = [
            {"role": "system", "content": f"You file a piece of content under the right {entity}. Reply with JSON only."},
            {"role": "user", "content": (
                f"Content title: {title or '(none)'}\nSummary: {summary or '(none)'}\nTopic of the automation: {topic or '(none)'}\n"
                + (f"The writer suggested: {suggestion}\n" if suggestion else "")
                + f"\nExisting {entity} names, most similar first:\n{options}\n\n{rule}"
            )},
        ]
        left = budget_seconds - (time.monotonic() - started)
        try:
            raw = provider.chat_structured(messages, schema, timeout=left, temperature=temperature,
                                           deadline=time.monotonic() + left, max_output_tokens=200)
            data = json.loads(raw) if isinstance(raw, str) else raw
            reason = _clean_name(data.get("reason"), 240)
            if data.get("decision") == "existing" and data.get("existing_name"):
                hit = existing(_clean_name(data["existing_name"], 120))
                if hit:
                    decision, label = "existing", hit
            elif data.get("decision") == "new" and allow_new:
                name = _clean_name(data.get("new_name"), 60)
                if name:
                    same = same_as_existing(name)
                    decision, label = ("existing", same) if same else ("new", name)
                    if same:
                        reason = f"{reason} (“{name}” means the same as the existing “{same}”.)".strip()
            out["source"] = "model"
        except Exception as e:  # provider down or slow: decide from the embeddings
            out["problems"].append(f"{type(e).__name__}: {str(e)[:160]}")

    if decision is None:
        if suggestion:
            same = same_as_existing(suggestion)
            if same or not allow_new:
                decision, label = "existing", same or (ranked[0]["label"] if ranked else None)
            else:
                decision, label = "new", suggestion
        elif ranked:
            decision, label = "existing", ranked[0]["label"]
        reason = reason or "Decided from how close the content is in meaning to each existing name."
    if label is None:
        decision = None
    out.update({"decision": decision, "label": label, "reason": reason, "seconds": round(time.monotonic() - started, 2)})
    return out
