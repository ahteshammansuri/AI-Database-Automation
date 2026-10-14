from datetime import datetime
from typing import Any, Dict, Optional, Generic, TypeVar, List
from pydantic import BaseModel, Field

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    timestamp: datetime
    environment: str
    platform_db: str
    active_ai_provider: str


class DashboardStatsResponse(BaseModel):
    total_connections: int = 0
    active_automations: int = 0
    pending_approvals: int = 0
    total_publications: int = 0
    failed_executions: int = 0
    total_knowledge_docs: int = 0
