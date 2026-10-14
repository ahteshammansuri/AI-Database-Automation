from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    provider: str = Field(default="mock", description="Provider: ollama, mock, openai, gemini, anthropic")
    model: Optional[str] = Field(default=None, description="Model identifier")
    api_key: Optional[str] = Field(default=None, description="Optional user-provided cloud API key")
    prompt: str = Field(..., description="Main prompt instruction")
    system_prompt: str = Field(default="You are an expert technical writer and database content automation engine.", description="System prompt instructions")
    target_table: str = Field(default="posts", description="Name of the target relational database table")
    required_fields: List[str] = Field(default_factory=lambda: ["title", "slug", "content", "excerpt"], description="List of columns to generate")
    context_passages: List[str] = Field(default_factory=list, description="Retrieved RAG context passages")
    rejection_feedback: Optional[str] = Field(default=None, description="Feedback from reviewer on rejected version")


class GenerateResponse(BaseModel):
    success: bool
    provider_used: str
    model_used: str
    latency_seconds: float
    data: Dict[str, Any]
    error: Optional[str] = None


class ProviderHealthRequest(BaseModel):
    provider: str = "ollama"
    model: Optional[str] = None
    api_key: Optional[str] = None


class ProviderHealthResponse(BaseModel):
    provider: str
    available: bool
    latency_ms: float
    models: List[str]
    message: str


class ProposeAutomationRequest(BaseModel):
    goal_prompt: str = Field(..., description="User's natural language goal instruction")
    tables: List[Dict[str, Any]] = Field(default_factory=list, description="Discovered tables and columns metadata")
    provider: Optional[str] = "mock"
    model: Optional[str] = None
    api_key: Optional[str] = None


class ProposedMapping(BaseModel):
    field_name: str
    mapping_type: str  # AI_GENERATED, DERIVED_SLUG, FIXED_VALUE, RUNTIME_NOW, RELATIONAL_LOOKUP
    source_field: Optional[str] = None
    fixed_value: Optional[Any] = None
    relation_config: Optional[Dict[str, Any]] = None


class ProposeAutomationResponse(BaseModel):
    success: bool
    name: str
    target_table: str
    operation_mode: str
    topic: str
    tone: str
    category_name: Optional[str] = None
    field_mappings: List[ProposedMapping]
    schedule_type: str  # DAILY, WEEKLY, ONE_TIME
    generation_time: str
    publication_time: str
    timezone: str
    requires_approval: bool
    timeout_policy: str
    explanation: str
    error: Optional[str] = None
