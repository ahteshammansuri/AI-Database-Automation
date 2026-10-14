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
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        schema_hints = []
        for f in required_fields:
            lf = f.lower()
            if "title" in lf:
                schema_hints.append(f'"{f}": "Engaging, catchy title matching topic"')
            elif lf == "slug":
                schema_hints.append(f'"{f}": "url-friendly-slug-matching-title"')
            elif lf in ["excerpt", "short_description", "summary"]:
                schema_hints.append(f'"{f}": "1-2 sentence engaging summary"')
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
        Enforces JSON output adhering to AgentPlanResponse schema.
        """
        tools_summary = []
        for t in available_tools:
            name = t.get("name")
            desc = t.get("description", "")
            params = t.get("parameters", {}).get("properties", {})
            param_str = ", ".join([f"{k} ({v.get('type', 'any')})" for k, v in params.items()])
            tools_summary.append(f"- {name}: {desc} (Params: {param_str})")
        tools_text = "\n".join(tools_summary) if tools_summary else (
            "- test_database_connection: Test connection parameters (Params: host, port, database, username, password)\n"
            "- save_database_connection: Save validated MySQL connection profile (Params: host, port, database, username, password, name)\n"
            "- scan_database_schema: Discover database tables and schema (Params: connection_id)\n"
            "- list_database_connections: List all connected databases\n"
            "- create_automation_draft: Create an automation draft (Params: name, connection_id, target_table, topic_prompt, schedule_type)\n"
            "- run_automation_now: Trigger immediate execution of an automation (Params: automation_id)\n"
            "- manual_publish_content: Directly publish manual content (Params: connection_id, target_table, title, content)"
        )

        rag_texts = []
        for c in rag_chunks:
            rag_texts.append(f"[{c.get('chunk_id', 'doc')}]: {c.get('text', '')[:300]}")
        rag_str = "\n".join(rag_texts) if rag_texts else "Standard database automation platform knowledge."

        accumulated = context.get("accumulated_slots", {})

        system_prompt = (
            "You are an intelligent, capability-aware AI agent planner for an AI-Powered Database Automation Portal.\n"
            "Analyze the user's natural language goal, evaluate live context, extract non-secret parameters, and determine the next action.\n\n"
            "RULES:\n"
            "1. DISALLOWED_BY_POLICY: If user requests destructive SQL (DELETE, DROP, TRUNCATE, ALTER, arbitrary raw SQL console), return outcome 'DISALLOWED_BY_POLICY'.\n"
            "2. UNSUPPORTED: If user requests an action completely outside the product (e.g. flight booking, order food, crypto trading), return outcome 'UNSUPPORTED'.\n"
            "3. MISSING_INFORMATION: If required details are missing, return outcome 'MISSING_INFORMATION', list missing field names in 'missing_fields', and ask ONE concise, friendly question in 'question'.\n"
            "   - Database connection required fields: host, port (default 3306), database, username, password. (Password is sensitive; if missing, ask for password with secure_input_type: 'database_credentials').\n"
            "   - DO NOT re-ask for details already provided in the user goal or accumulated_slots!\n"
            "4. SUPPORTED_AND_SPECIFIED: If all required details are present or defaults apply, return outcome 'SUPPORTED_AND_SPECIFIED' with ordered 'steps'.\n"
            "   - For a database connection, steps should be: 1) test_database_connection, 2) save_database_connection, 3) scan_database_schema.\n"
            "5. OUTPUT FORMAT: Respond ONLY with a valid JSON object matching this schema:\n"
            "{\n"
            '  "task_type": "ADD_CONNECTION" | "SCAN_SCHEMA" | "CREATE_AUTOMATION" | "LIST_CONNECTIONS" | "UNSUPPORTED_TASK" | "POLICY_REJECTED",\n'
            '  "outcome": "SUPPORTED_AND_SPECIFIED" | "MISSING_INFORMATION" | "AMBIGUOUS" | "CURRENTLY_UNAVAILABLE" | "UNSUPPORTED" | "DISALLOWED_BY_POLICY",\n'
            '  "extracted_slots": {"host": "...", "port": 3306, "database": "...", "username": "...", "name": "..."},\n'
            '  "missing_fields": ["password"],\n'
            '  "question": "What is the password for your database user?",\n'
            '  "secure_input_type": "database_credentials",\n'
            '  "explanation": "Brief explanation of plan",\n'
            '  "steps": [\n'
            '    {"tool": "test_database_connection", "label": "Testing Connection", "args": {...}, "risk_level": "LOW", "requires_confirmation": false}\n'
            '  ]\n'
            "}"
        )

        user_content = (
            f"User Goal: \"{goal}\"\n\n"
            f"Accumulated Slots Already Known: {json.dumps(accumulated)}\n\n"
            f"Retrieved Product Knowledge (RAG):\n{rag_str}\n\n"
            f"Available Registered Tools:\n{tools_text}\n\n"
            f"Existing Connections Count: {len(context.get('connections', []))}\n"
            f"Existing Automations Count: {len(context.get('automations', []))}"
        )

        # Pre-extract slots with regex as a safety net
        pre_extracted: Dict[str, Any] = {}
        lower_goal = goal.lower()
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

        payload = {
            "model": self.model,
            "prompt": user_content,
            "system": system_prompt,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 100,
                "num_thread": 4,
                "keep_alive": "30m"
            }
        }

        with httpx.Client(timeout=6.0) as client:
            res = client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Ollama agent planning failed with status {res.status_code}: {res.text}")

            raw = res.json().get("response", "{}")
            cleaned = self._clean_json_output(raw)
            try:
                parsed = json.loads(cleaned)
            except Exception as e:
                raise ValueError(f"Ollama plan output did not parse as JSON: {e}\nRaw: {raw[:300]}")

            # Merge pre-extracted slots with model extracted slots
            model_slots = parsed.get("extracted_slots", {})
            parsed["extracted_slots"] = {**combined_slots, **model_slots}
            return parsed

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

        # Fallback to truthful template if model call times out
        if final_status in ["SUCCEEDED", "COMMITTED"]:
            return f"I have successfully completed your request and verified the results in your portal."
        elif final_status == "FAILED":
            return f"I encountered an issue executing your request. Please check the activity timeline for details."
        return f"Operation processed with status {final_status}."

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

