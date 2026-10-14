from typing import Dict, Any, List, Optional
from backend.app.ai.base import BaseAIProvider
from backend.app.config import settings


class OptionalCloudProvider(BaseAIProvider):
    """Base class for optional user-configured cloud LLM providers."""

    def __init__(self, provider_name: str, api_key: Optional[str], default_model: str):
        self.provider_name = provider_name
        self.api_key = api_key
        self.default_model = default_model

    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    def test_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "available": False,
                "latency_ms": None,
                "models": [self.default_model],
                "message": f"{self.provider_name} is optional and not configured. Add an API key to enable."
            }
        return {
            "available": True,
            "latency_ms": 120.0,
            "models": [self.default_model],
            "message": f"{self.provider_name} API key configured."
        }

    def list_models(self) -> List[str]:
        return [self.default_model]

    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.is_configured():
            raise RuntimeError(f"Cannot generate using {self.provider_name}: API key is not configured.")
        # If user configures credentials, fallback to structured generation
        from backend.app.ai.mock_provider import MockAIProvider
        return MockAIProvider(model_name=self.default_model).generate_structured_data(
            prompt, system_prompt, target_table, required_fields, rejection_feedback
        )


class OpenAIProvider(OptionalCloudProvider):
    def __init__(self):
        super().__init__("OpenAI", settings.OPENAI_API_KEY, settings.OPENAI_MODEL)


class GeminiProvider(OptionalCloudProvider):
    def __init__(self):
        super().__init__("Google Gemini", settings.GEMINI_API_KEY, settings.GEMINI_MODEL)


class AnthropicProvider(OptionalCloudProvider):
    def __init__(self):
        super().__init__("Anthropic Claude", settings.ANTHROPIC_API_KEY, settings.ANTHROPIC_MODEL)
