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
        rejection_feedback: Optional[str] = None,
        schema_constraints: Optional[Dict[str, Any]] = None,
        relation_catalog: Optional[Dict[str, Any]] = None,
        recent_titles: Optional[List[str]] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        """
        Generate structured dictionary payload conforming to target schema fields.
        Must handle parsing, stripping markdown fences, and JSON validation.
        """
        pass

    def chat_structured(
        self,
        messages: List[Dict[str, str]],
        json_schema: Dict[str, Any],
        timeout: float = 120.0,
        temperature: float = 0.2,
        deadline: Optional[float] = None,
        **_: Any,
    ) -> str:
        """
        `deadline` is an absolute time.monotonic() value after which the call must give up
        (raising ProviderTimeoutError) so the caller can answer before its own client times out.

        Send a chat conversation and return the raw text of a single JSON object
        constrained by json_schema. Callers validate the result; providers must not
        repair or invent content themselves.

        Raises ProviderUnavailableError when the provider/model cannot be reached,
        ProviderUnsupportedError when structured chat is not implemented.
        """
        raise ProviderUnsupportedError(f"{type(self).__name__} does not support structured agent chat")


class ProviderError(Exception):
    """Base class for provider failures surfaced to the agent loop."""
    category = "PROVIDER_ERROR"


class ProviderHTTPError(ProviderError):
    """The provider answered with an HTTP error (status and the provider's own message kept for fallbacks)."""

    def __init__(self, message: str, status: int = 0, detail: str = ""):
        super().__init__(message)
        self.status = status
        self.detail = detail


class ProviderUnavailableError(ProviderError):
    """Provider daemon/API unreachable, or the selected model is not installed."""
    category = "MODEL_UNAVAILABLE"


class ProviderUnsupportedError(ProviderError):
    """Provider has no structured chat implementation for the agent loop."""
    category = "PROVIDER_UNSUPPORTED"


class ProviderTimeoutError(ProviderError):
    """The model did not finish in time (overloaded/slow machine). Nothing was produced."""
    category = "MODEL_BUSY_OR_SLOW"
