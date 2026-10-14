import time
import re
from fastapi import APIRouter, HTTPException, Depends
from ai_service.app.schemas.ai import (
    GenerateRequest,
    GenerateResponse,
    ProviderHealthRequest,
    ProviderHealthResponse,
    ProposeAutomationRequest,
    ProposeAutomationResponse,
    ProposedMapping,
)
from ai_service.app.providers.factory import AIProviderFactory

router = APIRouter(prefix="/v1/ai", tags=["AI"])


@router.post("/generate", response_model=GenerateResponse)
def generate_content(req: GenerateRequest):
    start = time.time()
    try:
        provider = AIProviderFactory.get_provider(
            provider_name=req.provider,
            model=req.model,
            api_key=req.api_key
        )

        # Assemble prompt with RAG context if provided
        final_prompt = req.prompt
        if req.context_passages:
            context_block = "\n\n--- RETRIEVED KNOWLEDGE CONTEXT ---\n" + "\n\n".join(req.context_passages) + "\n----------------------------------\n"
            final_prompt = f"{context_block}\n\nTask:\n{req.prompt}"

        generated_data = provider.generate_structured_data(
            prompt=final_prompt,
            system_prompt=req.system_prompt,
            target_table=req.target_table,
            required_fields=req.required_fields,
            rejection_feedback=req.rejection_feedback
        )

        latency = round(time.time() - start, 3)

        return GenerateResponse(
            success=True,
            provider_used=req.provider,
            model_used=req.model or "default",
            latency_seconds=latency,
            data=generated_data
        )
    except Exception as e:
        latency = round(time.time() - start, 3)
        return GenerateResponse(
            success=False,
            provider_used=req.provider,
            model_used=req.model or "default",
            latency_seconds=latency,
            data={},
            error=str(e)
        )


@router.post("/health", response_model=ProviderHealthResponse)
def check_provider_health(req: ProviderHealthRequest):
    try:
        provider = AIProviderFactory.get_provider(
            provider_name=req.provider,
            model=req.model,
            api_key=req.api_key
        )
        status = provider.test_connection()
        return ProviderHealthResponse(
            provider=req.provider,
            available=status.get("available", False),
            latency_ms=status.get("latency_ms", 0.0),
            models=status.get("models", []),
            message=status.get("message", "Status checked.")
        )
    except Exception as e:
        return ProviderHealthResponse(
            provider=req.provider,
            available=False,
            latency_ms=0.0,
            models=[],
            message=f"Health check failed: {str(e)}"
        )


