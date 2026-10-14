from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class AIProviderInfo(BaseModel):
    provider_id: str
    name: str
    is_available: bool
    is_local: bool
    requires_api_key: bool
    is_configured: bool
    available_models: List[str]
    current_model: str
    status_message: str


class AITestRequest(BaseModel):
    provider_id: str
    model: Optional[str] = None


class AITestResponse(BaseModel):
    success: bool
    provider_id: str
    model: str
    message: str
    latency_ms: Optional[float] = None


class AIPreviewRequest(BaseModel):
    topic: str
    tone: str = "Authoritative, educational"
    target_table: str = "posts"
    fields: List[str] = ["title", "slug", "excerpt", "content", "status"]
    context_document_ids: Optional[List[int]] = None


class AIPreviewResponse(BaseModel):
    success: bool
    generated_data: Dict[str, Any]
    retrieved_chunks: List[str] = []
    generation_duration_ms: float
