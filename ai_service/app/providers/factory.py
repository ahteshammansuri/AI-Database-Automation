from typing import Optional
from ai_service.app.providers.base import BaseAIProvider, ProviderUnsupportedError
from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.providers.ollama_provider import OllamaProvider
from ai_service.app.providers.cloud_providers import OpenAIProvider, GeminiProvider, ClaudeProvider
from ai_service.app.config import settings


class AIProviderFactory:
    """Instantiates the appropriate AI provider instance without silent fallbacks."""

    @staticmethod
    def get_provider(
        provider_name: str = "ollama",
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> BaseAIProvider:
        name = (provider_name or "ollama").lower()

        if name == "mock":
            if not settings.ALLOW_MOCK_PROVIDER:
                raise ProviderUnsupportedError("The test-only placeholder provider is not available. Choose Ollama, OpenAI, Gemini or Claude.")
            return MockAIProvider(model_name=model or "mock-llama3-synthetic")

        if name == "ollama":
            # Return genuine Ollama provider; errors are surfaced transparently to caller
            return OllamaProvider(model=model or settings.OLLAMA_MODEL)

        if name == "openai":
            return OpenAIProvider(
                api_key=api_key or "",
                model_name=model or "gpt-4o-mini"
            )

        if name == "gemini":
            return GeminiProvider(
                api_key=api_key or "",
                model_name=model or "gemini-1.5-flash"
            )

        if name in ["anthropic", "claude"]:
            return ClaudeProvider(
                api_key=api_key or "",
                model_name=model or "claude-haiku-5-5"
            )

        raise ProviderUnsupportedError(f"Unknown AI provider '{name}'.")
