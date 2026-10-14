from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.config import settings
from backend.app.logging_config import setup_logging
from backend.app.database import init_platform_db
from backend.app.api.v1.router import api_v1_router
from backend.app.scheduler.manager import scheduler_manager

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup sequence
    setup_logging()
    logger.info("Starting AI-Powered Database Automation Platform Backend...")
    logger.info(f"Environment: {settings.ENVIRONMENT} | Platform DB: {settings.PLATFORM_DATABASE_URL}")
    init_platform_db()
    logger.info("Platform database tables initialized successfully.")
    scheduler_manager.start()
    
    yield
    
    # Shutdown sequence
    logger.info("Shutting down AI-Powered Database Automation Platform Backend...")
    scheduler_manager.stop()



app = FastAPI(
    title="AI-Powered Database Automation Platform API",
    version="1.0.0",
    description="Backend API for database introspection, AI-assisted content generation, approval workflows, and safe scheduled execution.",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Consistent Error Handling
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": f"HTTP_{exc.status_code}",
                "message": exc.detail,
                "details": None
            }
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "VALIDATION_FAILED",
                "message": "The request payload failed schema validation.",
                "details": exc.errors()
            }
        }
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled server error: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected internal error occurred. Please consult system logs.",
                "details": None
            }
        }
    )


# Register API Routers
app.include_router(api_v1_router)


@app.get("/")
def root():
    return {
        "name": "AI-Powered Database Automation Platform",
        "version": "1.0.0",
        "docs_url": "/docs",
        "api_v1": "/api/v1"
    }
