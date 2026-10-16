import json
import re
import time
from typing import Dict, Any, List, Optional
import httpx
from ai_service.app.providers.base import BaseAIProvider, ProviderError, ProviderUnavailableError
from ai_service.app.providers.mock_provider import MockAIProvider


def _clean_json_output(raw_text: str) -> str:
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
        cleaned = cleaned[start_idx:end_idx + 1]
    return cleaned.strip()


def _schema_instruction(json_schema: Dict[str, Any]) -> str:
    return (
        "\n\nRespond with ONLY one JSON object (no prose, no markdown) that validates against this JSON schema:\n"
        + json.dumps(json_schema, separators=(",", ":"))
    )


def _split_system(messages: List[Dict[str, str]], json_schema: Dict[str, Any]):
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system") + _schema_instruction(json_schema)
    convo = [m for m in messages if m["role"] != "system"]
    return system, convo


def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: float, label: str) -> Dict[str, Any]:
    max_retries = 3
    backoff = 1.5
    last_res = None
    for attempt in range(max_retries + 1):
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(url, headers=headers, json=payload)
                last_res = res
        except httpx.TimeoutException:
            if attempt == max_retries:
                raise ProviderError(f"{label} did not answer within {int(timeout)}s.")
            time.sleep(backoff)
            backoff *= 1.5
            continue
        except httpx.HTTPError as e:
            if attempt == max_retries:
                raise ProviderUnavailableError(f"{label} is not reachable ({type(e).__name__}).")
            time.sleep(backoff)
            backoff *= 1.5
            continue

        if res.status_code in (401, 403):
            raise ProviderUnavailableError(f"{label} rejected the configured API key (HTTP {res.status_code}).")

        # Retry on transient capacity/rate errors (503 High Demand / 429 Rate Limit / 502 / 504)
        if res.status_code in (503, 429, 502, 504) and attempt < max_retries:
            time.sleep(backoff)
            backoff *= 1.5
            continue

        if res.status_code != 200:
            detail = ""
            try:
                err_data = res.json()
                detail = err_data.get("error", {}).get("message", "")
            except Exception:
                detail = res.text[:150]
            msg = f"{label} returned HTTP {res.status_code}" + (f": {detail}" if detail else ".")
            raise ProviderError(msg)

        return res.json()

    if last_res is not None and last_res.status_code != 200:
        detail = ""
        try:
            err_data = last_res.json()
            detail = err_data.get("error", {}).get("message", "")
        except Exception:
            detail = last_res.text[:150]
        msg = f"{label} returned HTTP {last_res.status_code}" + (f": {detail}" if detail else ".")
        raise ProviderError(msg)
    raise ProviderError(f"{label} failed after {max_retries} retries.")


class OpenAIProvider(BaseAIProvider):
    """Real OpenAI adapter using Chat Completions with JSON mode."""

    def __init__(self, api_key: str, model_name: str = "gpt-4o-mini"):
        self.api_key = api_key.strip()
        self.model_name = model_name or "gpt-4o-mini"

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key or len(self.api_key) < 15:
            return {
                "available": False,
                "latency_ms": 0.0,
                "models": [],
                "message": "OpenAI API key is missing or invalid format."
            }

        start = time.time()
        try:
            with httpx.Client(timeout=6.0) as client:
                res = client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("id") for m in data.get("data", []) if "gpt" in m.get("id", "")]
                    return {
                        "available": True,
                        "latency_ms": latency_ms,
                        "models": models[:10],
                        "message": f"Successfully verified OpenAI API credentials ({len(models)} models available)."
                    }
                elif res.status_code == 401:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": "OpenAI rejected credentials: Invalid or revoked API key."
                    }
                else:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": f"OpenAI error {res.status_code}: {res.text[:150]}"
                    }
        except Exception as e:
            return {
                "available": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Connection to OpenAI failed: {str(e)}"
            }

    def list_models(self) -> List[str]:
        return ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, **_) -> str:
        if deadline is not None:
            timeout = max(5.0, min(timeout, deadline - time.monotonic()))
        if not self.api_key:
            raise ProviderUnavailableError("OpenAI API key is not configured for this workspace.")
        system, convo = _split_system(messages, json_schema)
        data = _post_json(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            {
                "model": self.model_name,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}] + convo,
                "temperature": temperature,
            },
            timeout,
            "OpenAI",
        )
        return _clean_json_output(data["choices"][0]["message"]["content"] or "")


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("OpenAI API key is not configured for this user workspace.")

        full_system = f"{system_prompt}\nTarget table: '{target_table}'. You MUST respond with ONLY a valid JSON object matching these fields: {', '.join(required_fields)}."
        if rejection_feedback:
            full_system += f"\nIMPORTANT: Prior version was rejected with feedback: '{rejection_feedback}'. Address this thoroughly."

        payload = {
            "model": self.model_name,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": full_system},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7
        }

        with httpx.Client(timeout=45.0) as client:
            res = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=payload
            )
            if res.status_code != 200:
                raise RuntimeError(f"OpenAI completion error ({res.status_code}): {res.text[:200]}")

            data = res.json()
            raw = data["choices"][0]["message"]["content"]
            parsed = json.loads(_clean_json_output(raw))
            return parsed


