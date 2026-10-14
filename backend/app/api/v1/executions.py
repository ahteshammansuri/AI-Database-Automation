import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import AutomationExecution, ContentVersion, Automation
from backend.app.schemas.execution import (
    ExecutionResponse, ContentVersionResponse, ManualPublicationCreate
)
from backend.app.schemas.common import PaginatedResponse
from backend.app.automation.engine import AutomationEngine

router = APIRouter(prefix="/executions", tags=["Execution History & Manual Scheduling"])


def _format_execution_response(e: AutomationExecution) -> ExecutionResponse:
    current_v = None
    if e.versions:
        latest = sorted(e.versions, key=lambda v: v.version_number, reverse=True)[0]
        current_v = ContentVersionResponse(
            id=latest.id,
            execution_id=latest.execution_id,
            automation_id=latest.automation_id,
            version_number=latest.version_number,
            payload=json.loads(latest.payload_json),
            status=latest.status,
            rejection_feedback=latest.rejection_feedback,
            created_at=latest.created_at
        )

    return ExecutionResponse(
        id=e.id,
        automation_id=e.automation_id,
        automation_name=e.automation.name if e.automation else None,
        status=e.status,
        mode=e.mode,
        trigger_type=e.trigger_type,
        idempotency_key=e.idempotency_key,
        scheduled_generation_time=e.scheduled_generation_time,
        scheduled_publication_time=e.scheduled_publication_time,
        started_at=e.started_at,
        completed_at=e.completed_at,
        error_message=e.error_message,
        target_record_id=e.target_record_id,
        regeneration_count=e.regeneration_count,
        created_at=e.created_at,
        current_version=current_v
    )


@router.get("", response_model=PaginatedResponse[ExecutionResponse])
def list_executions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    automation_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(AutomationExecution)
    if automation_id:
        query = query.filter(AutomationExecution.automation_id == automation_id)
    if status:
        query = query.filter(AutomationExecution.status == status)

    total = query.count()
    items = query.order_by(AutomationExecution.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    return PaginatedResponse(
        items=[_format_execution_response(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages
    )


@router.get("/{execution_id}", response_model=ExecutionResponse)
def get_execution(execution_id: int, db: Session = Depends(get_db)):
    e = db.query(AutomationExecution).filter(AutomationExecution.id == execution_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Execution record not found")
    return _format_execution_response(e)


@router.post("/{execution_id}/publish-now")
def publish_now(execution_id: int, db: Session = Depends(get_db)):
    """Publish an approved execution to the target database immediately."""
    success, msg = AutomationEngine.execute_publication(db=db, execution_id=execution_id)
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}


@router.post("/manual", response_model=ExecutionResponse)
def schedule_manual_content(payload: ManualPublicationCreate, db: Session = Depends(get_db)):
    """Schedule user-provided content without calling any AI provider."""
    try:
        execution = AutomationEngine.schedule_manual_publication(
            db=db,
            automation_id=payload.automation_id,
            payload=payload.payload,
            publication_time=payload.publication_time
        )
        return _format_execution_response(execution)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Manual publication scheduling failed: {str(e)}")
