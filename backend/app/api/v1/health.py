from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.schemas.common import HealthResponse, DashboardStatsResponse
from backend.app.models import (
    ConnectionProfile, Automation, AutomationExecution, KnowledgeDocument
)

router = APIRouter(tags=["Health & Stats"])


@router.get("/health", response_model=HealthResponse)
def get_health(db: Session = Depends(get_db)):
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    return HealthResponse(
        status="ok" if db_status == "connected" else "degraded",
        version="1.0.0",
        timestamp=datetime.now(timezone.utc),
        environment=settings.ENVIRONMENT,
        platform_db=db_status,
        active_ai_provider=settings.DEFAULT_AI_PROVIDER
    )


@router.get("/stats", response_model=DashboardStatsResponse)
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_conns = db.query(func.count(ConnectionProfile.id)).scalar() or 0
    active_autos = db.query(func.count(Automation.id)).filter(Automation.status == "ACTIVE").scalar() or 0
    pending_apprs = db.query(func.count(AutomationExecution.id)).filter(
        AutomationExecution.status == "PENDING_APPROVAL"
    ).scalar() or 0
    total_pubs = db.query(func.count(AutomationExecution.id)).filter(
        AutomationExecution.status == "PUBLISHED"
    ).scalar() or 0
    failed_execs = db.query(func.count(AutomationExecution.id)).filter(
        AutomationExecution.status == "FAILED"
    ).scalar() or 0
    total_docs = db.query(func.count(KnowledgeDocument.id)).scalar() or 0

    return DashboardStatsResponse(
        total_connections=total_conns,
        active_automations=active_autos,
        pending_approvals=pending_apprs,
        total_publications=total_pubs,
        failed_executions=failed_execs,
        total_knowledge_docs=total_docs
    )
