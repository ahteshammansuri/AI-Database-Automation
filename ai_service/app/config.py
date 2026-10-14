import os
from pydantic import BaseModel


class Settings(BaseModel):
    PORT: int = int(os.getenv("AI_SERVICE_PORT", "8001"))
    HOST: str = os.getenv("AI_SERVICE_HOST", "0.0.0.0")
    SERVICE_TOKEN: str = os.getenv("AI_SERVICE_KEY", "platform_secret_internal_key_2026")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "llama3:latest")
    INDEX_DIR: str = os.getenv("AI_INDEX_DIR", "ai_service/storage/indexes")


settings = Settings()
