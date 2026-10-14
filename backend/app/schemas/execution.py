from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class ContentVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    execution_id: int
    automation_id: int
    version_number: int
    payload: Dict[str, Any]
    status: str
    rejection_feedback: Optional[str] = None
    created_at: datetime


class ExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    automation_id: int
    automation_name: Optional[str] = None
    status: str
    mode: str
    trigger_type: str
    idempotency_key: str
    scheduled_generation_time: Optional[datetime] = None
    scheduled_publication_time: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    target_record_id: Optional[str] = None
    regeneration_count: int
    created_at: datetime
    current_version: Optional[ContentVersionResponse] = None



class ManualPublicationCreate(BaseModel):
    automation_id: int
    payload: Dict[str, Any]
    publication_time: Optional[datetime] = None


class ApprovalDetailResponse(BaseModel):
    valid: bool
    action: str  # "APPROVE" or "REJECT"
    automation_name: str
    target_table: str
    scheduled_publication_time: Optional[datetime] = None
    version_number: int
    payload: Dict[str, Any]
    expires_at: datetime


class ApprovalActionRequest(BaseModel):
    action: str = Field(..., pattern="^(APPROVE|REJECT)$")
    feedback: Optional[str] = None


class ApprovalActionResponse(BaseModel):
    success: bool
    status: str
    message: str
    next_step: str
