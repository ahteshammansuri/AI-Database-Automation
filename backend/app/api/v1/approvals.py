import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.schemas.execution import (
    ApprovalDetailResponse, ApprovalActionRequest, ApprovalActionResponse
)
from backend.app.models import ApprovalToken, AutomationExecution, ContentVersion, Automation
from backend.app.automation.approval_service import ApprovalService
from backend.app.automation.engine import AutomationEngine

router = APIRouter(prefix="/approvals", tags=["Approval Workflow"])


@router.get("/{token}", response_model=ApprovalDetailResponse)
def get_approval_preview(token: str, db: Session = Depends(get_db)):
    """
    Safe read-only endpoint for confirmation page.
    NEVER performs state mutations on GET to prevent accidental triggers by email security scanners.
    """
    valid, token_obj, msg = ApprovalService.get_token_details(db, token)
    if not valid or not token_obj:
        raise HTTPException(status_code=400, detail=msg)

    execution = db.query(AutomationExecution).filter(AutomationExecution.id == token_obj.execution_id).first()
    version = db.query(ContentVersion).filter(ContentVersion.id == token_obj.version_id).first()
    if not execution or not version:
        raise HTTPException(status_code=404, detail="Execution or content version not found.")

    automation = execution.automation
    payload = json.loads(version.payload_json)

    return ApprovalDetailResponse(
        valid=True,
        action=token_obj.action,
        automation_name=automation.name if automation else "Automation",
        target_table=automation.target_table if automation else "posts",
        scheduled_publication_time=execution.scheduled_publication_time,
        version_number=version.version_number,
        payload=payload,
        expires_at=token_obj.expires_at
    )


@router.post("/{token}/action", response_model=ApprovalActionResponse)
def submit_approval_action(token: str, payload: ApprovalActionRequest, db: Session = Depends(get_db)):
    """
    State mutation endpoint requiring explicit user confirmation.
    """
    valid, token_obj, msg = ApprovalService.get_token_details(db, token)
    if not valid or not token_obj:
        raise HTTPException(status_code=400, detail=msg)

    if token_obj.action != payload.action:
        raise HTTPException(
            status_code=400,
            detail=f"This link was issued for {token_obj.action}, but {payload.action} was requested."
        )

    success, action_msg, execution = ApprovalService.consume_token_action(
        db=db,
        raw_token=token,
        action=payload.action,
        feedback=payload.feedback
    )

    if not success or not execution:
        raise HTTPException(status_code=400, detail=action_msg)

    if payload.action == "APPROVE":
        return ApprovalActionResponse(
            success=True,
            status="APPROVED",
            message=action_msg,
            next_step="Content is approved and scheduled for target database publication."
        )

    elif payload.action == "REJECT":
        # Check automatic regeneration
        try:
            new_execution = AutomationEngine.trigger_generation(
                db=db,
                automation_id=execution.automation_id,
                trigger_type="REGENERATION",
                rejection_feedback=payload.feedback,
                existing_execution_id=execution.id
            )
            return ApprovalActionResponse(
                success=True,
                status=new_execution.status,
                message=f"Version rejected. Regeneration initiated with your feedback (Attempt #{new_execution.regeneration_count}).",
                next_step="A new preview version will be generated and emailed for review."
            )
        except Exception as e:
            return ApprovalActionResponse(
                success=True,
                status="REJECTED",
                message=f"Version rejected. Regeneration notice: {str(e)}",
                next_step="Please review the automation manually in dashboard."
            )
