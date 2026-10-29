from fastapi import APIRouter

from ai_service.app import usage
from ai_service.app.schemas.agent import DecideRequest, DecideResponse
from ai_service.app.services.agent_decider import AgentDecider

router = APIRouter(prefix="/v1/ai/agent", tags=["Agent"])


@router.post("/decide", response_model=DecideResponse)
def decide(req: DecideRequest) -> DecideResponse:
    """
    One step of Orbit's observe-act loop: the model reads the current utterance, live
    runtime context, retrieved knowledge and this turn's real tool observations, and
    returns one validated AgentDecision. Laravel executes any tool call and calls again.
    """
    res = AgentDecider.decide(req)
    res.model_notes = usage.notes()
    return res


from typing import Any, Dict, List, Optional  # noqa: E402

from pydantic import BaseModel, Field  # noqa: E402

from ai_service.app.rag.service import rag_service  # noqa: E402
from ai_service.app.schemas.agent import SchemaDocument  # noqa: E402
from ai_service.app.services import agent_fastpath  # noqa: E402


class RouteRequest(BaseModel):
    utterance: str
    # Every table of the user's databases and every portal page; the ones the message is about are retrieved.
    schema_documents: List[SchemaDocument] = Field(default_factory=list, max_length=4000)
    pages: List[Dict[str, Any]] = Field(default_factory=list)
    history: List[Dict[str, str]] = Field(default_factory=list)
    # The administrators' instructions for this call (Admin › Settings › Orbit).
    instructions: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    deadline_seconds: float = 120.0


class AnswerRequest(BaseModel):
    utterance: str
    result: Dict[str, Any]
    missing: List[str] = Field(default_factory=list)
    instructions: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    deadline_seconds: float = 120.0


class KnowledgeRequest(BaseModel):
    user_id: int = Field(..., ge=1)
    query: str = Field(..., min_length=2, max_length=500)
    top_k: int = Field(5, ge=1, le=10)


@router.post("/route")
def route(req: RouteRequest) -> Dict[str, Any]:
    """Small focused call: one read-only data question (and its database), one page to open, or anything else."""
    return agent_fastpath.route(req.utterance, req.history, req.provider, req.model, req.api_key, req.deadline_seconds,
                                req.pages, req.schema_documents, req.instructions)


@router.post("/answer")
def answer(req: AnswerRequest) -> Dict[str, Any]:
    """Small focused call: the reply to the user, from a verified result, in their language."""
    return agent_fastpath.answer(req.utterance, req.result, req.provider, req.model, req.api_key, req.deadline_seconds,
                                 req.missing, req.instructions)


@router.post("/knowledge")
def knowledge(req: KnowledgeRequest) -> Dict[str, Any]:
    """
    Search Orbit's knowledge and the user's own documents with a query the model wrote (search_orbit_knowledge), for
    when what was retrieved for the message did not cover it. Only the product partition and this user's are read.
    """
    result = rag_service.retrieve_for_agent(user_id=req.user_id, query_text=req.query, product_k=req.top_k, user_k=3)
    return {"success": True, "query": req.query, "passages": result["chunks"], "embedding_backend": result.get("embedding_backend")}
