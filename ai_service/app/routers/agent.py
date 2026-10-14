from fastapi import APIRouter
from ai_service.app.schemas.agent import (
    AgentPlanRequest,
    AgentPlanResponse,
    EvaluateCorrectionRequest,
    EvaluateCorrectionResponse,
    SynthesizeResponseRequest,
    SynthesizeResponseResponse,
)
from ai_service.app.services.agent_planner import AgentPlanner

router = APIRouter(prefix="/v1/ai/agent", tags=["Agent"])


@router.post("/plan", response_model=AgentPlanResponse)
def plan_agent_task(req: AgentPlanRequest):
    """
    Open-ended semantic request planning across all portal capabilities.
    """
    return AgentPlanner.plan(req)


@router.post("/evaluate-correction", response_model=EvaluateCorrectionResponse)
def evaluate_correction(req: EvaluateCorrectionRequest):
    """
    Semantic evaluation of interruptions, pauses, stops, and parameter changes.
    """
    return AgentPlanner.evaluate_correction(req)


@router.post("/synthesize-response", response_model=SynthesizeResponseResponse)
def synthesize_response(req: SynthesizeResponseRequest):
    """
    Synthesize a concise, natural, truthful spoken response based on verified service outcomes.
    """
    return AgentPlanner.synthesize_response(req)
