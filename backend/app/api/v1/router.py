from fastapi import APIRouter
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.connections import router as connections_router
from backend.app.api.v1.knowledge import router as knowledge_router
from backend.app.api.v1.ai import router as ai_router
from backend.app.api.v1.automations import router as automations_router
from backend.app.api.v1.executions import router as executions_router
from backend.app.api.v1.approvals import router as approvals_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router)
api_v1_router.include_router(connections_router)
api_v1_router.include_router(knowledge_router)
api_v1_router.include_router(ai_router)
api_v1_router.include_router(automations_router)
api_v1_router.include_router(executions_router)
api_v1_router.include_router(approvals_router)



