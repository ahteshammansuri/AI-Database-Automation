from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional


class BaseAIProvider(ABC):
    """Abstract interface for LLM inference providers."""

    @abstractmethod
    def test_connection(self) -> Dict[str, Any]:
        """Verify provider availability and measure latency."""
        pass

    @abstractmethod
    def list_models(self) -> List[str]:
        """List available model names for this provider."""
        pass

    @abstractmethod
    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate structured dictionary payload strictly conforming to target schema fields.
        Must handle parsing, stripping markdown fences, and JSON validation.
        """
        pass
