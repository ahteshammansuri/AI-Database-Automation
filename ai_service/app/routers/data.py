"""
Data Agent router: /v1/ai/data/plan and related NL-to-QueryPlan endpoints.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ai_service.app.services.data_planner import data_planner
from ai_service.app.services.data_sql_writer import write_select

router = APIRouter(prefix="/v1/ai/data", tags=["Data Agent"])


class DataPlanRequest(BaseModel):
    utterance: str = Field(..., description="Natural language question or request")
    schema_slice: Dict[str, Any] = Field(..., description="Minimal relevant schema slice")
    context: Optional[Dict[str, Any]] = Field(None, description="Active conversation context")
    timezone: str = Field("Asia/Kolkata", description="User or workspace timezone")
    backend_errors: Optional[List[str]] = Field(None, description="Validation errors from previous attempt")
    provider: Optional[str] = Field(None, description="AI provider type (ollama, openai, gemini, etc.)")
    model: Optional[str] = Field(None, description="Model identifier")


class DataPlanResponse(BaseModel):
    success: bool
    plan: Dict[str, Any]
    error: Optional[str] = None


@router.post("/plan", response_model=DataPlanResponse)
def plan_data_query(req: DataPlanRequest):
    try:
        plan = data_planner.plan(
            utterance=req.utterance,
            schema_slice=req.schema_slice,
            context=req.context,
            timezone=req.timezone,
            backend_errors=req.backend_errors,
            provider_type=req.provider,
            model_name=req.model,
        )
        return DataPlanResponse(success=True, plan=plan)
    except Exception as e:
        return DataPlanResponse(success=False, plan={}, error=str(e))


class DataSqlRequest(BaseModel):
    question: str
    schema_slice: Dict[str, Any]
    dialect: str = "mysql"
    timezone: str = "UTC"
    previous: List[Dict[str, str]] = Field(default_factory=list, description="Rejected attempts: {sql, error}")
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    deadline_seconds: float = 240.0


@router.post("/sql")
def write_sql(req: DataSqlRequest):
    """The user's model proposes one SELECT; Laravel validates it with /v1/sql/validate-select."""
    return write_select(req.question, req.schema_slice, dialect=req.dialect, timezone=req.timezone,
                        previous=req.previous, provider=req.provider, model=req.model, api_key=req.api_key,
                        deadline_seconds=req.deadline_seconds)