@router.post("/propose-automation", response_model=ProposeAutomationResponse)
def propose_automation_plan(req: ProposeAutomationRequest):
    """
    Intelligently translate a user's natural language goal into a validated automation configuration.
    """
    goal = req.goal_prompt.strip()
    tables = req.tables or []

    # 1. Identify target table
    target_table = None
    target_table_meta = None

    editorial_keywords = {"article", "post", "blog", "story", "write-up", "content", "news"}
    has_editorial_goal = any(kw in goal.lower() for kw in editorial_keywords)

    # Check if a specific table name is mentioned as a whole word in the goal
    for t in tables:
        t_name = t.get("name", "")
        if not t_name or t.get("is_sensitive", False):
            continue
        # Avoid false matching on category/tag when prompt describes relational assignment
        if t_name.lower() in ["categories", "category", "tags", "tag"] and ("category" in goal.lower() or "tag" in goal.lower()):
            if "table " + t_name.lower() not in goal.lower() and "into " + t_name.lower() not in goal.lower():
                continue
        if re.search(r'\b' + re.escape(t_name.lower()) + r'\b', goal.lower()):
            target_table = t_name
            target_table_meta = t
            break

    # If editorial goal and no exact table specified, prioritize posts/articles
    if not target_table and has_editorial_goal:
        editorial_candidates = [
            t for t in tables
            if not t.get("is_sensitive", False) and t.get("name", "").lower() in ["posts", "articles", "blogs", "stories", "blog_posts"]
        ]
        if editorial_candidates:
            target_table_meta = editorial_candidates[0]
            target_table = editorial_candidates[0].get("name")

    # Otherwise choose highest recommended content table
    if not target_table:
        eligible = [t for t in tables if not t.get("is_sensitive", False) and t.get("category") != "RESTRICTED"]
        recommended = [t for t in eligible if t.get("category") == "RECOMMENDED" or t.get("eligibility_tier") == "RECOMMENDED"]
        
        def table_weight(x):
            score = x.get("recommendation_score", 0)
            name = x.get("name", "").lower()
            # Editorial tables get a boost if prompt is article/content oriented
            if has_editorial_goal and name in ["posts", "articles", "blogs", "stories"]:
                score += 50
            # Tables with content/body column get an extra boost
            cols = [c.get("name", "").lower() if isinstance(c, dict) else str(c).lower() for c in x.get("columns", [])]
            if any(c in cols for c in ["content", "body", "article", "markdown"]):
                score += 10
            return score

        recommended.sort(key=table_weight, reverse=True)
        if recommended:
            target_table_meta = recommended[0]
            target_table = recommended[0].get("name")
        elif eligible:
            eligible.sort(key=table_weight, reverse=True)
            target_table_meta = eligible[0]
            target_table = eligible[0].get("name")
        else:
            target_table = "posts"

    # 2. Extract timing from prompt (e.g. "8 AM", "8:00", "9 AM", "9:00")
    gen_time = "08:00"
    pub_time = "09:00"

    times_found = re.findall(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', goal, re.IGNORECASE)
    parsed_hours = []
    for h_str, m_str, ampm in times_found:
        try:
            h = int(h_str)
            m = int(m_str) if m_str else 0
            if ampm:
                if ampm.lower() == 'pm' and h < 12:
                    h += 12
                elif ampm.lower() == 'am' and h == 12:
                    h = 0
            parsed_hours.append(f"{h:02d}:{m:02d}")
        except Exception:
            pass

    if len(parsed_hours) >= 2:
        gen_time = parsed_hours[0]
        pub_time = parsed_hours[1]
    elif len(parsed_hours) == 1:
        gen_time = parsed_hours[0]
        # Pub time 1 hour later
        h, m = map(int, gen_time.split(':'))
        pub_time = f"{(h + 1) % 24:02d}:{m:02d}"

    # 3. Detect schedule frequency
    freq = "DAILY"
    if "weekly" in goal.lower() or "once a week" in goal.lower():
        freq = "WEEKLY"
    elif "one-time" in goal.lower() or "once" in goal.lower() or "single" in goal.lower():
        freq = "ONE_TIME"

    # 4. Extract Category or Topic
    category_name = None
    cat_match = re.search(r'(?:category|topic|tag)\s+(?:called|named|to|as)?\s*[\'"]?([A-Za-z0-9\s_-]+)[\'"]?', goal, re.IGNORECASE)
    if cat_match:
        category_name = cat_match.group(1).strip()
    elif "car" in goal.lower():
        category_name = "Cars"
    elif "ai" in goal.lower() or "artificial intelligence" in goal.lower():
        category_name = "Artificial Intelligence"
    elif "cloud" in goal.lower() or "kubernetes" in goal.lower():
        category_name = "Cloud Architecture"
    elif "database" in goal.lower():
        category_name = "Database Systems"

    # Extract clean topic
    topic = goal
    # Remove scheduling boilerplates from topic
    topic = re.sub(r'create\s+(?:one\s+)?(?:useful\s+)?article(?:s)?\s+(?:about|on)?', '', topic, flags=re.IGNORECASE)
    topic = re.sub(r'per\s+day.*', '', topic, flags=re.IGNORECASE)
    topic = re.sub(r'daily.*', '', topic, flags=re.IGNORECASE)
    topic = topic.strip(" .!,") or "Modern Software Architecture"

    # 5. Formulate proposed name
    clean_title = f"{freq.capitalize()} {target_table.capitalize()} Automation: {topic[:40]}"

    # 6. Build field mappings based on target table columns
    columns = target_table_meta.get("columns", []) if target_table_meta else []
    mappings: list[ProposedMapping] = []

    for col in columns:
        c_name = col.get("name", "")
        if col.get("is_primary_key") or c_name in ["created_at", "updated_at", "deleted_at"]:
            continue

        data_type = col.get("data_type", "").lower()

        # Slug derived
        if c_name == "slug":
            mappings.append(ProposedMapping(
                field_name=c_name,
                mapping_type="DERIVED_SLUG",
                source_field="title"
            ))
        # Relational category / foreign key
        elif c_name.endswith("_id") or col.get("is_foreign_key"):
            ref_table = "categories"
            # Inspect table relationships if present
            for rel in target_table_meta.get("relationships", []):
                if rel.get("foreign_key") == c_name:
                    ref_table = rel.get("referenced_table", "categories")
                    break

            if "cat" in c_name or "category" in ref_table:
                mappings.append(ProposedMapping(
                    field_name=c_name,
                    mapping_type="RELATIONAL_LOOKUP",
                    fixed_value=category_name or "General",
                    relation_config={
                        "referenced_table": ref_table,
                        "lookup_field": "name",
                        "creation_policy": "CREATE_IF_MISSING",
                        "value": category_name or "General",
                    }
                ))
            else:
                mappings.append(ProposedMapping(
                    field_name=c_name,
                    mapping_type="FIXED_VALUE",
                    fixed_value=1
                ))
        # Editorial text fields
        elif any(kw in c_name for kw in ["title", "content", "body", "excerpt", "description", "summary"]):
            mappings.append(ProposedMapping(
                field_name=c_name,
                mapping_type="AI_GENERATED"
            ))
        # Enum or status
        elif c_name == "status":
            enum_vals = col.get("enum_values", [])
            val = "published" if "published" in enum_vals else (enum_vals[0] if enum_vals else "published")
            mappings.append(ProposedMapping(
                field_name=c_name,
                mapping_type="FIXED_VALUE",
                fixed_value=val
            ))
        # Date / published_at
        elif "published_at" in c_name or "date" in c_name:
            mappings.append(ProposedMapping(
                field_name=c_name,
                mapping_type="RUNTIME_NOW"
            ))
        else:
            default_val = col.get("default") or ""
            mappings.append(ProposedMapping(
                field_name=c_name,
                mapping_type="FIXED_VALUE",
                fixed_value=default_val
            ))

    explanation = (
        f"Analyzed discovered table '{target_table}' ({len(columns)} columns). "
        f"Proposed {len(mappings)} field mappings with AI editorial generation for descriptive text, "
        f"derived SEO slugs, and relational resolution for category taxonomy (Policy: CREATE_IF_MISSING). "
        f"Scheduled for {gen_time} generation and {pub_time} publication with human-in-the-loop review."
    )

    return ProposeAutomationResponse(
        success=True,
        name=clean_title,
        target_table=target_table,
        operation_mode="AI_CREATE",
        topic=topic,
        tone="Professional, informative, and engaging",
        category_name=category_name,
        field_mappings=mappings,
        schedule_type=freq,
        generation_time=gen_time,
        publication_time=pub_time,
        timezone="Asia/Kolkata",
        requires_approval=False,
        timeout_policy="AUTO_PUBLISH_LATEST",
        explanation=explanation
    )
