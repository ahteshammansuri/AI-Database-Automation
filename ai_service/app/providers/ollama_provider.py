import json
import re
import time
from typing import Dict, Any, List, Optional
import httpx
from ai_service.app.providers.base import BaseAIProvider
from ai_service.app.config import settings


class OllamaProvider(BaseAIProvider):
    """Primary local inference provider via Ollama."""

    def __init__(self, base_url: str = None, model: str = None):
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        requested_model = model.strip() if model and model != "default" else None
        self.model = requested_model or self._resolve_best_model()

    def _resolve_best_model(self) -> str:
        """Dynamically detect installed models, preferring lightweight models for fast CPU inference."""
        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    models = [m.get("name") for m in res.json().get("models", [])]
                    for preferred in ["llama3.2:1b", "llama3.2:3b", "llama3.2:latest", "llama3:latest", "llama3"]:
                        for m in models:
                            if m == preferred or m.startswith(f"{preferred}:"):
                                return m
                    if models:
                        return models[0]
        except Exception:
            pass
        return settings.OLLAMA_MODEL

    def test_connection(self) -> Dict[str, Any]:
        start = time.time()
        try:
            with httpx.Client(timeout=5.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name") for m in data.get("models", [])]

                    # Auto-resolve target model if 'default' or unconfigured and models exist
                    target_model = self.model
                    if (not target_model or target_model == "default") and models:
                        target_model = self._resolve_best_model()
                        self.model = target_model

                    if not models:
                        return {
                            "available": False,
                            "daemon_running": True,
                            "model_installed": False,
                            "latency_ms": latency_ms,
                            "models": [],
                            "message": "Ollama service is online, but no models are installed. Run 'ollama pull llama3.2:1b' to install a model."
                        }

                    # Check if requested model or a tag variation is installed
                    model_found = any(
                        target_model == m or
                        f"{target_model}:latest" == m or
                        m.startswith(f"{target_model}:") or
                        (target_model.endswith(":latest") and target_model.replace(":latest", "") == m)
                        for m in models
                    ) if target_model else True

                    if not model_found:
                        target_model = models[0]
                        self.model = target_model

                    return {
                        "available": True,
                        "daemon_running": True,
                        "model_installed": True,
                        "latency_ms": latency_ms,
                        "models": models,
                        "message": f"Connected to local Ollama. Active model '{target_model}' is ready."
                    }

                    return {
                        "available": True,
                        "daemon_running": True,
                        "model_installed": True,
                        "latency_ms": latency_ms,
                        "models": models,
                        "message": f"Connected to local Ollama. Model '{target_model}' is installed and ready."
                    }
                return {
                    "available": False,
                    "daemon_running": False,
                    "model_installed": False,
                    "latency_ms": latency_ms,
                    "models": [],
                    "message": f"Ollama returned HTTP status {res.status_code}"
                }
        except httpx.ConnectError:
            return {
                "available": False,
                "daemon_running": False,
                "model_installed": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Ollama is offline. Ensure 'ollama serve' is running at {self.base_url}"
            }
        except Exception as e:
            return {
                "available": False,
                "daemon_running": False,
                "model_installed": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Ollama connection check failed: {str(e)}"
            }

    def list_models(self) -> List[str]:
        conn = self.test_connection()
        return conn.get("models", [])

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
        schema_hints = []
        for f in required_fields:
            lf = f.lower()
            c = (schema_constraints or {}).get(f, {})
            max_len = c.get("max_length")
            enums = c.get("enum_values") or []

            if enums:
                schema_hints.append(f'"{f}": "one of: {enums}"')
            elif relation_catalog and f in relation_catalog and relation_catalog[f].get("values"):
                vals = relation_catalog[f]["values"][:8]
                schema_hints.append(f'"{f}": "reference name from: {vals}"')
            elif "title" in lf:
                len_note = f" (max {max_len} chars)" if max_len else ""
                schema_hints.append(f'"{f}": "Engaging, catchy title matching topic{len_note}"')
            elif lf == "slug":
                schema_hints.append(f'"{f}": "url-friendly-slug-matching-title"')
            elif lf in ["excerpt", "short_description", "summary"]:
                len_note = f" (max {max_len} chars)" if max_len else " (1-2 sentences)"
                schema_hints.append(f'"{f}": "{len_note}"')
            elif lf in ["content", "description", "body"]:
                schema_hints.append(f'"{f}": "Full comprehensive rich markdown article drawing from the retrieved knowledge"')
            elif "keyword" in lf or "tags" in lf:
                schema_hints.append(f'"{f}": "comma, separated, topic, keywords"')
            elif "banner" in lf:
                schema_hints.append(f'"{f}": "high-res Unsplash image URL related to the topic"')
            elif "meta_img" in lf or "thumbnail" in lf:
                schema_hints.append(f'"{f}": "Unsplash image URL related to the topic"')
            else:
                schema_hints.append(f'"{f}": "relevant dynamic value"')

        schema_json_format = "{\n  " + ",\n  ".join(schema_hints) + "\n}"

        full_system = (
            f"{system_prompt}\n"
            f"You are generating dynamic content for target table '{target_table}'.\n"
            f"You MUST generate a complete, valid JSON object matching EXACTLY these required fields:\n"
            f"{schema_json_format}\n"
            f"Ensure all content is dynamic, informative, and incorporates the topic and any retrieved knowledge context provided."
        )
        if rejection_feedback:
            full_system += f"\nIMPORTANT - Previous version was rejected with feedback: '{rejection_feedback}'. Address this feedback completely in your new generation."
        if recent_titles:
            recent_str = ", ".join([f"'{t}'" for t in recent_titles[:10]])
            full_system += f"\nAVOID DUPLICATION - Do NOT repeat or closely imitate these recently published titles: [{recent_str}]."

        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": full_system,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.7,
                "num_predict": 450,
                "keep_alive": "30m"
            }
        }

        with httpx.Client(timeout=300.0) as client:
            res = client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Ollama generation failed with status {res.status_code}: {res.text}")

            response_json = res.json()
            raw_response = response_json.get("response", "{}")

            cleaned = self._clean_json_output(raw_response)
            try:
                parsed = json.loads(cleaned)
            except Exception as json_err:
                raise ValueError(f"Model output did not parse into valid JSON: {str(json_err)}\nRaw output: {raw_response[:300]}")

            if not isinstance(parsed, dict):
                raise ValueError("Model output did not parse into a JSON object dictionary.")

            # Detect topic domain for intelligent defaults if any field is missing
            prompt_lower = prompt.lower()
            is_food = any(w in prompt_lower for w in ["food", "meat", "diet", "diate", "eat", "meal", "nutrition", "recipe", "health", "macro"])
            is_tech = any(w in prompt_lower for w in ["database", "sql", "mysql", "api", "code", "devops", "cloud", "system", "architecture"])

            default_banner = (
                "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1200&auto=format&fit=crop&q=80" if is_food
                else "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop&q=80" if is_tech
                else "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=1200&auto=format&fit=crop&q=80"
            )
            default_meta_img = (
                "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80" if is_food
                else "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80" if is_tech
                else "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80"
            )

            # Ensure all required fields exist and are populated
            for field in required_fields:
                lf = field.lower()
                val = parsed.get(field)
                if val is None or val == "":
                    if lf == "title":
                        parsed[field] = "Healthy Dietary Practices & Nutrition Insights" if is_food else f"Insights & Best Practices for {target_table.title()}"
                    elif lf == "slug":
                        title_src = parsed.get("title", "article")
                        clean = re.sub(r"[^\w\s-]", "", str(title_src).lower()).strip()
                        parsed[field] = re.sub(r"[-\s]+", "-", clean) + f"-{int(time.time()) % 1000}"
                    elif lf in ["excerpt", "short_description", "summary"]:
                        parsed[field] = f"An evidence-based overview of {parsed.get('title', 'this topic')}, highlighting actionable takeaways and core principles."
                    elif lf in ["content", "description", "body"]:
                        title_str = parsed.get('title', 'Article Overview')
                        parsed[field] = f"# {title_str}\n\n{parsed.get('short_description', parsed.get('excerpt', ''))}\n\n## Core Principles\nEssential insights tailored to {target_table}."
                    elif "banner" in lf:
                        parsed[field] = default_banner
                    elif "meta_img" in lf or "thumbnail" in lf:
                        parsed[field] = default_meta_img
                    elif lf in ["seo_title", "meta_title"]:
                        parsed[field] = str(parsed.get("title", ""))[:60]
                    elif lf in ["meta_description"]:
                        parsed[field] = str(parsed.get("short_description", parsed.get("excerpt", "")))[:160]
                    elif "keyword" in lf or "tags" in lf:
                        parsed[field] = "healthy food, nutrition, meal planning, wellness, healthy diet" if is_food else "database, automation, devops, mysql, technology"
                    elif lf == "status":
                        parsed[field] = "1"
                    elif lf.endswith("_id") or lf in ["category_id", "author_id", "user_id"]:
                        parsed[field] = 1

            # Schema constraint post-validation & coercion
            if schema_constraints:
                for field, val in list(parsed.items()):
                    if field in schema_constraints:
                        c = schema_constraints[field]
                        enums = c.get("enum_values") or []
                        max_len = c.get("max_length")
                        if enums and str(val) not in [str(e) for e in enums]:
                            parsed[field] = enums[0]
                        if max_len and isinstance(parsed[field], str) and len(parsed[field]) > max_len:
                            parsed[field] = parsed[field][:max_len]

            return parsed

    def plan_agent_turn(
        self,
        goal: str,
        context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        rag_chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Invokes local Ollama LLM to reason about the user turn, extract slots, and select tools.
        Dynamically handles greetings, RAG-grounded product queries, general chat, and autonomous actions.
        """
        lower_goal = goal.strip().lower()

        # 1. Prohibited destructive SQL check (Zero Tolerance Guardrail)
        if re.search(r"\b(drop|truncate|alter|delete\s+from|raw\s+sql|exec\s+raw)\b", lower_goal):
            return {
                "task_type": "POLICY_REJECTED",
                "outcome": "DISALLOWED_BY_POLICY",
                "extracted_slots": {},
                "explanation": "Destructive SQL operations (DROP, TRUNCATE, DELETE, ALTER, and arbitrary SQL execution) are strictly prohibited on customer target databases by platform security guardrails.",
                "steps": []
            }

        # 2. Status / List Connections intent check (takes precedence over add-connection keywords)
        is_status_query = bool(re.search(r"\b(status|health|check.*conn|conn.*status|list|show|view|existing)\b", lower_goal)) and not any(k in lower_goal for k in ["add ", "create ", "new ", "save "])
        existing_connections = context.get("connections", [])
        if is_status_query and any(k in lower_goal for k in ["connect", "database", "db", "status"]):
            conn_count = len(existing_connections)
            if conn_count == 0:
                explanation = "You don't have any database connections configured in your workspace yet. Let's set one up! I can open the connection setup form for you right now."
            else:
                conn_names = ", ".join([f"'{c.get('name', 'Database')}' ({c.get('host', '127.0.0.1')}:{c.get('database_name', '')})" for c in existing_connections])
                explanation = f"You have {conn_count} configured database connection(s): {conn_names}. All connection profiles are stored securely."

            return {
                "task_type": "LIST_CONNECTIONS",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": {},
                "explanation": explanation,
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

        # 3. Product / Project Inquiries ("What is this project about?", "How does automation work?", etc.) -> RAG + Ollama
        is_project_query = any(k in lower_goal for k in [
            "what is this project", "about this project", "project about", "what does this app do",
            "what is dataauto", "how does this work", "how do automations work", "what is this platform",
            "explain the platform", "what databases", "tell me about this project", "what can this project do"
        ])
        if is_project_query:
            rag_context_text = ""
            if rag_chunks:
                rag_context_text = "\n".join([f"- {c.get('text', '')[:250]}" for c in rag_chunks])
            else:
                rag_context_text = (
                    "DataAuto is an AI-Powered Multi-User Database Automation Platform. "
                    "It connects to MySQL databases, inspects schema, generates and schedules automated content/data publishing "
                    "with email approvals, and features Orbit, an autonomous AI companion that operates the portal on the user's behalf."
                )

            # Query Ollama dynamically with RAG context
            try:
                dynamic_resp = self._call_ollama_chat(
                    prompt=f"Context from documentation:\n{rag_context_text}\n\nUser Question: \"{goal}\"\nAnswer the question concisely in 2-3 friendly sentences as Orbit:",
                    system="You are Orbit, the autonomous AI database automation assistant. Explain the platform accurately and warmly based on the documentation context. Speak in 2-3 sentences max."
                )
            except Exception:
                dynamic_resp = (
                    "This project is DataAuto, an AI-Powered Database Automation Platform! "
                    "It lets you connect your MySQL databases, discover tables and schema, and run scheduled AI content workflows with human approvals. "
                    "I'm Orbit, your autonomous AI assistant here to help navigate and run everything for you."
                )

            citations = [{"chunk_id": c.get("chunk_id", "doc"), "text": c.get("text", "")[:120]} for c in (rag_chunks or [])]
            return {
                "task_type": "PRODUCT_EXPLANATION",
                "outcome": "CONVERSATIONAL_RESPONSE",
                "extracted_slots": {},
                "explanation": dynamic_resp,
                "rag_citations": citations,
                "steps": []
            }

        # 4. Conversational Greetings & Identity ("Hello", "Hey", "Who are you?", "How are you?") -> Dynamic Ollama
        is_greeting_or_identity = bool(re.search(r"^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy|greetings|how\s+are\s+you|who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do)\b", lower_goal))
        if is_greeting_or_identity:
            try:
                dynamic_resp = self._call_ollama_chat(
                    prompt=f"User says: \"{goal}\". Greet them or answer who you are and what you do, and offer to help with database connections or automations in 1-2 friendly sentences.",
                    system="You are Orbit, a friendly autonomous AI mascot and database assistant. Speak warmly, naturally, and concisely in 1-2 sentences. Never output JSON."
                )
            except Exception:
                dynamic_resp = "Hello! I'm Orbit, your autonomous AI database assistant. I can help you connect MySQL databases, inspect schemas, create automated workflows, and navigate the platform. What would you like to work on?"

            return {
                "task_type": "GREETING",
                "outcome": "CONVERSATIONAL_RESPONSE",
                "extracted_slots": {},
                "explanation": dynamic_resp,
                "steps": []
            }

        # 5. Extract connection slots from utterance
        accumulated = context.get("accumulated_slots", {})
        pre_extracted: Dict[str, Any] = {}
        host_m = re.search(r"\bhost\s*(?:is|=|:)?\s*([a-zA-Z0-9\.\-_]+)", lower_goal)
        if host_m:
            pre_extracted["host"] = host_m.group(1).strip()
        elif "127.0.0.1" in lower_goal or "localhost" in lower_goal:
            pre_extracted["host"] = "127.0.0.1"

        port_m = re.search(r"\bport\s*(?:is|=|:)?\s*(\d+)", lower_goal)
        if port_m:
            pre_extracted["port"] = int(port_m.group(1))

        db_candidates = re.findall(r"(?:database|db)(?:\s+name)?\s*(?:is|=|:|\s+named|\s+called)?\s*['\"]?([a-zA-Z0-9_\-]+)['\"]?", lower_goal)
        for cand in db_candidates:
            if cand not in ["on", "with", "for", "in", "to", "at", "and", "connection", "profile", "server", "named", "called", "is"]:
                pre_extracted["database"] = cand
                break

        user_candidates = re.findall(r"(?:username|user)\s*(?:is|=|:|\s+named|\s+called)?\s*['\"]?([a-zA-Z0-9_\-]+)['\"]?", lower_goal)
        for cand in user_candidates:
            if cand not in ["on", "with", "for", "in", "to", "at", "and", "named", "called", "is"]:
                pre_extracted["username"] = cand
                break

        name_m = re.search(r"(?:connection\s+)?name\s*(?:is|=|:)?\s*['\"]([^'\"]+)['\"]", goal, re.IGNORECASE)
        if name_m:
            pre_extracted["name"] = name_m.group(1).strip()

        combined_slots = {**accumulated, **pre_extracted}

        # 6. Actionable Database Connection Intent ("I want to connect this database", "Connect to MySQL", etc.)
        is_connect_action = any(k in lower_goal for k in ["connect", "add connection", "new database", "link database", "hook up mysql", "connect this database"])
        if is_connect_action:
            host_val = combined_slots.get("host", "127.0.0.1")
            port_val = combined_slots.get("port", 3306)
            db_val = combined_slots.get("database", "")
            user_val = combined_slots.get("username", "root")
            password_val = combined_slots.get("password", "")
            name_val = combined_slots.get("name", db_val or "MySQL Target")

            missing = []
            if not db_val:
                missing.append("database")
            if not password_val and not combined_slots.get("password_hash"):
                missing.append("password")
            if not user_val:
                missing.append("username")

            steps = [
                {
                    "tool": "test_database_connection",
                    "label": f"Testing Connection to MySQL on {host_val}:{port_val}",
                    "args": {
                        "host": host_val,
                        "port": port_val,
                        "database": db_val,
                        "username": user_val,
                        "password": password_val or ""
                    },
                    "risk_level": "LOW",
                    "requires_confirmation": False
                },
                {
                    "tool": "save_database_connection",
                    "label": f"Saving Connection Profile '{name_val}'",
                    "args": {
                        "name": name_val,
                        "host": host_val,
                        "port": port_val,
                        "database": db_val,
                        "username": user_val,
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

            if missing:
                first_missing = missing[0]
                if first_missing == "password":
                    question = f"What is the credentials password for database user '{user_val or 'root'}'?"
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
                    "extracted_slots": combined_slots,
                    "explanation": f"Missing required connection parameter: {first_missing}.",
                    "steps": steps
                }

            return {
                "task_type": "ADD_CONNECTION",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": combined_slots,
                "explanation": f"Ready to verify and connect to MySQL database '{db_val}' on {host_val}:{port_val}.",
                "steps": steps
            }

        # 7. Schema Scan Intent
        if any(k in lower_goal for k in ["scan", "schema", "tables", "columns", "inspect schema"]):
            conn_id = combined_slots.get("connection_id") or (existing_connections[0]["id"] if existing_connections else 1)
            return {
                "task_type": "SCAN_SCHEMA",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": combined_slots,
                "explanation": f"Navigating to Schema Explorer to inspect tables and structure for connection #{conn_id}.",
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

        # 8. Automation & Content Scheduling Intents
        if any(k in lower_goal for k in ["automation", "automat", "blog", "schedule", "publish daily", "article", "post daily", "post weekly"]):
            conn_id = combined_slots.get("connection_id")
            if not conn_id:
                conn_id = existing_connections[0]["id"] if existing_connections else 1

            topic = "electric cars" if ("electric car" in lower_goal or "car" in lower_goal) else (combined_slots.get("topic") or "General Insights")
            cat_match = re.search(r"category\s+([A-Za-z0-9_-]+)", goal, re.IGNORECASE)
            cat = cat_match.group(1).strip() if cat_match else (combined_slots.get("category") or "Cars")

            page_ctx = combined_slots.get("page_context") or {}
            target_table = "posts"
            if isinstance(page_ctx, dict) and page_ctx.get("activeEntity", {}).get("name"):
                target_table = page_ctx["activeEntity"]["name"]
            elif isinstance(page_ctx, dict) and page_ctx.get("activeEntity", {}).get("id"):
                target_table = str(page_ctx["activeEntity"]["id"])

            return {
                "task_type": "CREATE_AUTOMATION",
                "outcome": "SUPPORTED_AND_SPECIFIED",
                "extracted_slots": {**combined_slots, "category": cat, "topic": topic, "target_table": target_table},
                "explanation": f"Creating automation for topic '{topic}' in category '{cat}' targeting table '{target_table}'.",
                "steps": [
                    {
                        "tool": "create_automation_draft",
                        "label": f"Creating Automation for '{topic}'",
                        "args": {
                            "name": f"{topic.title()} Automation",
                            "connection_id": conn_id,
                            "target_table": target_table,
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

        # 9. General Open-Ended Chat via Ollama (For anything else: questions, chit-chat, etc.)
        try:
            dynamic_resp = self._call_ollama_chat(
                prompt=f"User says: \"{goal}\". Reply helpfully, warmly, and concisely as Orbit (1-3 sentences).",
                system="You are Orbit, an autonomous AI companion mascot for the database automation platform. Answer helpfully and naturally. Speak in 1-3 sentences max. Never output raw code or JSON."
            )
            return {
                "task_type": "GENERAL_CHAT",
                "outcome": "CONVERSATIONAL_RESPONSE",
                "extracted_slots": combined_slots,
                "explanation": dynamic_resp,
                "steps": []
            }
        except Exception:
            pass

        # Fallback to structured tool planning if requested
        return {
            "task_type": "GENERAL_QUERY",
            "outcome": "SUPPORTED_AND_SPECIFIED",
            "extracted_slots": combined_slots,
            "explanation": "Checking workspace status and active workflows.",
            "steps": [
                {
                    "tool": "get_dashboard_summary",
                    "label": "Retrieving Platform State",
                    "args": {},
                    "risk_level": "LOW",
                    "requires_confirmation": False
                }
            ]
        }

    def _call_ollama_chat(self, prompt: str, system: str, max_tokens: int = 70) -> str:
        """
        Fast direct conversational inference with Ollama.
        Keeps system and prompt compact for fast CPU responses.
        """
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": {
                "temperature": 0.35,
                "num_predict": max_tokens,
                "num_thread": 4,
                "keep_alive": "30m"
            }
        }
        with httpx.Client(timeout=90.0) as client:
            res = client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code == 200:
                text = res.json().get("response", "").strip()
                if text:
                    # Strip any accidental wrapping quotes
                    if text.startswith('"') and text.endswith('"'):
                        text = text[1:-1].strip()
                    return text
            raise RuntimeError(f"Ollama returned HTTP {res.status_code}")

    def synthesize_agent_response(
        self,
        goal: str,
        executed_steps: List[Dict[str, Any]],
        final_status: str,
        domain_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Synthesizes a truthful, concise spoken summary based on verified tool executions.
        """
        system_prompt = (
            "You are Orbit, the friendly voice-first AI assistant for the database automation portal.\n"
            "Generate a concise, natural, truthful spoken response (1-2 sentences maximum) summarizing what was actually accomplished.\n"
            "Rules:\n"
            "- Speak naturally as a helpful partner.\n"
            "- Be truthful: only claim success for steps that actually succeeded.\n"
            "- Do not recite technical JSON or IDs.\n"
            "- If a database was connected, mention the database name and that connectivity was verified.\n"
            "- If an error occurred, explain the real problem clearly and concisely."
        )

        steps_summary = []
        for s in executed_steps:
            st = s.get("step", s.get("tool", "action"))
            res = s.get("result", {})
            succ = res.get("success", False)
            summ = res.get("safe_summary", res.get("error", "Executed"))
            steps_summary.append(f"- {st}: {'Succeeded' if succ else 'Failed'} ({summ})")

        prompt = (
            f"User Goal: \"{goal}\"\n"
            f"Final Status: {final_status}\n"
            f"Executed Steps & Outcomes:\n" + "\n".join(steps_summary) + "\n"
            f"Domain Data: {json.dumps(domain_data or {})}"
        )

        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system_prompt,
            "stream": False,
            "options": {
                "temperature": 0.6,
                "num_predict": 60,
                "keep_alive": "30m"
            }
        }

        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.post(f"{self.base_url}/api/generate", json=payload)
                if res.status_code == 200:
                    text = res.json().get("response", "").strip()
                    if text:
                        return text
        except Exception:
            pass

        if final_status in ["SUCCEEDED", "COMMITTED"]:
            return f"I have successfully completed your request and verified the results in your portal."
        elif final_status == "FAILED":
            return f"I encountered an issue executing your request. Please check the activity timeline for details."
        return f"Operation processed with status {final_status}."

    def evaluate_correction(
        self,
        correction_text: str,
        active_task_status: str,
        current_step: Optional[str] = None,
        active_plan: Optional[List[Dict[str, Any]]] = None,
        target_resource_type: Optional[str] = None,
        target_resource_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Invokes local Ollama model to evaluate mid-turn user interruptions or parameter corrections.
        """
        system_prompt = (
            "You are an expert AI agent state analyzer. A user is intervening during an autonomous database automation task.\n"
            "Analyze the user's correction utterance and determine the exact required action:\n"
            "- 'STOP': User explicitly wants to stop, cancel, halt, or abort execution.\n"
            "- 'PAUSE': User asks to wait, hold on, or pause.\n"
            "- 'RESUME': User asks to continue or proceed.\n"
            "- 'CHANGE_PARAMETER': User wants to change a specific parameter (e.g. category, topic, frequency, host, port).\n"
            "- 'REPLAN': User wants to redo or significantly change the workflow.\n\n"
            "Respond ONLY with a JSON object:\n"
            "{\n"
            '  "action": "STOP" | "PAUSE" | "RESUME" | "CHANGE_PARAMETER" | "REPLAN",\n'
            '  "revised_parameter": "category_name" | "topic_prompt" | "schedule_type" | null,\n'
            '  "new_value": "parsed_new_value_or_null",\n'
            '  "compensating_needed": true | false,\n'
            '  "explanation": "brief natural explanation"\n'
            "}"
        )

        user_prompt = (
            f"Active Task Status: {active_task_status}\n"
            f"Current Executing Step: {current_step or 'None'}\n"
            f"User Correction Utterance: \"{correction_text}\""
        )

        payload = {
            "model": self.model,
            "prompt": f"{system_prompt}\n\nTask:\n{user_prompt}",
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
                "top_p": 0.9,
            }
        }

        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.post(f"{self.base_url}/api/generate", json=payload)
                if res.status_code == 200:
                    raw_text = res.json().get("response", "").strip()
                    cleaned = self._clean_json_output(raw_text)
                    data = json.loads(cleaned)
                    if isinstance(data, dict) and "action" in data:
                        return data
        except Exception:
            pass

        raise NotImplementedError("Ollama model unavailable for evaluate_correction")


    @staticmethod
    def _clean_json_output(raw_text: str) -> str:
        """Strip markdown code blocks or wrapper text."""
        cleaned = raw_text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
            cleaned = cleaned[start_idx:end_idx + 1]
        return cleaned.strip()

