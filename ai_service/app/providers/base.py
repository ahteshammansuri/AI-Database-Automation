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
        Generate structured dictionary payload conforming to target schema fields.
        Must handle parsing, stripping markdown fences, and JSON validation.
        """
        pass

    def plan_agent_turn(
        self,
        goal: str,
        context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        rag_chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Reason about natural language request, extract slots, and select tool/question.
        """
        raise NotImplementedError("Provider does not support plan_agent_turn")

    def synthesize_agent_response(
        self,
        goal: str,
        executed_steps: List[Dict[str, Any]],
        final_status: str,
        domain_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Generate a concise, truthful spoken response based on verified service outcomes.
        """
        raise NotImplementedError("Provider does not support synthesize_agent_response")
