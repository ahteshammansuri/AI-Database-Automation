import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Server settings
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:5173"
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    # Platform database (SQLite default for isolated zero-overhead local run)
    PLATFORM_DATABASE_URL: str = "sqlite:///./platform_data.db"

    # Security & Tokens
    SECRET_KEY: str = "insecure-dev-secret-key-change-me-in-production-32-bytes"
    TOKEN_EXPIRY_HOURS: int = 24

    # AI & LLM settings
    DEFAULT_AI_PROVIDER: str = "mock"  # "ollama" or "mock" for local demo
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2:latest"

    # Cloud providers (optional)
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = "claude-3-5-sonnet-20241022"

    # Email / SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: str = "automations@example.com"
    SMTP_USE_TLS: bool = False

    # Demo Customer MySQL connection defaults
    DEMO_MYSQL_HOST: str = "127.0.0.1"
    DEMO_MYSQL_PORT: int = 3308
    DEMO_MYSQL_USER: str = "root"
    DEMO_MYSQL_PASSWORD: str = "ipo_root_password"
    DEMO_MYSQL_DATABASE: str = "demo_blog_cms"

    # Storage paths
    STORAGE_DIR: str = "storage"
    UPLOADS_DIR: str = "storage/uploads"
    FAISS_INDEX_DIR: str = "storage/faiss_index"


settings = Settings()
