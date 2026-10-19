from fastapi import APIRouter

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
    return AgentDecider.decide(req)


from typing import Any, Dict, List, Optional  # noqa: E402

from pydantic import BaseModel, Field  # noqa: E402

from ai_service.app.services import agent_fastpath  # noqa: E402


class RouteRequest(BaseModel):
    utterance: str
    hint: Dict[str, Any] = Field(default_factory=dict)
    pages: List[Dict[str, str]] = Field(default_factory=list)
    history: List[Dict[str, str]] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    deadline_seconds: float = 120.0


class AnswerRequest(BaseModel):
    utterance: str
    result: Dict[str, Any]
    missing: List[str] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    deadline_seconds: float = 120.0


@router.post("/route")
def route(req: RouteRequest) -> Dict[str, Any]:
    """Small focused call: is this one read-only question about the user's data? Restated in English."""
    return agent_fastpath.route(req.utterance, req.hint, req.history, req.provider, req.model, req.api_key, req.deadline_seconds, req.pages)


@router.post("/answer")
def answer(req: AnswerRequest) -> Dict[str, Any]:
    """Small focused call: the reply to the user, from a verified query result, in their language."""
    return agent_fastpath.answer(req.utterance, req.result, req.provider, req.model, req.api_key, req.deadline_seconds, req.missing)
