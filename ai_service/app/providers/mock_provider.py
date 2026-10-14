import re
import time
from typing import Dict, Any, List, Optional
from ai_service.app.providers.base import BaseAIProvider


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
        # 1. Extract RAG context passages if present
        rag_passages = []
        rag_match = re.search(r"--- RETRIEVED KNOWLEDGE CONTEXT ---\s*(.*?)\s*----------------------------------", prompt, re.DOTALL)
        if rag_match:
            rag_text = rag_match.group(1).strip()
            # Extract bullet points or headers
            rag_passages = [line.strip() for line in rag_text.split("\n") if line.strip() and not line.strip().startswith("---")]

        # 2. Extract core topic from prompt
        cleaned_prompt = re.sub(r"--- RETRIEVED KNOWLEDGE CONTEXT ---.*?----------------------------------", "", prompt, flags=re.DOTALL).strip()
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
            banner_img = "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1200&auto=format&fit=crop&q=80"
            meta_img = "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80"
            keywords = "healthy diet, nutrition, meal planning, dietary habits, wellness, healthy living"
        elif is_tech_topic:
            title = f"Deep Dive: {topic_display}"
            excerpt = f"An in-depth exploration of {topic_display}, examining architecture patterns, performance considerations, and automated workflows."
            banner_img = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80"
            meta_img = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80"
            keywords = "database, automation, mysql, ai, devops, software architecture"
        else:
            title = f"Comprehensive Insights: {topic_display}"
            excerpt = f"An insightful analysis examining key trends, practical frameworks, and strategic guidance for {topic_display}."
            banner_img = "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=1200&auto=format&fit=crop&q=80"
            meta_img = "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80"
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
                result[field] = "1"
            elif lower_field in ["seo_title", "meta_title"]:
                result[field] = title[:60]
            elif lower_field in ["meta_description"]:
                result[field] = excerpt[:160]
            elif lower_field in ["meta_keywords", "keywords", "tags"]:
                result[field] = keywords
            elif lower_field == "deleted_at":
                result[field] = None
            elif re.search(r"(banner)", lower_field):
                result[field] = banner_img
            elif re.search(r"(meta_img|thumbnail|cover|photo|image|avatar)", lower_field):
                result[field] = meta_img
            elif lower_field.endswith("_id") or lower_field == "id" or lower_field in ["category_id", "author_id", "user_id"]:
                result[field] = 1
            elif lower_field in ["views", "count", "sort_order", "priority", "is_featured", "is_active"]:
                result[field] = 1
            elif "date" in lower_field or "at" in lower_field:
                result[field] = time.strftime("%Y-%m-%d %H:%M:%S")
            else:
                result[field] = f"Insights on {topic_display}"

        return result

    def plan_agent_turn(
        self,
        goal: str,
        context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        rag_chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Deterministic semantic planner for testing and offline local demos.
        Performs slot extraction, safety policy checks, and tool planning.
        """
        lower = goal.lower()

        # 1. DISALLOWED BY POLICY: Destructive SQL
        destructive_patterns = [
            r"\bdrop\b", r"\btruncate\b", r"\bdelete\s+(?:from|all|table|database|rows|data)\b",
            r"\balter\s+(?:table|database|column)\b", r"\bcreate\s+table\b", r"\braw\s+sql\b",
            r"\bsql\s+console\b", r"\bexecute\s+raw\b"
        ]
        if any(re.search(p, lower) for p in destructive_patterns):
            return {
                "task_type": "POLICY_REJECTED",
                "outcome": "DISALLOWED_BY_POLICY",
                "explanation": "Destructive SQL operations (DELETE, DROP, TRUNCATE, ALTER) and raw SQL execution are strictly prohibited on customer databases by platform safety guardrails.",
                "steps": [],
                "extracted_slots": {}
            }

        # 2. UNSUPPORTED BY PRODUCT
        unsupported_keywords = [
            "flight", "hotel", "airline", "order pizza", "order food", "spotify",
            "weather forecast", "uber", "book a ride", "crypto trading", "buy bitcoin"
        ]
        if any(kw in lower for kw in unsupported_keywords):
            return {
                "task_type": "UNSUPPORTED_TASK",
                "outcome": "UNSUPPORTED",
                "explanation": "This operation is outside the platform's supported capabilities. The platform supports database connections, schema discovery, AI content automation workflows, approvals, and scheduled publishing.",
                "steps": [],
                "extracted_slots": {}
            }

        # 3. Dynamic Slot Extraction
        extracted_slots: Dict[str, Any] = {}
        accumulated = dict(context.get("accumulated_slots") or {})

        # Host
        host_m = re.search(r"\bhost\s*(?:is|=|:)?\s*([a-zA-Z0-9\.\-_]+)", lower)
        if host_m:
            extracted_slots["host"] = host_m.group(1).strip()
        elif "localhost" in lower:
            extracted_slots["host"] = "127.0.0.1"
        elif "127.0.0.1" in lower:
            extracted_slots["host"] = "127.0.0.1"

        # Port
        port_m = re.search(r"\bport\s*(?:is|=|:)?\s*(\d+)", lower)
        if port_m:
            extracted_slots["port"] = int(port_m.group(1))

        # Database name
        db_candidates = re.findall(r"(?:database|db)(?:\s+name)?\s*(?:is|=|:|\s+named|\s+called)?\s*['\"]?([a-zA-Z0-9_\-]+)['\"]?", lower)
        for cand in db_candidates:
            if cand not in ["on", "with", "for", "in", "to", "at", "and", "connection", "profile", "server", "named", "called", "is"]:
                extracted_slots["database"] = cand
                break

        # Username
        user_candidates = re.findall(r"(?:username|user)\s*(?:is|=|:|\s+named|\s+called)?\s*['\"]?([a-zA-Z0-9_\-]+)['\"]?", lower)
        for cand in user_candidates:
            if cand not in ["on", "with", "for", "in", "to", "at", "and", "named", "called", "is"]:
                extracted_slots["username"] = cand
                break

        # Connection display name
        name_m = re.search(r"(?:connection\s+)?name\s*(?:is|=|:)?\s*['\"]([^'\"]+)['\"]", goal, re.IGNORECASE)

        if name_m:
            extracted_slots["name"] = name_m.group(1).strip()

        # Password (sensitive)
        pass_m = re.search(r"\bpassword\s*(?:is|=|:)?\s*['\"]?([^'\"\s]+)['\"]?", goal, re.IGNORECASE)
        password_val = pass_m.group(1).strip() if pass_m else None

        # Merge extracted slots with accumulated
        merged_slots = {**accumulated, **extracted_slots}

        # 4. Connection Intents
        is_conn_intent = any(k in lower for k in ["connect", "database", "mysql", "db profile", "link db", "hook up"])
        is_list_intent = any(k in lower for k in ["list", "show", "what databases", "view connections"])
        is_schema_intent = any(k in lower for k in ["scan", "schema", "tables", "columns", "inspect schema"])

        if is_schema_intent and not is_conn_intent:
            conn_id = merged_slots.get("connection_id", 1)
            return {
                "task_type": "SCAN_SCHEMA",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": merged_slots,
                "explanation": f"Inspecting schema and eligible tables for connection #{conn_id}.",
                "steps": [
                    {
                        "tool": "scan_database_schema",
                        "label": f"Scanning Database Schema for Connection #{conn_id}",
                        "args": {"connection_id": conn_id},
                        "risk_level": "LOW",
                        "requires_confirmation": False
                    }
                ]
            }

        if is_list_intent and not any(k in lower for k in ["add", "new", "create"]):
            return {
                "task_type": "LIST_CONNECTIONS",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": merged_slots,
                "explanation": "Retrieving your configured database connections.",
                "steps": [
                    {
                        "tool": "list_database_connections",
                        "label": "Listing Database Connections",
                        "args": {},
                        "risk_level": "LOW",
                        "requires_confirmation": False
                    }
                ]
            }

        if is_conn_intent:
            host = merged_slots.get("host", "127.0.0.1")
            port = merged_slots.get("port", 3306)
            db_name = merged_slots.get("database", "")
            username = merged_slots.get("username", "")
            display_name = merged_slots.get("name", db_name or "MySQL Target")

            missing: List[str] = []
            if not db_name:
                missing.append("database")
            if not username:
                missing.append("username")
            if not password_val and "password" not in merged_slots:
                missing.append("password")

            if missing:
                # Ask only for the first missing required field
                first_missing = missing[0]
                if first_missing == "password":
                    question = f"What is the credentials password for database user '{username or 'root'}'?"
                elif first_missing == "database":
                    question = "Please enter your connection credentials: what is the name of the MySQL database you'd like to connect?"
                elif first_missing == "username":
                    question = "Please provide your database credentials username to connect to the database:"
                else:
                    question = f"Please enter your database credentials: {first_missing} for this connection:"

                return {
                    "task_type": "ADD_CONNECTION",
                    "outcome": "MISSING_INFORMATION",
                    "requires_input": True,
                    "secure_input_type": "database_credentials",
                    "question": question,
                    "missing_fields": missing,
                    "extracted_slots": merged_slots,
                    "explanation": f"Missing required connection parameter: {first_missing}.",
                    "steps": [
                        {
                            "tool": "test_database_connection",
                            "label": f"Testing Connection to MySQL on {host}:{port}",
                            "args": {
                                "host": host,
                                "port": port,
                                "database": db_name,
                                "username": username,
                                "password": password_val or ""
                            },
                            "risk_level": "LOW",
                            "requires_confirmation": False
                        },
                        {
                            "tool": "save_database_connection",
                            "label": f"Saving Connection Profile '{display_name}'",
                            "args": {
                                "name": display_name,
                                "host": host,
                                "port": port,
                                "database": db_name,
                                "username": username,
                                "password": password_val or "",
                                "ssl_mode": "prefer"
                            },
                            "risk_level": "HIGH",
                            "requires_confirmation": False
                        },
                        {
                            "tool": "scan_database_schema",
                            "label": "Discovering Database Schema & Tables",
                            "args": {"connection_id": 0},
                            "risk_level": "LOW",
                            "requires_confirmation": False
                        }
                    ]
                }

            # All required parameters present!
            return {
                "task_type": "ADD_CONNECTION",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": merged_slots,
                "explanation": f"Ready to verify and connect to MySQL database '{db_name}' on {host}:{port}.",
                "steps": [
                    {
                        "tool": "test_database_connection",
                        "label": f"Testing Connection to MySQL on {host}:{port}",
                        "args": {
                            "host": host,
                            "port": port,
                            "database": db_name,
                            "username": username,
                            "password": password_val or merged_slots.get("password", "")
                        },
                        "risk_level": "LOW",
                        "requires_confirmation": False
                    },
                    {
                        "tool": "save_database_connection",
                        "label": f"Saving Connection Profile '{display_name}'",
                        "args": {
                            "name": display_name,
                            "host": host,
                            "port": port,
                            "database": db_name,
                            "username": username,
                            "password": password_val or merged_slots.get("password", ""),
                            "ssl_mode": "prefer"
                        },
                        "risk_level": "HIGH",
                        "requires_confirmation": False
                    },
                    {
                        "tool": "scan_database_schema",
                        "label": "Discovering Database Schema & Tables",
                        "args": {"connection_id": 0},
                        "risk_level": "LOW",
                        "requires_confirmation": False
                    }
                ]
            }

        # 5. Automation Intents
        if any(k in lower for k in ["automation", "blog", "schedule", "publish daily", "article", "post daily", "post weekly"]):
            conn_id = merged_slots.get("connection_id")
            if not conn_id:
                conns = context.get("connections") or []
                conn_id = conns[0].get("id", 1) if conns else 1

            topic = "electric cars" if ("electric car" in lower or "car" in lower) else (merged_slots.get("topic") or "General Insights")
            cat_match = re.search(r"category\s+([A-Za-z0-9_-]+)", goal, re.IGNORECASE)
            cat = cat_match.group(1).strip() if cat_match else "Cars"

            return {
                "task_type": "CREATE_AUTOMATION",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": {**merged_slots, "category": cat, "topic": topic},
                "explanation": f"Creating automation for topic '{topic}' in category '{cat}'.",
                "steps": [
                    {
                        "tool": "create_automation_draft",
                        "label": f"Creating Automation for '{topic}'",
                        "args": {
                            "name": f"{topic.title()} Automation",
                            "connection_id": conn_id,
                            "target_table": "posts",
                            "topic_prompt": topic,
                            "category_name": cat,
                            "schedule_type": "DAILY",
                            "generation_time": "08:00",
                            "publication_time": "09:00",
                            "require_approval": True
                        },
                        "risk_level": "MEDIUM",
                        "requires_confirmation": True
                    }
                ]
            }

        # 6. Generic intent fallback
        return {
            "task_type": "GENERAL",
            "outcome": "SUPPORTED_AND_SPECIFIED",
            "extracted_slots": merged_slots,
            "explanation": "Processed request with available workspace capabilities.",
            "steps": []
        }

    def synthesize_agent_response(
        self,
        goal: str,
        executed_steps: List[Dict[str, Any]],
        final_status: str,
        domain_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """Deterministic response synthesizer for testing."""
        if final_status in ["SUCCEEDED", "COMMITTED"]:
            db_name = (domain_data or {}).get("database_name", (domain_data or {}).get("name", "database"))
            host = (domain_data or {}).get("host", "127.0.0.1")
            return f"I have successfully tested and saved your connection to '{db_name}' on host {host}, and verified the profile."
        elif final_status == "FAILED":
            return "I encountered an issue verifying the connection. Please check your credentials and try again."
        return f"Operation completed with status {final_status}."

