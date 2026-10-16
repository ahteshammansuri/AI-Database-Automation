import re
import time
from collections import deque
from typing import Dict, Any, List, Optional
from ai_service.app.providers.base import BaseAIProvider, ProviderUnavailableError


class MockAIProvider(BaseAIProvider):
    """
    Deterministic local generator for testing and offline local demos.
    Generates schema-valid blog posts and dynamically incorporates rejection feedback.
    """

    def __init__(self, model_name: str = "mock-llama3-synthetic"):
        self.model_name = model_name

    def test_connection(self) -> Dict[str, Any]:
        return {
            "available": True,
            "latency_ms": 1.2,
            "models": ["mock-llama3-synthetic", "mock-mistral-synthetic"],
            "message": "Local mock generator ready (Offline testing & demo mode)."
        }

    def list_models(self) -> List[str]:
        return ["mock-llama3-synthetic", "mock-mistral-synthetic"]

    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None,
        schema_constraints: Optional[Dict[str, Any]] = None,
        relation_catalog: Optional[Dict[str, Any]] = None,
        recent_titles: Optional[List[str]] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        if kwargs.get("field_specs"):
            return self._generate_from_specs(prompt, kwargs["field_specs"], rejection_feedback, recent_titles)

        # 1. Extract RAG context passages if present
        rag_passages = []
        rag_match = re.search(r"--- RETRIEVED KNOWLEDGE CONTEXT.*?---\s*(.*?)\s*----------------------------------", prompt, re.DOTALL)
        if rag_match:
            rag_text = rag_match.group(1).strip()
            # Strip UNTRUSTED_CONTENT tags and extract lines
            clean_rag = re.sub(r"</?UNTRUSTED_CONTENT>", "", rag_text)
            rag_passages = [line.strip() for line in clean_rag.split("\n") if line.strip() and not line.strip().startswith("---") and not line.strip().startswith("CRITICAL SECURITY")]

        # 2. Extract core topic from prompt
        cleaned_prompt = re.sub(r"--- RETRIEVED KNOWLEDGE CONTEXT.*?----------------------------------", "", prompt, flags=re.DOTALL).strip()
        cleaned_prompt = re.sub(r"^Task:\s*", "", cleaned_prompt, flags=re.IGNORECASE).strip()

        topic_match = re.search(r"topic:\s*([^\n\.]+)", cleaned_prompt, re.IGNORECASE)
        if topic_match:
            raw_topic = topic_match.group(1).strip()
        else:
            first_line = cleaned_prompt.split("\n")[0].strip()
            # Clean symbols like bullet points
            raw_topic = re.sub(r"[•|–—]", " ", first_line).strip()
            raw_topic = re.sub(r"\s+", " ", raw_topic)

        if not raw_topic or raw_topic.lower() in ["generate rich content", "write a post"]:
            if rag_passages:
                first_hdr = next((p.replace("#", "").strip() for p in rag_passages if p.startswith("#")), "Nutritional Wellness")
                raw_topic = first_hdr
            else:
                raw_topic = "Healthy Nutrition & Lifestyle Guide"

        # Format topic into title
        topic_words = [w.capitalize() for w in raw_topic.split() if w.strip()]
        topic_display = " ".join(topic_words) if topic_words else "Comprehensive Insights"

        clean_slug = re.sub(r"[^\w\s-]", "", raw_topic.lower()).strip()
        slug = re.sub(r"[-\s]+", "-", clean_slug)
        if not slug:
            slug = "article-insights"

        is_food_topic = any(w in raw_topic.lower() for w in ["food", "meat", "diet", "diate", "eat", "meal", "nutrition", "recipe", "health"])
        is_tech_topic = any(w in raw_topic.lower() for w in ["database", "sql", "mysql", "api", "code", "devops", "cloud", "system"])

        if is_food_topic:
            title = f"The Essential Guide to {topic_display}"
            excerpt = f"A holistic, evidence-based exploration of {topic_display}, focusing on balanced macronutrients, dietary wellness, and daily sustainable habits."
            keywords = "healthy diet, nutrition, meal planning, dietary habits, wellness, healthy living"
        elif is_tech_topic:
            title = f"Deep Dive: {topic_display}"
            excerpt = f"An in-depth exploration of {topic_display}, examining architecture patterns, performance considerations, and automated workflows."
            keywords = "database, automation, mysql, ai, devops, software architecture"
        else:
            title = f"Comprehensive Insights: {topic_display}"
            excerpt = f"An insightful analysis examining key trends, practical frameworks, and strategic guidance for {topic_display}."
            keywords = f"{raw_topic.lower()}, insights, analysis, strategy, best practices"

        if rejection_feedback:
            title = f"{title} (Revised Edition)"
            excerpt = f"Revised content addressing editorial feedback: '{rejection_feedback}'."

        # Assemble rich content body incorporating RAG context if available
        rag_section = ""
        if rag_passages:
            rag_section = "\n\n## Verified Knowledge & Core Principles\n"
            for p in rag_passages[:5]:
                clean_p = p.lstrip("#").strip()
                if clean_p.startswith("*"):
                    rag_section += f"{clean_p}\n"
                else:
                    rag_section += f"- **{clean_p}**\n"

        content_body = f"""# {title}

{excerpt}

## Introduction
Achieving consistency with {topic_display} requires thoughtful structure and a clear understanding of foundational principles. Whether you are building daily routines or refining strategies, taking an intentional approach ensures long-term success.
{rag_section}
## Practical Implementation Steps
1. **Define Core Objectives:** Clarify your focal metrics and establish realistic expectations.
2. **Prioritize Satiety & Quality:** Focus on foundational building blocks before fine-tuning complex details.
3. **Review & Iterate:** Maintain a regular log to observe trends and make informed adjustments over time.

## Editorial Revisions
{"Previous revision feedback addressed: " + rejection_feedback if rejection_feedback else "Initial automated draft."}

## Summary & Action Items
By adhering to these actionable insights, you create a sustainable and highly effective workflow tailored to your individual goals.
"""

        # Novelty check: avoid repeating recent titles
        if recent_titles and any(title.lower() == t.lower() for t in recent_titles):
            title = f"Deep Dive: Modern Perspectives on {topic_display}"
            slug = re.sub(r"[-\s]+", "-", re.sub(r"[^\w\s-]", "", title.lower()).strip())

        result: Dict[str, Any] = {}
        for field in required_fields:
            lower_field = field.lower()
            if lower_field == "title":
                result[field] = title
            elif lower_field == "slug":
                result[field] = f"{slug}-{int(time.time()) % 10000}" if not rejection_feedback else f"{slug}-revised-{int(time.time()) % 10000}"
            elif lower_field in ["excerpt", "short_description", "summary"]:
                result[field] = excerpt[:250]
            elif lower_field in ["content", "body", "description"]:
                result[field] = content_body
            elif lower_field == "status":
                result[field] = "published" if schema_constraints and "published" in schema_constraints.get(field, {}).get("enum_values", []) else "1"
            elif lower_field in ["seo_title", "meta_title"]:
                result[field] = title[:60]
            elif lower_field in ["meta_description"]:
                result[field] = excerpt[:160]
            elif lower_field in ["meta_keywords", "keywords", "tags"]:
                result[field] = keywords
            elif lower_field == "deleted_at":
                result[field] = None
            elif re.search(r"(banner|meta_img|thumbnail|cover|photo|image|avatar)", lower_field):
                # Images come from the image pipeline, never from the text model.
                continue
            elif lower_field.endswith("_id") or lower_field == "id" or lower_field in ["category_id", "author_id", "user_id"]:
                if relation_catalog and field in relation_catalog and relation_catalog[field].get("values"):
                    result[field] = relation_catalog[field]["values"][0]
                else:
                    result[field] = 1
            elif lower_field in ["views", "count", "sort_order", "priority", "is_featured", "is_active"]:
                result[field] = 1
            elif "date" in lower_field or "at" in lower_field:
                result[field] = time.strftime("%Y-%m-%d %H:%M:%S")
            else:
                result[field] = f"Insights on {topic_display}"

            # Post-process with schema constraints (max length, enum values, types)
            if schema_constraints and field in schema_constraints:
                c = schema_constraints[field]
                enums = c.get("enum_values") or []
                max_len = c.get("max_length")
                if enums and str(result[field]) not in [str(e) for e in enums]:
                    result[field] = enums[0]
                if max_len and isinstance(result[field], str) and len(result[field]) > max_len:
                    result[field] = result[field][:max_len]

        return result

    def _generate_from_specs(
        self,
        prompt: str,
        specs: List[Dict[str, Any]],
        rejection_feedback: Optional[str],
        recent_titles: Optional[List[str]],
    ) -> Dict[str, Any]:
        """Deterministic, clearly synthetic values that honour the field contract (offline dev and tests)."""
        cleaned = re.sub(r"--- RETRIEVED KNOWLEDGE CONTEXT.*?----------------------------------", "", prompt, flags=re.DOTALL)
        m = re.search(r"Topic and direction:\s*([^\n]+)", cleaned, re.IGNORECASE) or re.search(r"topic:\s*([^\n]+)", cleaned, re.IGNORECASE)
        topic = (m.group(1) if m else cleaned.strip().split("\n")[0]).strip().rstrip(".") or "Content Automation"
        topic = re.sub(r"\s+", " ", topic)[:80]
        display = " ".join(w[:1].upper() + w[1:] for w in topic.split())

        title = f"{display}: A Practical Guide"
        if rejection_feedback:
            title = f"{display}: A Revised Practical Guide"
        if recent_titles and any(title.lower() == t.lower() for t in recent_titles):
            title = f"{display}: Lessons From the Field"
        summary = f"A practical look at {topic.lower()}: what matters, common pitfalls and the steps that work."
        body = (
            f"{summary}\n\n## Why it matters\n{display} affects day-to-day decisions. This guide focuses on what you can apply right away.\n\n"
            f"## Key steps\n1. Define the outcome you want.\n2. Start with the simplest approach that works.\n3. Measure, review and adjust.\n\n"
            f"## Common pitfalls\n- Skipping the basics\n- Changing too many things at once\n\n## Summary\nSmall, consistent improvements beat big one-off changes."
        )
        if rejection_feedback:
            body += f"\n\n> Revised to address reviewer feedback: {rejection_feedback}"
        keywords = ", ".join(dict.fromkeys(w.lower() for w in re.findall(r"[A-Za-z]{4,}", topic))) or "guide, practical"

        out: Dict[str, Any] = {}
        for spec in specs:
            name = spec.get("name")
            kind = spec.get("kind", "text")
            if not name:
                continue
            if kind == "title":
                val: Any = title
            elif kind == "summary":
                val = summary
            elif kind == "body":
                val = body
            elif kind == "meta_title":
                val = title[:60]
            elif kind == "meta_description":
                val = summary[:160]
            elif kind == "keywords":
                val = keywords
            elif kind == "relation_label":
                options = spec.get("options") or []
                val = options[0] if options else " ".join(display.split()[:2])
            elif kind == "enum":
                val = (spec.get("enum_values") or [""])[0]
            elif kind == "number":
                val = "1"
            elif kind == "boolean":
                val = "true"
            else:
                val = display
            max_len = spec.get("max_length")
            if max_len and isinstance(val, str) and kind != "body" and len(val) > int(max_len):
                val = val[: int(max_len)].rstrip()
            out[name] = val
        return out

    # ------------------------------------------------------------------
    # Agent loop test double. Never selected implicitly: the factory only
    # returns this provider when provider == "mock". It does not interpret
    # utterances; tests script the exact model output it should return.
    # ------------------------------------------------------------------

    scripted_responses: "deque[str]" = deque()
    captured_requests: List[Dict[str, Any]] = []

    @classmethod
    def script(cls, *raw_outputs: str) -> None:
        cls.scripted_responses.extend(raw_outputs)

    @classmethod
    def reset_script(cls) -> None:
        cls.scripted_responses.clear()
        cls.captured_requests.clear()

    def chat_structured(
        self,
        messages: List[Dict[str, str]],
        json_schema: Dict[str, Any],
        timeout: float = 120.0,
        temperature: float = 0.2,
        **_: Any,
    ) -> str:
        type(self).captured_requests.append({"messages": messages, "json_schema": json_schema})
        if not type(self).scripted_responses:
            raise ProviderUnavailableError("Mock provider has no scripted decision (test double only).")
        return type(self).scripted_responses.popleft()
