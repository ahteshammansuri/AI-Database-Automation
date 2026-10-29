import json
import re
import threading
import time
from typing import Dict, Any, List, Optional, Tuple
import httpx

from ai_service.app import usage
from ai_service.app.providers.base import BaseAIProvider, ProviderError, ProviderHTTPError, ProviderUnavailableError
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


def _structured_system(system_prompt: str, target_table: str, required_fields: List[str], field_contract: Optional[str]) -> str:
    """System prompt for record generation: the precise field contract when the control plane sent one."""
    if field_contract:
        return f"{system_prompt}\nYou are writing one new record for the '{target_table}' table.\n{field_contract}"
    return (
        f"{system_prompt}\nTarget table: '{target_table}'. You MUST respond with ONLY a valid JSON object "
        f"matching these fields: {', '.join(required_fields)}."
    )


def _schema_instruction(json_schema: Dict[str, Any]) -> str:
    return (
        "\n\nRespond with ONLY one JSON object (no prose, no markdown) that validates against this JSON schema:\n"
        + json.dumps(json_schema, separators=(",", ":"))
    )


def _split_system(messages: List[Dict[str, str]], json_schema: Dict[str, Any]):
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system") + _schema_instruction(json_schema)
    convo = [m for m in messages if m["role"] != "system"]
    return system, convo


# Models seen unavailable recently (process-wide): model -> (until, reason). A model that is out of quota, overloaded,
# missing or stalled is skipped for a while instead of being retried with back-off on every request.
_COOLDOWN: Dict[str, Tuple[float, str]] = {}
_COOLDOWN_LOCK = threading.Lock()


def cooldown_reason(model: str) -> Optional[str]:
    with _COOLDOWN_LOCK:
        until, reason = _COOLDOWN.get(model, (0.0, ""))
        if until > time.monotonic():
            return reason
        _COOLDOWN.pop(model, None)
        return None


def cool_down(model: str, seconds: float, reason: str) -> None:
    with _COOLDOWN_LOCK:
        _COOLDOWN[model] = (time.monotonic() + seconds, reason)


def reset_cooldowns() -> None:
    with _COOLDOWN_LOCK:
        _COOLDOWN.clear()


def cooldown_for(status: int, detail: str) -> Optional[Tuple[float, str]]:
    """How long to skip a model after this HTTP error, and why; None when it is not about the model's availability."""
    text = (detail or "").lower()
    if status == 429 and ("quota" in text or "billing" in text):
        return 900.0, "its quota is used up"
    if status == 429:
        return 60.0, "rate limited"
    if status in (500, 502, 503, 504):
        return 60.0, "busy (high demand)"
    if status == 404:
        return 6 * 3600.0, "not available for this key"
    return None


def _http_error(res: httpx.Response, label: str) -> ProviderHTTPError:
    detail = ""
    try:
        detail = (res.json().get("error") or {}).get("message", "") or ""
    except Exception:
        detail = res.text[:150]
    msg = f"{label} returned HTTP {res.status_code}" + (f": {detail}" if detail else ".")
    return ProviderHTTPError(msg, status=res.status_code, detail=detail)