class GeminiProvider(BaseAIProvider):
    """Google Gemini API Provider."""

    def __init__(self, api_key: str, model_name: str = "gemini-3.5-flash-lite"):
        self.api_key = api_key.strip()
        raw = (model_name or "gemini-3.5-flash-lite").replace("models/", "").strip()
        # Auto-map deprecated / sunset or heavily overloaded Gemini models to active high-availability models
        if raw in ("gemini-1.5-flash", "gemini-2.5-flash", "gemini-1.0-pro", "gemini-1.5-pro", "gemini-2.5-pro", "gemini-2.5-flash-lite"):
            self.model_name = "gemini-3.5-flash-lite"
        else:
            self.model_name = raw

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key or len(self.api_key) < 15:
            return {
                "available": False,
                "latency_ms": 0.0,
                "models": [],
                "message": "Google Gemini API key is missing or invalid format."
            }

        start = time.time()
        try:
            with httpx.Client(timeout=6.0) as client:
                res = client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
                )
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name", "").replace("models/", "") for m in data.get("models", [])]
                    return {
                        "available": True,
                        "latency_ms": latency_ms,
                        "models": models[:10],
                        "message": f"Successfully verified Google Gemini API key ({len(models)} models)."
                    }
                elif res.status_code in [400, 403]:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": "Google Gemini authentication failed: Invalid API key or permission denied."
                    }
                else:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": f"Gemini error {res.status_code}: {res.text[:150]}"
                    }
        except Exception as e:
            return {
                "available": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Connection to Google Gemini failed: {str(e)}"
            }

    def list_models(self) -> List[str]:
        return ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"]

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, **_) -> str:
        if deadline is not None:
            timeout = max(5.0, min(timeout, deadline - time.monotonic()))
        if not self.api_key:
            raise ProviderUnavailableError("Gemini API key is not configured for this workspace.")
        system, convo = _split_system(messages, json_schema)
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in convo
        ]
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
        }

        # Candidate models with fast high-availability flash-lite fallback if primary hits 503 high demand / 429
        candidates = [self.model_name]
        for fb in ("gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"):
            if fb not in candidates:
                candidates.append(fb)

        last_err = None
        for mod in candidates:
            try:
                data = _post_json(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{mod}:generateContent",
                    {"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                    payload,
                    timeout,
                    f"Gemini ({mod})",
                )
                parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                text = parts[0].get("text", "") if parts else ""
                if text.strip():
                    return _clean_json_output(text)
            except Exception as e:
                last_err = e
                # Fall through to next candidate if model is overloaded (503), rate limited (429), or deprecated (404)
                if any(code in str(e) for code in ("503", "429", "404", "high demand", "UNAVAILABLE")):
                    continue
                raise

        if last_err:
            raise last_err
        raise ProviderError("Gemini failed across all candidate models.")


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Gemini API key is not configured for this user workspace.")

        full_prompt = (
            f"{system_prompt}\nTarget table: '{target_table}'. You MUST respond with ONLY a valid JSON object matching these fields: {', '.join(required_fields)}.\n\n"
            f"User Topic / Prompt: {prompt}"
        )
        if rejection_feedback:
            full_prompt += f"\n\nAddress reviewer feedback: '{rejection_feedback}'."

        payload = {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.7
            }
        }

        candidates = [self.model_name]
        for fb in ("gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"):
            if fb not in candidates:
                candidates.append(fb)

        last_err = None
        for mod in candidates:
            try:
                data = _post_json(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{mod}:generateContent",
                    {"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                    payload,
                    45.0,
                    f"Gemini ({mod})",
                )
                candidates_list = data.get("candidates", [])
                if not candidates_list:
                    continue

                raw = candidates_list[0]["content"]["parts"][0]["text"]
                return json.loads(_clean_json_output(raw))
            except Exception as e:
                last_err = e
                if any(code in str(e) for code in ("503", "429", "404", "high demand", "UNAVAILABLE")):
                    continue
                raise

        if last_err:
            raise last_err
        raise RuntimeError("Gemini structured data generation failed.")


class ClaudeProvider(BaseAIProvider):
    """Anthropic Claude API Provider."""

    def __init__(self, api_key: str, model_name: str = "claude-3-5-haiku-latest"):
        self.api_key = api_key.strip()
        self.model_name = model_name or "claude-3-5-haiku-latest"

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key or len(self.api_key) < 15:
            return {
                "available": False,
                "latency_ms": 0.0,
                "models": [],
                "message": "Anthropic Claude API key is missing or invalid format."
            }

        start = time.time()
        try:
            # Send a minimal 1-token query to verify authentication
            with httpx.Client(timeout=6.0) as client:
                res = client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": "claude-3-haiku-20240307",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}]
                    }
                )
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code in [200, 400]:
                    return {
                        "available": True,
                        "latency_ms": latency_ms,
                        "models": self.list_models(),
                        "message": "Successfully verified Anthropic Claude credentials."
                    }
                elif res.status_code == 401:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": "Anthropic rejected credentials: Invalid API key."
                    }
                else:
                    return {
                        "available": False,
                        "latency_ms": latency_ms,
                        "models": [],
                        "message": f"Anthropic error {res.status_code}: {res.text[:150]}"
                    }
        except Exception as e:
            return {
                "available": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Connection to Anthropic failed: {str(e)}"
            }

    def list_models(self) -> List[str]:
        return ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"]

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, **_) -> str:
        if deadline is not None:
            timeout = max(5.0, min(timeout, deadline - time.monotonic()))
        if not self.api_key:
            raise ProviderUnavailableError("Anthropic API key is not configured for this workspace.")
        system, convo = _split_system(messages, json_schema)
        data = _post_json(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            {"model": self.model_name, "max_tokens": 1024, "system": system, "messages": convo, "temperature": temperature},
            timeout,
            "Anthropic",
        )
        blocks = data.get("content", [])
        return _clean_json_output(blocks[0].get("text", "") if blocks else "")


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Anthropic API key is not configured for this user workspace.")

        full_system = f"{system_prompt}\nTarget table: '{target_table}'. You MUST respond with ONLY a valid JSON object matching these fields: {', '.join(required_fields)}."
        if rejection_feedback:
            full_system += f"\nIMPORTANT: Prior version was rejected with feedback: '{rejection_feedback}'. Address this thoroughly."

        payload = {
            "model": self.model_name,
            "max_tokens": 2048,
            "system": full_system,
            "messages": [
                {"role": "user", "content": f"{prompt}\nReturn JSON object with keys: {', '.join(required_fields)}."}
            ]
        }

        with httpx.Client(timeout=45.0) as client:
            res = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json=payload
            )
            if res.status_code != 200:
                raise RuntimeError(f"Claude generation error ({res.status_code}): {res.text[:200]}")

            data = res.json()
            content_blocks = data.get("content", [])
            raw = content_blocks[0]["text"] if content_blocks else "{}"
            parsed = json.loads(_clean_json_output(raw))
            return parsed
