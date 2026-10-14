import json
import re
import time
from typing import Dict, Any, List, Optional
import httpx

from backend.app.ai.base import BaseAIProvider
from backend.app.config import settings


class OllamaProvider(BaseAIProvider):
    """Primary local inference provider via Ollama."""

    def __init__(self, base_url: str = None, model: str = None):
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        self.model = model or settings.OLLAMA_MODEL

    def test_connection(self) -> Dict[str, Any]:
        start = time.time()
        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name") for m in data.get("models", [])]
                    return {
                        "available": True,
                        "latency_ms": latency_ms,
                        "models": models,
                        "message": f"Connected to local Ollama. {len(models)} model(s) available."
                    }
                return {
                    "available": False,
                    "latency_ms": latency_ms,
                    "models": [],
                    "message": f"Ollama returned HTTP status {res.status_code}"
                }
        except httpx.ConnectError:
            return {
                "available": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Ollama is offline. Ensure 'ollama serve' is running at {self.base_url}"
            }
        except Exception as e:
            return {
                "available": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Ollama connection check failed: {str(e)}"
            }

    def list_models(self) -> List[str]:
        conn = self.test_connection()
        return conn.get("models", [])

    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        full_system = f"{system_prompt}\nTarget table: '{target_table}'. You MUST respond with ONLY a valid JSON object matching these fields: {', '.join(required_fields)}."
        if rejection_feedback:
            full_system += f"\nIMPORTANT - Previous version was rejected with feedback: '{rejection_feedback}'. Address this feedback completely in your new generation."

        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": full_system,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.7
            }
        }

        with httpx.Client(timeout=60.0) as client:
            res = client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Ollama generation failed with status {res.status_code}: {res.text}")

            response_json = res.json()
            raw_response = response_json.get("response", "{}")

            # Parse JSON safely
            cleaned = self._clean_json_output(raw_response)
            parsed = json.loads(cleaned)

            if not isinstance(parsed, dict):
                raise ValueError("Model output did not parse into a JSON object dictionary.")

            return parsed

    @staticmethod
    def _clean_json_output(raw_text: str) -> str:
        """Strip markdown code blocks or wrapper text."""
        cleaned = raw_text.strip()
        # Remove ```json ... ```
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        # Find first { and last }
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
            cleaned = cleaned[start_idx:end_idx + 1]
        return cleaned.strip()
