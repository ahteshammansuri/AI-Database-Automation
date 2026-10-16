"""
Field contract for structured content generation.

Laravel describes each column it wants the model to write as a field spec (built from the live
schema, never from the model). This module turns those specs into precise instructions, sizes the
output budget, and reports which required fields the model failed to return. It never invents
values: a missing field is reported back so the control plane can fail or retry honestly.
"""
from typing import Any, Dict, Iterable, List, Optional

# Approximate words for the long body field per requested length.
LENGTH_WORDS = {"short": 350, "medium": 750, "long": 1300}

_KIND_GUIDE = {
    "title": "A specific, engaging headline in plain text (no quotes, no markdown).",
    "summary": "A 1-2 sentence plain-text summary that makes a reader want to continue.",
    "body": "The full body, written in Markdown: an opening paragraph, '##' section headings, short paragraphs, and lists where they help. Do not repeat the title as a heading.",
    "meta_title": "An SEO title in plain text, ideally 50-60 characters.",
    "meta_description": "An SEO meta description in plain text, ideally 140-160 characters.",
    "keywords": "5-8 comma-separated keywords or tags, lowercase, no '#'.",
    "text": "A short plain-text value appropriate for this column.",
    "number": "A number only (digits, optional decimal point), no units.",
    "boolean": "true or false.",
    "enum": "Exactly one of the allowed values.",
    "relation_label": "The name of the related record.",
}


def _spec_value(spec: Any, key: str, default: Any = None) -> Any:
    if isinstance(spec, dict):
        return spec.get(key, default)
    return getattr(spec, key, default)


def spec_names(specs: Iterable[Any]) -> List[str]:
    return [str(_spec_value(s, "name")) for s in specs if _spec_value(s, "name")]


def build_field_contract(specs: Iterable[Any], length: str = "medium") -> str:
    """Instruction block listing every field the model must return, with type, limits and options."""
    words = LENGTH_WORDS.get(length or "medium", LENGTH_WORDS["medium"])
    lines: List[str] = []
    example: Dict[str, str] = {}
    for spec in specs:
        name = _spec_value(spec, "name")
        if not name:
            continue
        kind = _spec_value(spec, "kind", "text") or "text"
        guide = _KIND_GUIDE.get(kind, _KIND_GUIDE["text"])
        parts = [guide]

        if kind == "body":
            parts.append(f"About {words} words.")
        max_len = _spec_value(spec, "max_length")
        if max_len and kind != "body":
            parts.append(f"Maximum {int(max_len)} characters.")
        enum_values = _spec_value(spec, "enum_values") or []
        if enum_values:
            parts.append("Allowed values: " + ", ".join(f'"{v}"' for v in enum_values) + ".")
        if kind == "relation_label":
            entity = _spec_value(spec, "entity") or "item"
            options = [str(o) for o in (_spec_value(spec, "options") or [])][:40]
            allow_new = bool(_spec_value(spec, "allow_new", True))
            parts = [f"The {entity} this content belongs to."]
            if options:
                parts.append("Prefer one of these existing " + entity + " names, copied exactly: " + "; ".join(options) + ".")
                if allow_new:
                    parts.append(f"Only if none of them fits, propose a new, short {entity} name (1-3 words, Title Case).")
                else:
                    parts.append("You must choose one of them.")
            else:
                parts.append(f"Propose a short {entity} name (1-3 words, Title Case).")
        instructions = _spec_value(spec, "instructions")
        if instructions:
            parts.append(str(instructions).strip())

        lines.append(f'- "{name}": ' + " ".join(parts))
        example[name] = "..."

    keys = ", ".join(f'"{k}"' for k in example)
    return (
        "OUTPUT CONTRACT\n"
        "Return exactly one JSON object with these keys and nothing else: " + keys + ".\n"
        "Every value must be a string unless the field says otherwise. Never leave a value empty, "
        "never use placeholder text, and never invent URLs, image links, statistics or quotes you cannot support.\n"
        + "\n".join(lines)
    )


def token_budget(specs: Iterable[Any], length: str = "medium") -> int:
    """Output token budget sized to the requested fields (bodies dominate)."""
    specs = list(specs)
    has_body = any((_spec_value(s, "kind") == "body") for s in specs)
    base = 220 + 60 * len(specs)
    if has_body:
        base += {"short": 700, "medium": 1350, "long": 2300}.get(length or "medium", 1350)
    return min(4096, base)


def missing_fields(data: Dict[str, Any], specs: Iterable[Any]) -> List[str]:
    """Required fields the model did not return (absent, null, or blank string)."""
    out: List[str] = []
    for spec in specs:
        name = _spec_value(spec, "name")
        if not name or not _spec_value(spec, "required", True):
            continue
        val = data.get(name)
        if val is None or (isinstance(val, str) and not val.strip()):
            out.append(name)
    return out


def subset(specs: Iterable[Any], names: Iterable[str]) -> List[Any]:
    wanted = set(names)
    return [s for s in specs if _spec_value(s, "name") in wanted]


def normalize_values(data: Dict[str, Any], specs: Iterable[Any]) -> Dict[str, Any]:
    """Trim strings, unwrap stray quotes/fences, keep only contracted keys. Does not fabricate."""
    allowed = {(_spec_value(s, "name")): s for s in specs if _spec_value(s, "name")}
    out: Dict[str, Any] = {}
    for key, val in (data or {}).items():
        if key not in allowed:
            continue
        if isinstance(val, str):
            v = val.strip()
            if v.startswith("```"):
                v = v.strip("`").strip()
                if v.lower().startswith("markdown"):
                    v = v[8:].strip()
            kind = _spec_value(allowed[key], "kind", "text")
            if kind != "body" and len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1].strip()
            out[key] = v
        elif isinstance(val, list) and _spec_value(allowed[key], "kind") == "keywords":
            out[key] = ", ".join(str(x).strip() for x in val if str(x).strip())
        else:
            out[key] = val
    return out
