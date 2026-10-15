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