def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: float, label: str,
               retries: int = 3) -> Dict[str, Any]:
    """
    POST and return the JSON body. Transient errors are retried with a short back-off (`retries` times); a quota error
    is never retried (it will not recover within the request), and callers with fallbacks pass retries=0.
    """
    backoff = 1.5
    for attempt in range(retries + 1):
        last = attempt == retries
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            if last:
                raise ProviderError(f"{label} did not answer within {int(timeout)}s.")
            time.sleep(backoff)
            backoff *= 1.5
            continue
        except httpx.HTTPError as e:
            if last:
                raise ProviderUnavailableError(f"{label} is not reachable ({type(e).__name__}).")
            time.sleep(backoff)
            backoff *= 1.5
            continue

        if res.status_code in (401, 403):
            raise ProviderUnavailableError(f"{label} rejected the configured API key (HTTP {res.status_code}).")
        if res.status_code == 200:
            return res.json()
        err = _http_error(res, label)
        quota = res.status_code == 429 and any(w in err.detail.lower() for w in ("quota", "billing"))
        if res.status_code in (503, 429, 502, 504) and not quota and not last:
            time.sleep(backoff)
            backoff *= 1.5
            continue
        raise err
    raise ProviderError(f"{label} failed after {retries} retries.")


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

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, max_output_tokens=None, **_) -> str:
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
                **({"max_tokens": int(max_output_tokens)} if max_output_tokens else {}),
            },
            timeout,
            "OpenAI",
        )
        usage.record_openai(self.model_name, data)
        return _clean_json_output(data["choices"][0]["message"]["content"] or "")


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("OpenAI API key is not configured for this user workspace.")

        full_system = _structured_system(system_prompt, target_table, required_fields, kwargs.get("field_contract"))
        if rejection_feedback:
            full_system += f"\nIMPORTANT: Prior version was rejected with feedback: '{rejection_feedback}'. Address this thoroughly."
        if kwargs.get("recent_titles"):
            full_system += "\nDo not repeat or closely imitate these recent titles: " + "; ".join(kwargs["recent_titles"][:10]) + "."

        payload = {
            "model": self.model_name,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": full_system},
                {"role": "user", "content": prompt}
            ],
            "temperature": kwargs.get("temperature") if kwargs.get("temperature") is not None else 0.7
        }

        with httpx.Client(timeout=180.0) as client:
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
            usage.record_openai(self.model_name, data, "generate")
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

    FALLBACKS = ("gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash")
    # A model that has not answered in this long while another one could is given up for this request.
    STALL_SECONDS = 45.0

    def _call(self, payload: Dict[str, Any], timeout: float, kind: str, deadline: Optional[float] = None) -> Tuple[str, Dict[str, Any]]:
        """
        generateContent with the chosen model first, then the fallbacks. A model that is out of quota, overloaded,
        missing or stalled is skipped at once (and for a while afterwards) instead of being retried with back-off;
        why another model answered is noted for the user. Returns (model that answered, response).
        """
        chain = [self.model_name] + [m for m in self.FALLBACKS if m != self.model_name]
        ready = [m for m in chain if not cooldown_reason(m)] or chain
        for m in chain:
            if m not in ready and m == self.model_name:
                usage.note(f"{m}: {cooldown_reason(m)}")
        last_err: Optional[Exception] = None
        for i, mod in enumerate(ready):
            is_last = i == len(ready) - 1
            budget = timeout if deadline is None else max(5.0, min(timeout, deadline - time.monotonic()))
            per_call = budget if is_last else min(budget, self.STALL_SECONDS)
            try:
                data = _post_json(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{mod}:generateContent",
                    {"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                    payload, per_call, f"Gemini ({mod})", retries=1 if is_last else 0,
                )
            except ProviderHTTPError as e:
                last_err = e
                cool = cooldown_for(e.status, e.detail)
                if cool is None:
                    raise
                cool_down(mod, *cool)
                if mod == self.model_name:
                    usage.note(f"{mod}: {cool[1]}")
                continue
            except ProviderUnavailableError:
                raise
            except ProviderError as e:  # stalled
                last_err = e
                cool_down(mod, 120.0, "too slow to answer")
                if mod == self.model_name:
                    usage.note(f"{mod}: too slow to answer")
                if is_last:
                    raise
                continue
            usage.record_gemini(mod, data, kind)
            if mod != self.model_name:
                usage.note(f"answered with {mod}")
            return mod, data
        if last_err:
            raise last_err
        raise ProviderError("Gemini failed across all candidate models.")

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, max_output_tokens=None, **_) -> str:
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
            "generationConfig": {"responseMimeType": "application/json", "temperature": temperature,
                                 **({"maxOutputTokens": int(max_output_tokens)} if max_output_tokens else {})},
        }

        _, data = self._call(payload, timeout, "chat", deadline)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text.strip():
            raise ProviderError("Gemini returned an empty answer.")
        return _clean_json_output(text)


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Gemini API key is not configured for this user workspace.")

        full_prompt = (
            _structured_system(system_prompt, target_table, required_fields, kwargs.get("field_contract"))
            + f"\n\nUser Topic / Prompt: {prompt}"
        )
        if kwargs.get("recent_titles"):
            full_prompt += "\nDo not repeat or closely imitate these recent titles: " + "; ".join(kwargs["recent_titles"][:10]) + "."

        if rejection_feedback:
            full_prompt += f"\n\nAddress reviewer feedback: '{rejection_feedback}'."

        payload = {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": kwargs.get("temperature") if kwargs.get("temperature") is not None else 0.7
            }
        }

        _, data = self._call(payload, 180.0, "generate")
        candidates_list = data.get("candidates", [])
        if not candidates_list:
            raise ProviderError("Gemini returned no content.")
        raw = "".join(p.get("text", "") for p in candidates_list[0].get("content", {}).get("parts", []) if not p.get("thought"))
        return json.loads(_clean_json_output(raw))


class ClaudeProvider(BaseAIProvider):
    """Anthropic Claude API Provider."""

    def __init__(self, api_key: str, model_name: str = "claude-haiku-5-5"):
        self.api_key = api_key.strip()
        self.model_name = model_name or "claude-haiku-5-5"

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
                        "model": self.model_name,
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
        return ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]

    def chat_structured(self, messages, json_schema, timeout: float = 120.0, temperature: float = 0.2, deadline=None, max_output_tokens=None, **_) -> str:
        if deadline is not None:
            timeout = max(5.0, min(timeout, deadline - time.monotonic()))
        if not self.api_key:
            raise ProviderUnavailableError("Anthropic API key is not configured for this workspace.")
        system, convo = _split_system(messages, json_schema)
        data = _post_json(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            {"model": self.model_name, "max_tokens": int(max_output_tokens or 1024), "system": system, "messages": convo, "temperature": min(1.0, temperature)},
            timeout,
            "Anthropic",
        )
        usage.record_anthropic(self.model_name, data)
        blocks = data.get("content", [])
        return _clean_json_output(blocks[0].get("text", "") if blocks else "")


    def generate_structured_data(
        self,
        prompt: str,
        system_prompt: str,
        target_table: str,
        required_fields: List[str],
        rejection_feedback: Optional[str] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Anthropic API key is not configured for this user workspace.")

        full_system = _structured_system(system_prompt, target_table, required_fields, kwargs.get("field_contract"))
        if rejection_feedback:
            full_system += f"\nIMPORTANT: Prior version was rejected with feedback: '{rejection_feedback}'. Address this thoroughly."
        if kwargs.get("recent_titles"):
            full_system += "\nDo not repeat or closely imitate these recent titles: " + "; ".join(kwargs["recent_titles"][:10]) + "."

        payload = {
            "model": self.model_name,
            "max_tokens": max(2048, int(kwargs.get("max_output_tokens") or 0)),
            "system": full_system,
            "messages": [
                {"role": "user", "content": f"{prompt}\nReturn JSON object with keys: {', '.join(required_fields)}."}
            ],
            **({"temperature": min(1.0, float(kwargs["temperature"]))} if kwargs.get("temperature") is not None else {}),
        }

        with httpx.Client(timeout=180.0) as client:
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
            usage.record_anthropic(self.model_name, data, "generate")
            content_blocks = data.get("content", [])
            raw = content_blocks[0]["text"] if content_blocks else "{}"
            parsed = json.loads(_clean_json_output(raw))
            return parsed
