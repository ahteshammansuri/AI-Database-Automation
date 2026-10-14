import json
from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Automation, ConnectionProfile, AuditLog
from backend.app.schemas.automation import (
    AutomationCreate, AutomationUpdate, AutomationResponse
)
from backend.app.schemas.execution import ExecutionResponse
from backend.app.automation.engine import AutomationEngine

router = APIRouter(prefix="/automations", tags=["Automations"])


def _format_automation_response(auto: Automation) -> AutomationResponse:
    mappings = json.loads(auto.field_mappings_json)
    ai_cfg = json.loads(auto.ai_config_json) if auto.ai_config_json else None
    sched_cfg = json.loads(auto.schedule_config_json)
    appr_policy = json.loads(auto.approval_policy_json)

    return AutomationResponse(
        id=auto.id,
        name=auto.name,
        connection_id=auto.connection_id,
        target_table=auto.target_table,
        operation=auto.operation,
        mode=auto.mode,
        field_mappings=mappings,
        ai_config=ai_cfg,
        schedule_config=sched_cfg,
        approval_policy=appr_policy,
        status=auto.status,
        version=auto.version,
        created_at=auto.created_at,
        updated_at=auto.updated_at
    )


@router.get("", response_model=List[AutomationResponse])
def list_automations(db: Session = Depends(get_db)):
    automations = db.query(Automation).order_by(Automation.created_at.desc()).all()
    return [_format_automation_response(a) for a in automations]


@router.post("", response_model=AutomationResponse, status_code=status.HTTP_201_CREATED)
def create_automation(payload: AutomationCreate, db: Session = Depends(get_db)):
    conn = db.query(ConnectionProfile).filter(ConnectionProfile.id == payload.connection_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection profile not found")

    auto = Automation(
        name=payload.name,
        connection_id=payload.connection_id,
        target_table=payload.target_table,
        operation=payload.operation,
        mode=payload.mode,
        field_mappings_json=json.dumps([m.model_dump() for m in payload.field_mappings]),
        ai_config_json=json.dumps(payload.ai_config.model_dump()) if payload.ai_config else None,
        schedule_config_json=json.dumps(payload.schedule_config.model_dump()),
        approval_policy_json=json.dumps(payload.approval_policy.model_dump()),
        status="ACTIVE",
        version=1
    )
    db.add(auto)
    db.commit()
    db.refresh(auto)

    audit = AuditLog(
        action="AUTOMATION_CREATED",
        entity_type="automation",
        entity_id=str(auto.id),
        details_json=json.dumps({"name": auto.name, "target_table": auto.target_table})
    )
    db.add(audit)
    db.commit()

    return _format_automation_response(auto)


@router.get("/{automation_id}", response_model=AutomationResponse)
def get_automation(automation_id: int, db: Session = Depends(get_db)):
    auto = db.query(Automation).filter(Automation.id == automation_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")
    return _format_automation_response(auto)


@router.patch("/{automation_id}", response_model=AutomationResponse)
def update_automation(automation_id: int, payload: AutomationUpdate, db: Session = Depends(get_db)):
    auto = db.query(Automation).filter(Automation.id == automation_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")

    if payload.name is not None:
        auto.name = payload.name
    if payload.status is not None:
        auto.status = payload.status
    if payload.field_mappings is not None:
        auto.field_mappings_json = json.dumps([m.model_dump() for m in payload.field_mappings])
    if payload.ai_config is not None:
        auto.ai_config_json = json.dumps(payload.ai_config.model_dump())
    if payload.schedule_config is not None:
        auto.schedule_config_json = json.dumps(payload.schedule_config.model_dump())
    if payload.approval_policy is not None:
        auto.approval_policy_json = json.dumps(payload.approval_policy.model_dump())

    auto.version += 1
    db.commit()
    db.refresh(auto)
    return _format_automation_response(auto)


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_automation(automation_id: int, db: Session = Depends(get_db)):
    auto = db.query(Automation).filter(Automation.id == automation_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")
    db.delete(auto)
    db.commit()
    return None


@router.post("/{automation_id}/trigger")
def trigger_automation(automation_id: int, db: Session = Depends(get_db)):
    """Run Now: Immediately triggers generation and issues approval review."""
    auto = db.query(Automation).filter(Automation.id == automation_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")

    try:
        execution = AutomationEngine.trigger_generation(
            db=db,
            automation_id=auto.id,
            trigger_type="RUN_NOW"
        )
        return {
            "success": True,
            "message": f"Automation triggered successfully. Execution #{execution.id} is {execution.status}.",
            "execution_id": execution.id,
            "status": execution.status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger automation: {str(e)}")


@router.post("/seed-demo", response_model=AutomationResponse)
def seed_demo_automation(db: Session = Depends(get_db)):
    """Creates default synthetic blog publishing automation linked to demo MySQL database."""
    conn = db.query(ConnectionProfile).filter(ConnectionProfile.name == "Synthetic Demo Blog CMS").first()
    if not conn:
        raise HTTPException(status_code=400, detail="Demo connection profile must be created first.")

    existing = db.query(Automation).filter(Automation.name == "Daily Engineering Blog Publisher").first()
    if existing:
        return _format_automation_response(existing)

    mappings = [
        {"column": "title", "source": "AI_GENERATED", "type": "string"},
        {"column": "slug", "source": "RUNTIME_VALUE", "rule": "slugify(title)"},
        {"column": "excerpt", "source": "AI_GENERATED", "type": "string"},
        {"column": "content", "source": "AI_GENERATED", "type": "string"},
        {"column": "category_id", "source": "RELATIONSHIP_LOOKUP", "lookup_table": "categories", "lookup_column": "name", "lookup_value": "Engineering & Tech"},
        {"column": "author_id", "source": "FIXED_VALUE", "value": 1},
        {"column": "status", "source": "FIXED_VALUE", "value": "published"}
    ]

    auto = Automation(
        name="Daily Engineering Blog Publisher",
        connection_id=conn.id,
        target_table="posts",
        operation="INSERT",
        mode="AI_GENERATED",
        field_mappings_json=json.dumps(mappings),
        ai_config_json=json.dumps({
            "provider": "mock",
            "model": "mock-llama3-synthetic",
            "topic": "High-Throughput Database Automation Guardrails",
            "tone": "Authoritative and educational",
            "word_count": 600,
            "document_ids": []
        }),
        schedule_config_json=json.dumps({
            "frequency": "DAILY",
            "timezone": "Asia/Kolkata",
            "generation_time": "08:00",
            "publication_time": "09:00"
        }),
        approval_policy_json=json.dumps({
            "require_approval": True,
            "reviewer_email": "editor@syntheticsite.com",
            "timeout_action": "PUBLISH_PENDING",
            "max_regenerations": 3
        }),
        status="ACTIVE",
        version=1
    )
    db.add(auto)
    db.commit()
    db.refresh(auto)
    return _format_automation_response(auto)
