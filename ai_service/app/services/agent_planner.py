import re
from typing import Dict, Any, List, Optional
from ai_service.app.schemas.agent import (
    AgentPlanRequest,
    AgentPlanResponse,
    AgentPlanStep,
    EvaluateCorrectionRequest,
    EvaluateCorrectionResponse,
    SynthesizeResponseRequest,
    SynthesizeResponseResponse,
)
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.rag.service import rag_service


class AgentPlanner:
    """
    Open-Ended, Capability-Aware Semantic Planner for the AI Agent.
    Resolves natural language requests dynamically across all portal capabilities:
    1. SUPPORTED_AND_SPECIFIED: Generates multi-step plan of registered tools.
    2. MISSING_INFORMATION: Conversationally asks for missing required parameters.
    3. AMBIGUOUS: Asks focused clarification before mutation.
    4. CURRENTLY_UNAVAILABLE: Explains blocker and offers recovery path.
    5. UNSUPPORTED: Honestly states application boundaries.
    6. DISALLOWED_BY_POLICY: Explains safety guardrail and refuses operation.
    """

    @classmethod
    def plan(cls, req: AgentPlanRequest) -> AgentPlanResponse:
        goal = req.goal_prompt.strip()

        # 1. RAG retrieval of product context
        rag_chunks = []
        try:
            rag_chunks = rag_service.query_product_context(goal, top_k=3)
        except Exception:
            rag_chunks = []

        # 2. Invoke configured provider (Ollama / Cloud / Mock)
        provider_name = (req.provider or "ollama").lower()
        provider = AIProviderFactory.get_provider(provider_name, req.model, req.api_key)

        context = {
            "has_connections": req.has_connections,
            "connections": req.connections,
            "tables": req.tables,
            "automations": req.automations,
            "executions": req.executions,
            "conversation_history": req.conversation_history,
            "accumulated_slots": req.accumulated_slots,
            "active_task": req.active_task,
        }

        try:
            raw_decision = provider.plan_agent_turn(
                goal=goal,
                context=context,
                available_tools=req.available_tools,
                rag_chunks=rag_chunks
            )

            steps = []
            for s in raw_decision.get("steps", []):
                steps.append(AgentPlanStep(
                    step_id=s.get("step_id"),
                    tool=s.get("tool"),
                    label=s.get("label", s.get("tool")),
                    args=s.get("args", {}),
                    dependencies=s.get("dependencies", []),
                    risk_level=s.get("risk_level", "LOW"),
                    requires_confirmation=s.get("requires_confirmation", False)
                ))

            citations = [{"chunk_id": c.get("chunk_id", "doc"), "text": c.get("text", "")[:120]} for c in rag_chunks]

            return AgentPlanResponse(
                success=True,
                task_type=raw_decision.get("task_type", "GENERAL"),
                outcome=raw_decision.get("outcome", "SUPPORTED_AND_SPECIFIED"),
                requires_input=raw_decision.get("requires_input", False) or bool(raw_decision.get("missing_fields")),
                secure_input_type=raw_decision.get("secure_input_type"),
                question=raw_decision.get("question"),
                steps=steps,
                extracted_slots=raw_decision.get("extracted_slots", {}),
                missing_fields=raw_decision.get("missing_fields", []),
                explanation=raw_decision.get("explanation", ""),
                suggested_recovery=raw_decision.get("suggested_recovery"),
                rag_citations=citations,
                provider_used=provider_name,
                model_used=getattr(provider, "model", getattr(provider, "model_name", "unknown"))
            )
        except Exception as e:
            return cls._deterministic_fallback_plan(req, rag_chunks, str(e))

    @classmethod
    def synthesize_response(cls, req: SynthesizeResponseRequest) -> SynthesizeResponseResponse:
        provider_name = (req.provider or "ollama").lower()
        provider = AIProviderFactory.get_provider(provider_name, req.model)
        goal = req.goal_prompt or req.user_goal or "Complete request"
        final_status = req.final_status or req.result_status or "SUCCEEDED"
        domain_data = req.domain_data or req.result_data or {}
        executed_steps = req.executed_steps
        if not executed_steps and req.action_summary:
            executed_steps = [{"step": "action", "result": {"success": final_status in ["SUCCEEDED", "COMMITTED"], "safe_summary": req.action_summary}}]

        try:
            spoken = provider.synthesize_agent_response(
                goal=goal,
                executed_steps=executed_steps,
                final_status=final_status,
                domain_data=domain_data
            )
        except Exception:
            if final_status in ["SUCCEEDED", "COMMITTED"]:
                spoken = "I have successfully verified and executed your database operation."
            else:
                spoken = f"Your request finished with status {final_status}."

        return SynthesizeResponseResponse(
            spoken_text=spoken,
            safe_summary=spoken
        )

    @classmethod
    def _deterministic_fallback_plan(cls, req: AgentPlanRequest, rag_chunks: List[Dict[str, Any]], error_msg: str) -> AgentPlanResponse:
        """
        Robust fallback planner that preserves slot extraction, policy checks, and RAG citations.
        """
        from ai_service.app.providers.mock_provider import MockAIProvider
        mock_p = MockAIProvider(model_name="deterministic-fallback")
        context = {
            "has_connections": req.has_connections,
            "connections": req.connections,
            "tables": req.tables,
            "automations": req.automations,
            "executions": req.executions,
            "conversation_history": req.conversation_history,
            "accumulated_slots": req.accumulated_slots,
            "active_task": req.active_task,
        }
        raw = mock_p.plan_agent_turn(req.goal_prompt, context, req.available_tools, rag_chunks)

        steps = []
        for s in raw.get("steps", []):
            steps.append(AgentPlanStep(
                step_id=s.get("step_id"),
                tool=s.get("tool"),
                label=s.get("label", s.get("tool")),
                args=s.get("args", {}),
                dependencies=s.get("dependencies", []),
                risk_level=s.get("risk_level", "LOW"),
                requires_confirmation=s.get("requires_confirmation", False)
            ))

        citations = [{"chunk_id": c.get("chunk_id", "doc"), "text": c.get("text", "")[:120]} for c in rag_chunks]

        return AgentPlanResponse(
            success=True,
            task_type=raw.get("task_type", "GENERAL"),
            outcome=raw.get("outcome", "SUPPORTED_AND_SPECIFIED"),
            requires_input=raw.get("requires_input", False) or bool(raw.get("missing_fields")),
            secure_input_type=raw.get("secure_input_type"),
            question=raw.get("question"),
            steps=steps,
            extracted_slots=raw.get("extracted_slots", {}),
            missing_fields=raw.get("missing_fields", []),
            explanation=raw.get("explanation", error_msg),
            suggested_recovery=raw.get("suggested_recovery"),
            rag_citations=citations,
            provider_used="fallback",
            model_used="deterministic-fallback"
        )

    # -------------------------------------------------------------------------
    # Correction & Interruption Evaluator
    # -------------------------------------------------------------------------
    @classmethod
    def evaluate_correction(cls, req: EvaluateCorrectionRequest) -> EvaluateCorrectionResponse:
        text = req.correction_text.strip()
        lower = text.lower()

        # 1. Parameter correction (e.g. "Stop, don't use Cars. Use Reviews category instead")
        cleaned_text = re.sub(r"\b(?:don't|do not|stop)\s+(?:use|using)\s+[A-Za-z0-9_-]+[,\.]?\s*", "", text, flags=re.IGNORECASE)
        cat_match = re.search(r"(?:use (?:category )?|make it (?:category )?|change (?:category )?to |set category to |category\s+)(['\"]?[A-Za-z0-9\s_-]+?['\"]?)(?:\s+category|\s+instead|\.|$)", cleaned_text, re.IGNORECASE)
        if "review" in lower or cat_match or ("category" in lower and any(w in lower for w in ["instead", "use", "to", "make"])):
            if "review" in lower:
                new_cat = "Reviews"
            elif cat_match:
                raw_val = cat_match.group(1).strip().strip("'\"")
                raw_val = re.sub(r"^(?:category\s+|the\s+)", "", raw_val, flags=re.IGNORECASE).strip()
                raw_val = re.sub(r"(?:\s+category)$", "", raw_val, flags=re.IGNORECASE).strip()
                new_cat = " ".join(w.capitalize() for w in raw_val.split()) if raw_val else "General"
            else:
                new_cat = "General"

            is_committed = req.active_task_status in ["SUCCEEDED", "COMMITTED"]
            return EvaluateCorrectionResponse(
                action="CHANGE_PARAMETER",
                revised_parameter="category_name",
                new_value=new_cat,
                compensating_needed=is_committed,
                explanation=f"User changed category to '{new_cat}'." + (" Requires compensating update to committed record." if is_committed else "")
            )

        # 2. Pure Stop / Cancel command
        if any(lower.startswith(w) for w in ["stop", "cancel", "halt", "abort", "terminate"]) or "stop that" in lower:
            return EvaluateCorrectionResponse(
                action="STOP",
                explanation="Immediate cooperative stop requested by user."
            )

        # 3. Pause command
        if any(lower.startswith(w) for w in ["pause", "hold on", "wait a minute", "freeze"]) or "pause task" in lower:
            return EvaluateCorrectionResponse(
                action="PAUSE",
                explanation="Pause task at current safe boundary."
            )

        # 4. Resume command
        if any(lower.startswith(w) for w in ["resume", "continue", "unpause", "proceed"]):
            return EvaluateCorrectionResponse(
                action="RESUME",
                explanation="Resuming task execution."
            )

        # Topic revision
        topic_match = re.search(r"(?:topic to|change topic to|write about|make it about)\s+['\"]?([^'\"\.\n]+)['\"]?", text, re.IGNORECASE)
        if topic_match:
            new_topic = topic_match.group(1).strip()
            is_committed = req.active_task_status in ["SUCCEEDED", "COMMITTED"]
            return EvaluateCorrectionResponse(
                action="CHANGE_PARAMETER",
                revised_parameter="topic_prompt",
                new_value=new_topic,
                compensating_needed=is_committed,
                explanation=f"User updated topic to '{new_topic}'."
            )

        # Schedule revision
        if any(w in lower for w in ["weekly", "daily", "one-time", "once a week"]):
            freq = "WEEKLY" if "weekly" in lower or "once a week" in lower else ("DAILY" if "daily" in lower else "ONE_TIME")
            return EvaluateCorrectionResponse(
                action="CHANGE_PARAMETER",
                revised_parameter="schedule_type",
                new_value=freq,
                compensating_needed=req.active_task_status in ["SUCCEEDED", "COMMITTED"],
                explanation=f"User updated schedule frequency to '{freq}'."
            )

        # Generic plan instruction update
        return EvaluateCorrectionResponse(
            action="CHANGE_PARAMETER",
            revised_parameter="goal",
            new_value=text,
            compensating_needed=False,
            explanation=f"General instruction revision: \"{text}\""
        )

    # -------------------------------------------------------------------------
    # Parameter Extraction Helpers
    # -------------------------------------------------------------------------
    @classmethod
    def _extract_resource_id(cls, text: str, resource_name: str) -> Optional[int]:
        patterns = [
            rf"\b{resource_name}\s*#?\s*(\d+)\b",
            rf"\b(?:id|#)\s*(\d+)\b",
        ]
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                try:
                    return int(m.group(1))
                except ValueError:
                    pass
        return None

    @classmethod
    def _extract_table_name(cls, text: str, tables: List[Dict[str, Any]]) -> Optional[str]:
        for t in tables:
            name = t.get("name", "")
            if name and re.search(rf"\b{re.escape(name)}\b", text, re.IGNORECASE):
                return name
        m = re.search(r"\btable\s+['\"]?([a-zA-Z0-9_]+)['\"]?", text, re.IGNORECASE)
        if m:
            return m.group(1)
        return None

    @classmethod
    def _extract_topic(cls, text: str) -> str:
        # Check explicit patterns: "about <topic>", "on <topic>", "focusing on <topic>"
        m = re.search(r"\b(?:about|on|covering|regarding|topic(?: of)?)\s+['\"]?([^,\.\n\(\)]+?)['\"]?(?:\s+in\s+the|\s+category|\s+every|\s+at|\.|$)", text, re.IGNORECASE)
        if m:
            raw = m.group(1).strip()
            # Clean common filler
            raw = re.sub(r"^(?:the|a|an)\s+", "", raw, flags=re.IGNORECASE).strip()
            if len(raw) > 2 and raw.lower() not in ["it", "them", "cars", "ai", "content"]:
                return " ".join(w.capitalize() for w in raw.split())

        # Fallback keyword extraction
        lower = text.lower()
        if "car" in lower:
            return "Electric Cars & Sustainable Mobility"
        elif "ai" in lower or "tech" in lower or "machine learning" in lower:
            return "Modern Artificial Intelligence & Cloud Engineering"
        elif "gardening" in lower or "garden" in lower:
            return "Organic Gardening & Soil Care"
        elif "recipe" in lower or "food" in lower or "cooking" in lower:
            return "Nutritional Recipes & Culinary Wellness"
        elif "finance" in lower or "money" in lower or "invest" in lower:
            return "Personal Finance & Market Insights"

        # Default meaningful extraction from user's words
        cleaned = re.sub(r"(?:create|add|make|set up|new|automation|daily|weekly|blog|article|post|publish)\b", "", text, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return " ".join(w.capitalize() for w in cleaned.split()[:5]) if cleaned else "Industry Insights & Best Practices"

    @classmethod
    def _extract_category(cls, text: str, topic: str) -> str:
        # Check explicit category in text: "in the <Category> category"
        m = re.search(r"\b(?:in\s+the|in|category)\s+['\"]?([A-Za-z0-9\s_-]+?)['\"]?(?:\s+category|\s+every|\s+at|\.|$)", text, re.IGNORECASE)
        if m:
            cat = m.group(1).strip()
            if cat.lower() not in ["the", "a", "an", "daily", "weekly"]:
                return " ".join(w.capitalize() for w in cat.split())

        lower = text.lower() + " " + topic.lower()
        if "review" in lower:
            return "Reviews"
        if "car" in lower or "auto" in lower:
            return "Cars"
        if "ai" in lower or "tech" in lower:
            return "Technology"
        if "garden" in lower:
            return "Gardening"
        if "food" in lower or "cook" in lower or "recipe" in lower:
            return "Cooking"
        if "finance" in lower:
            return "Finance"
        return "General"

    @classmethod
    def _extract_schedule_type(cls, text: str) -> str:
        lower = text.lower()
        if "weekly" in lower or "once a week" in lower:
            return "WEEKLY"
        if "one-time" in lower or "single" in lower or "once" in lower:
            return "ONE_TIME"
        return "DAILY"

    @classmethod
    def _extract_schedule_times(cls, text: str) -> (str, str):
        times_found = re.findall(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text, re.IGNORECASE)
        parsed = []
        for h_str, m_str, ampm in times_found:
            try:
                h = int(h_str)
                m = int(m_str) if m_str else 0
                if ampm:
                    if ampm.lower() == "pm" and h < 12:
                        h += 12
                    elif ampm.lower() == "am" and h == 12:
                        h = 0
                parsed.append(f"{h:02d}:{m:02d}")
            except Exception:
                pass

        if len(parsed) >= 2:
            return parsed[0], parsed[1]
        elif len(parsed) == 1:
            gen_time = parsed[0]
            h, m = map(int, gen_time.split(":"))
            pub_time = f"{(h + 1) % 24:02d}:{m:02d}"
            return gen_time, pub_time

        return "08:00", "09:00"

    @classmethod
    def _extract_target_table(cls, text: str, tables: List[Dict[str, Any]]) -> str:
        table_name = cls._extract_table_name(text, tables)
        if table_name:
            return table_name

        # Look in tables for best candidate
        for t in tables:
            name = t.get("name", "").lower()
            if not t.get("is_sensitive", False) and name in ["posts", "articles", "blogs", "stories", "customer_blogs"]:
                return t.get("name")
        return "posts"

    @classmethod
    def _extract_rejection_feedback(cls, text: str) -> str:
        m = re.search(r"(?:because|feedback|reason|why|note)\s*[:\-]?\s*['\"]?([^'\"\.\n]+)['\"]?", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        return "Please revise content to address editorial quality and accuracy."

    @classmethod
    def _extract_search_query(cls, text: str) -> str:
        m = re.search(r"(?:for|about|query|search)\s+['\"]?([^'\"\.\n]+)['\"]?", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        return text
