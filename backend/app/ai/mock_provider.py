import re
import time
from typing import Dict, Any, List, Optional
from backend.app.ai.base import BaseAIProvider


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
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        # Extract topic from prompt
        topic_match = re.search(r"topic:\s*([^\n\.]+)", prompt, re.IGNORECASE)
        topic = topic_match.group(1).strip() if topic_match else "Modern Database Automation Best Practices"

        # Generate slug
        clean_slug = re.sub(r"[^\w\s-]", "", topic.lower()).strip()
        slug = re.sub(r"[-\s]+", "-", clean_slug)

        title = f"Deep Dive: {topic.title()}"
        excerpt = f"An in-depth exploration of {topic}, examining architecture patterns, performance considerations, and automated database workflows."

        if rejection_feedback:
            title = f"{title} (Revised Edition)"
            excerpt = f"Revised content addressing editorial feedback: '{rejection_feedback}'."

        content_body = f"""# {title}

{excerpt}

## Introduction
Automating data pipelines and content publication requires robust engineering guardrails. In modern web platforms, combining scheduled execution with schema-aware validation ensures data integrity while accelerating publishing workflows.

## Key Principles
1. **Schema Introspection First:** Never write data without first understanding target column types, constraints, and relationships.
2. **Deterministic Security:** Absolute rejection of destructive operations such as table drops or unconstrained updates.
3. **Human-in-the-Loop Verification:** Provide preview workflows and versioned approvals before committing records.

## Editorial Revisions
{"Previous revision feedback addressed: " + rejection_feedback if rejection_feedback else "Initial automated draft."}

## Conclusion
By adopting these best practices, engineering teams achieve high velocity with zero compromise on data security.
"""

        result: Dict[str, Any] = {}
        for field in required_fields:
            if field == "title":
                result["title"] = title
            elif field == "slug":
                result["slug"] = f"{slug}-{int(time.time()) % 10000}" if not rejection_feedback else f"{slug}-revised-{int(time.time()) % 10000}"
            elif field == "excerpt":
                result["excerpt"] = excerpt
            elif field == "content":
                result["content"] = content_body
            elif field == "status":
                result["status"] = "published"
            elif field == "seo_title":
                result["seo_title"] = title[:60]
            elif field == "meta_description":
                result["meta_description"] = excerpt[:160]
            elif "id" in field:
                result[field] = 1
            else:
                result[field] = f"Generated {field} for {topic}"

        return result
