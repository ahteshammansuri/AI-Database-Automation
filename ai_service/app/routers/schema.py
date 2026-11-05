"""
Schema understanding: /v1/schema/interpret-table (what each column of a table stores and what its coded values mean),
/v1/schema/check-link (a claimed link that reads like a code, judged against the rows it would point to)
and /v1/schema/choose-parent (reuse an existing parent record for new content, or name a new one). All use the
customer's own model with constrained JSON, embeddings and their FAISS knowledge index; Laravel validates the answers
against the live schema before anything is used.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ai_service.app.providers.base import ProviderError
from ai_service.app.providers.factory import AIProviderFactory
from ai_service.app.services import schema_interpreter as interpreter

router = APIRouter(prefix="/v1/schema", tags=["Schema understanding"])


class ModelChoice(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=1.5)


def _provider(req: ModelChoice):
    """The customer's model, or (None, reason) so the answer can fall back to embeddings honestly."""
    if not req.provider:
        return None, "No model was chosen."
    try:
        return AIProviderFactory.get_provider(req.provider, req.model, req.api_key), None
    except ProviderError as e:
        return None, str(e)[:200]


class InterpretTableRequest(ModelChoice):
    user_id: Optional[int] = None
    table: str = Field(..., min_length=1, max_length=64)
    columns: List[Dict[str, Any]] = Field(..., min_length=1, max_length=200)
    other_tables: List[Dict[str, Any]] = Field(default_factory=list, max_length=600)
    focus: Optional[List[str]] = Field(None, max_length=40)
    budget_seconds: float = Field(240.0, ge=20.0, le=900.0)


@router.post("/interpret-table")
def interpret_table(req: InterpretTableRequest):
    provider, error = _provider(req)
    return interpreter.interpret_table(provider, req.table, req.columns, req.other_tables, req.user_id,
                                       budget_seconds=req.budget_seconds,
                                       temperature=0.1 if req.temperature is None else min(req.temperature, 0.4),
                                       provider_error=error, focus=req.focus)


class CheckLinkRequest(ModelChoice):
    table: str = Field(..., min_length=1, max_length=64)
    column: str = Field(..., min_length=1, max_length=64)
    meaning: str = Field("", max_length=200)
    ref_table: str = Field(..., min_length=1, max_length=64)
    rows: List[Dict[str, Any]] = Field(default_factory=list, max_length=15)
    budget_seconds: float = Field(90.0, ge=10.0, le=300.0)


@router.post("/check-link")
def check_link(req: CheckLinkRequest):
    provider, error = _provider(req)
    return interpreter.judge_link(provider, req.table, req.column, req.meaning, req.ref_table, req.rows,
                                  budget_seconds=req.budget_seconds,
                                  temperature=0.1 if req.temperature is None else min(req.temperature, 0.4),
                                  provider_error=error)


class ChooseParentRequest(ModelChoice):
    entity: str = Field(..., min_length=1, max_length=80)
    content: Dict[str, Any] = Field(default_factory=dict)
    candidates: List[str] = Field(default_factory=list, max_length=400)
    allow_new: bool = True
    budget_seconds: float = Field(120.0, ge=10.0, le=600.0)


@router.post("/choose-parent")
def choose_parent(req: ChooseParentRequest):
    provider, error = _provider(req)
    return interpreter.choose_parent(provider, req.entity, req.content, req.candidates, req.allow_new,
                                     budget_seconds=req.budget_seconds,
                                     temperature=0.1 if req.temperature is None else min(req.temperature, 0.4),
                                     provider_error=error)
