from typing import List, Dict, Any, Optional
from backend.app.config import settings
from backend.app.ai.base import BaseAIProvider
from backend.app.ai.ollama_provider import OllamaProvider
from backend.app.ai.mock_provider import MockAIProvider
from backend.app.ai.cloud_stubs import OpenAIProvider, GeminiProvider, AnthropicProvider
from backend.app.schemas.ai import AIProviderInfo


def get_ai_provider(provider_id: Optional[str] = None) -> BaseAIProvider:
    """Return the requested AI provider or default configured provider."""
    target_id = (provider_id or settings.DEFAULT_AI_PROVIDER).lower().strip()

    if target_id == "ollama":
        return OllamaProvider()
    elif target_id == "mock":
        return MockAIProvider()
    elif target_id == "openai":
        return OpenAIProvider()
    elif target_id == "gemini":
        return GeminiProvider()
    elif target_id == "anthropic":
        return AnthropicProvider()
    else:
        # Default fallback to mock provider for local demo resilience
        return MockAIProvider()


def get_all_providers_info() -> List[AIProviderInfo]:
    """Inspect and return metadata for all supported AI providers."""
    providers_info: List[AIProviderInfo] = []

    # 1. Ollama (Primary local)
    ollama = OllamaProvider()
    ollama_check = ollama.test_connection()
    providers_info.append(AIProviderInfo(
        provider_id="ollama",
        name="Ollama (Primary Local)",
        is_available=ollama_check["available"],
        is_local=True,
        requires_api_key=False,
        is_configured=True,
        available_models=ollama_check.get("models", [settings.OLLAMA_MODEL]),
        current_model=settings.OLLAMA_MODEL,
        status_message=ollama_check["message"]
    ))

    # 2. Local Mock (Testing / Offline demo)
    mock = MockAIProvider()
    mock_check = mock.test_connection()
    providers_info.append(AIProviderInfo(
        provider_id="mock",
        name="Local Mock / Test Generator",
        is_available=True,
        is_local=True,
        requires_api_key=False,
        is_configured=True,
        available_models=mock.list_models(),
        current_model="mock-llama3-synthetic",
        status_message="Ready for offline testing and deterministic demonstration."
    ))

    # 3. OpenAI (Optional cloud)
    openai = OpenAIProvider()
    openai_check = openai.test_connection()
    providers_info.append(AIProviderInfo(
        provider_id="openai",
        name="OpenAI (Optional Cloud)",
        is_available=openai_check["available"],
        is_local=False,
        requires_api_key=True,
        is_configured=openai.is_configured(),
        available_models=["gpt-4o-mini", "gpt-4o"],
        current_model=settings.OPENAI_MODEL,
        status_message=openai_check["message"]
    ))

    # 4. Google Gemini (Optional cloud)
    gemini = GeminiProvider()
    gemini_check = gemini.test_connection()
    providers_info.append(AIProviderInfo(
        provider_id="gemini",
        name="Google Gemini (Optional Cloud)",
        is_available=gemini_check["available"],
        is_local=False,
        requires_api_key=True,
        is_configured=gemini.is_configured(),
        available_models=["gemini-1.5-flash", "gemini-1.5-pro"],
        current_model=settings.GEMINI_MODEL,
        status_message=gemini_check["message"]
    ))

    # 5. Anthropic Claude (Optional cloud)
    anthropic = AnthropicProvider()
    anthropic_check = anthropic.test_connection()
    providers_info.append(AIProviderInfo(
        provider_id="anthropic",
        name="Anthropic Claude (Optional Cloud)",
        is_available=anthropic_check["available"],
        is_local=False,
        requires_api_key=True,
        is_configured=anthropic.is_configured(),
        available_models=["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
        current_model=settings.ANTHROPIC_MODEL,
        status_message=anthropic_check["message"]
    ))

    return providers_info
