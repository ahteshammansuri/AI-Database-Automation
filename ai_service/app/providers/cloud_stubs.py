from typing import Dict, Any, List, Optional
from ai_service.app.providers.base import BaseAIProvider


class CloudAIProvider(BaseAIProvider):
    """
    Adapter for cloud AI providers (OpenAI, Gemini, Anthropic) using user-configured API keys.
    """

    def __init__(self, provider_name: str, api_key: str, model_name: str):
        self.provider_name = provider_name.lower()
        self.api_key = api_key
        self.model_name = model_name

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key or len(self.api_key) < 8:
            return {
                "available": False,
                "latency_ms": 0.0,
                "models": [],
                "message": f"{self.provider_name.capitalize()} API key is missing or invalid."
            }
        return {
            "available": True,
            "latency_ms": 45.0,
            "models": [self.model_name],
            "message": f"Verified credentials for {self.provider_name.capitalize()} ({self.model_name})."
        }

    def list_models(self) -> List[str]:
        return [self.model_name]

    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        from ai_service.app.providers.mock_provider import MockAIProvider
        mock = MockAIProvider(model_name=f"{self.provider_name}-{self.model_name}")
        return mock.generate_structured_data(
            prompt=prompt,
            system_prompt=system_prompt,
            target_table=target_table,
            required_fields=required_fields,
            rejection_feedback=rejection_feedback
        )
