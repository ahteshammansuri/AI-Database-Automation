import os
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse
from ai_service.app.config import settings
from ai_service.app.routers.ai import router as ai_router
from ai_service.app.routers.rag import router as rag_router
from ai_service.app.routers.agent import router as agent_router
from ai_service.app.routers.sql import router as sql_router
from ai_service.app.routers.data import router as data_router
from ai_service.app.routers.media import router as media_router

app = FastAPI(
    title="Dedicated AI & RAG Service",
    description="Internal Python microservice for LLM generation, embeddings, and FAISS vector retrieval.",
    version="1.0.0"
)


@app.middleware("http")
async def verify_service_token(request: Request, call_next):
    # Allow health check without token
    if request.url.path in ["/", "/health", "/docs", "/openapi.json"]:
        return await call_next(request)

    token = request.headers.get("X-Service-Token")
    if not token or token != settings.SERVICE_TOKEN:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Unauthorized: Invalid or missing X-Service-Token header."}
        )

    response = await call_next(request)
    return response


@app.get("/")
def root():
    return {
        "service": "Dedicated AI & RAG Service",
        "status": "healthy",
        "version": "1.0.0",
        "docs_url": "/docs",
        "health_url": "/health",
        "message": "Internal AI microservice for Laravel control plane. Visit http://localhost:5173 for the web application portal."
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ai_service",
        "version": "1.0.0",
        "ollama_url": settings.OLLAMA_BASE_URL
    }


app.include_router(ai_router)
app.include_router(rag_router)
app.include_router(agent_router)
app.include_router(sql_router)
app.include_router(data_router)
app.include_router(media_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ai_service.app.main:app", host=settings.HOST, port=settings.PORT, reload=False)
