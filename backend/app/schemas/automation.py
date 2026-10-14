from datetime import datetime
from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field, ConfigDict


class FieldMapping(BaseModel):
    column: str
    source: str  # "AI_GENERATED", "FIXED_VALUE", "RELATIONSHIP_LOOKUP", "RUNTIME_VALUE", "USER_INPUT"
    value: Optional[Any] = None
    rule: Optional[str] = None  # e.g. "slugify(title)", "now()"
    lookup_table: Optional[str] = None
    lookup_column: Optional[str] = None
    lookup_value: Optional[Any] = None


class AIConfig(BaseModel):
    provider: str = "mock"
    model: str = "default"
    topic: str
    tone: str = "Authoritative and educational"
    target_audience: Optional[str] = "Website visitors and developers"
    word_count: Optional[int] = 600
    document_ids: List[int] = []
    custom_instructions: Optional[str] = None


class ScheduleConfig(BaseModel):
    frequency: str = "DAILY"  # ONCE, DAILY, WEEKLY
    timezone: str = "Asia/Kolkata"
    generation_time: str = "08:00"  # HH:MM
    publication_time: str = "09:00"  # HH:MM
    active_days: Optional[List[int]] = [0, 1, 2, 3, 4, 5, 6]  # 0=Monday


class ApprovalPolicy(BaseModel):
    require_approval: bool = True
    reviewer_email: str = "editor@example.com"
    timeout_action: str = "PUBLISH_PENDING"  # PUBLISH_PENDING, FAIL_SAFE, KEEP_DRAFT
    max_regenerations: int = Field(default=3, ge=1, le=5)


class AutomationCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    connection_id: int
    target_table: str
    operation: str = "INSERT"  # INSERT, UPDATE
    mode: str = "AI_GENERATED"  # AI_GENERATED, MANUAL
    field_mappings: List[FieldMapping]
    ai_config: Optional[AIConfig] = None
    schedule_config: ScheduleConfig
    approval_policy: ApprovalPolicy


class AutomationUpdate(BaseModel):
    name: Optional[str] = None
    field_mappings: Optional[List[FieldMapping]] = None
    ai_config: Optional[AIConfig] = None
    schedule_config: Optional[ScheduleConfig] = None
    approval_policy: Optional[ApprovalPolicy] = None
    status: Optional[str] = None  # ACTIVE, PAUSED, DISABLED


class AutomationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    connection_id: int
    target_table: str
    operation: str
    mode: str
    field_mappings: List[FieldMapping]
    ai_config: Optional[AIConfig] = None
    schedule_config: ScheduleConfig
    approval_policy: ApprovalPolicy
    status: str
    version: int
    created_at: datetime
    updated_at: datetime
    next_run_at: Optional[datetime] = None

