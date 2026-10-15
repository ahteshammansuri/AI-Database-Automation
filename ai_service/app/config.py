import os
from pydantic import BaseModel


class Settings(BaseModel):
    PORT: int = int(os.getenv("AI_SERVICE_PORT", "8001"))
    HOST: str = os.getenv("AI_SERVICE_HOST", "0.0.0.0")
    SERVICE_TOKEN: str = os.getenv("AI_SERVICE_KEY", "platform_secret_internal_key_2026")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    INDEX_DIR: str = os.getenv("AI_INDEX_DIR", "ai_service/storage/indexes")
    # One structured agent decision on a CPU-only machine can take minutes under load.
    AGENT_MODEL_TIMEOUT: float = float(os.getenv("AGENT_MODEL_TIMEOUT", "240"))
    AGENT_FIRST_TOKEN_TIMEOUT: float = float(os.getenv("AGENT_FIRST_TOKEN_TIMEOUT", "360"))
    AGENT_IDLE_TIMEOUT: float = float(os.getenv("AGENT_IDLE_TIMEOUT", "60"))
    AGENT_NUM_CTX: int = int(os.getenv("AGENT_NUM_CTX", "4096"))
    AGENT_MAX_TOOLS: int = int(os.getenv("AGENT_MAX_TOOLS", "18"))


settings = Settings()
