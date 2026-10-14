from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field


class AgentPlanStep(BaseModel):
    step_id: Optional[str] = None
    tool: str
    label: str
    args: Dict[str, Any] = Field(default_factory=dict)
    dependencies: List[str] = Field(default_factory=list)
    risk_level: str = "LOW"
    requires_confirmation: bool = False


class AgentPlanRequest(BaseModel):
    goal_prompt: str = Field(..., description="User's natural language request")
    has_connections: bool = Field(default=False)
    connections: List[Dict[str, Any]] = Field(default_factory=list)
    tables: List[Dict[str, Any]] = Field(default_factory=list)
    automations: List[Dict[str, Any]] = Field(default_factory=list)
    executions: List[Dict[str, Any]] = Field(default_factory=list)
    conversation_history: List[Dict[str, Any]] = Field(default_factory=list)
    accumulated_slots: Dict[str, Any] = Field(default_factory=dict)
    active_task: Optional[Dict[str, Any]] = None
    tool_availability: Union[Dict[str, Any], List[Any]] = Field(default_factory=dict)
    available_tools: List[Dict[str, Any]] = Field(default_factory=list)
    rag_chunks: List[Dict[str, Any]] = Field(default_factory=list)
    provider: Optional[str] = "ollama"
    model: Optional[str] = None
    api_key: Optional[str] = None
    correlation_id: Optional[str] = None
    plan_version: Optional[int] = 1


class AgentPlanResponse(BaseModel):
    success: bool
    task_type: str
    outcome: str = "SUPPORTED_AND_SPECIFIED"  # SUPPORTED_AND_SPECIFIED, MISSING_INFORMATION, AMBIGUOUS, CURRENTLY_UNAVAILABLE, UNSUPPORTED, DISALLOWED_BY_POLICY, RECOVER_FROM_ERROR
    requires_input: bool = False
    secure_input_type: Optional[str] = None
    question: Optional[str] = None
    steps: List[AgentPlanStep] = Field(default_factory=list)
    extracted_slots: Dict[str, Any] = Field(default_factory=dict)
    missing_fields: List[str] = Field(default_factory=list)
    explanation: str = ""
    suggested_recovery: Optional[str] = None
    target_resource_type: Optional[str] = None
    target_resource_id: Optional[int] = None
    rag_citations: List[Dict[str, Any]] = Field(default_factory=list)
    provider_used: Optional[str] = None
    model_used: Optional[str] = None


class EvaluateCorrectionRequest(BaseModel):
    correction_text: str
    active_task_status: str
    current_step: Optional[str] = None
    active_plan: Optional[List[Dict[str, Any]]] = None
    target_resource_type: Optional[str] = None
    target_resource_id: Optional[int] = None
    provider: Optional[str] = "ollama"
    model: Optional[str] = None


class EvaluateCorrectionResponse(BaseModel):
    action: str  # STOP, PAUSE, RESUME, CHANGE_PARAMETER, NEW_REQUEST
    revised_parameter: Optional[str] = None
    new_value: Optional[Any] = None
    compensating_needed: bool = False
    explanation: str = ""


class SynthesizeResponseRequest(BaseModel):
    goal_prompt: Optional[str] = None
    user_goal: Optional[str] = None
    executed_steps: List[Dict[str, Any]] = Field(default_factory=list)
    action_summary: Optional[str] = None
    final_status: Optional[str] = None
    result_status: Optional[str] = None
    domain_data: Optional[Dict[str, Any]] = None
    result_data: Optional[Dict[str, Any]] = None
    provider: Optional[str] = "ollama"
    model: Optional[str] = None


class SynthesizeResponseResponse(BaseModel):
    spoken_text: str
    safe_summary: str
