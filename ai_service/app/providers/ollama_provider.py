import json
import logging
import re
import threading
import time
from typing import Dict, Any, List, Optional
import httpx

from ai_service.app import usage
from ai_service.app.providers.base import (
    BaseAIProvider,
    ProviderError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from ai_service.app.config import settings

logger = logging.getLogger(__name__)


class OllamaProvider(BaseAIProvider):
    """Primary local inference provider via Ollama."""

    def __init__(self, base_url: str = None, model: str = None):
        self.base_url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/")
        requested_model = model.strip() if model and model != "default" else None
        self.model = requested_model or self._resolve_best_model()

    def _resolve_best_model(self) -> str:
        """Dynamically detect installed models, preferring lightweight models for fast CPU inference."""
        try:
            with httpx.Client(timeout=4.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    models = [m.get("name") for m in res.json().get("models", [])]
                    for preferred in ["llama3.2:1b", "llama3.2:3b", "llama3.2:latest", "llama3:latest", "llama3"]:
                        for m in models:
                            if m == preferred or m.startswith(f"{preferred}:"):
                                return m
                    if models:
                        return models[0]
        except Exception:
            pass
        return settings.OLLAMA_MODEL

    def test_connection(self) -> Dict[str, Any]:
        start = time.time()
        try:
            with httpx.Client(timeout=5.0) as client:
                res = client.get(f"{self.base_url}/api/tags")
                latency_ms = round((time.time() - start) * 1000, 2)
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name") for m in data.get("models", [])]

                    # Auto-resolve target model if 'default' or unconfigured and models exist
                    target_model = self.model
                    if (not target_model or target_model == "default") and models:
                        target_model = self._resolve_best_model()
                        self.model = target_model

                    if not models:
                        return {
                            "available": False,
                            "daemon_running": True,
                            "model_installed": False,
                            "latency_ms": latency_ms,
                            "models": [],
                            "message": "Ollama service is online, but no models are installed. Run 'ollama pull llama3.2:1b' to install a model."
                        }

                    # Check if requested model or a tag variation is installed
                    model_found = any(
                        target_model == m or
                        f"{target_model}:latest" == m or
                        m.startswith(f"{target_model}:") or
                        (target_model.endswith(":latest") and target_model.replace(":latest", "") == m)
                        for m in models
                    ) if target_model else True

                    if not model_found:
                        return {
                            "available": False,
                            "daemon_running": True,
                            "model_installed": False,
                            "latency_ms": latency_ms,
                            "models": models,
                            "message": f"Ollama is running, but model '{target_model}' is not installed. Run 'ollama pull {target_model}' or pick one of: {', '.join(models)}."
                        }

                    return {
                        "available": True,
                        "daemon_running": True,
                        "model_installed": True,
                        "latency_ms": latency_ms,
                        "models": models,
                        "message": f"Connected to local Ollama. Model '{target_model}' is installed and ready."
                    }
                return {
                    "available": False,
                    "daemon_running": False,
                    "model_installed": False,
                    "latency_ms": latency_ms,
                    "models": [],
                    "message": f"Ollama returned HTTP status {res.status_code}"
                }
        except httpx.ConnectError:
            return {
                "available": False,
                "daemon_running": False,
                "model_installed": False,
                "latency_ms": round((time.time() - start) * 1000, 2),
                "models": [],
                "message": f"Ollama is offline. Ensure 'ollama serve' is running at {self.base_url}"
            }
        except Exception as e:
            return {
                "available": False,
                "daemon_running": False,
                "model_installed": False,
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
        rejection_feedback: Optional[str] = None,
        schema_constraints: Optional[Dict[str, Any]] = None,
        relation_catalog: Optional[Dict[str, Any]] = None,
        recent_titles: Optional[List[str]] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        schema_hints = []
        for f in required_fields:
            lf = f.lower()
            c = (schema_constraints or {}).get(f, {})
            max_len = c.get("max_length")
            enums = c.get("enum_values") or []

            if enums:
                schema_hints.append(f'"{f}": "one of: {enums}"')
            elif relation_catalog and f in relation_catalog and relation_catalog[f].get("values"):
                vals = relation_catalog[f]["values"][:8]
                schema_hints.append(f'"{f}": "reference name from: {vals}"')
            elif "title" in lf:
                len_note = f" (max {max_len} chars)" if max_len else ""
                schema_hints.append(f'"{f}": "Engaging, catchy title matching topic{len_note}"')
            elif lf == "slug":
                schema_hints.append(f'"{f}": "url-friendly-slug-matching-title"')
            elif lf in ["excerpt", "short_description", "summary"]:
                len_note = f" (max {max_len} chars)" if max_len else " (1-2 sentences)"
                schema_hints.append(f'"{f}": "{len_note}"')
            elif lf in ["content", "description", "body"]:
                schema_hints.append(f'"{f}": "Full comprehensive rich markdown article drawing from the retrieved knowledge"')
            elif "keyword" in lf or "tags" in lf:
                schema_hints.append(f'"{f}": "comma, separated, topic, keywords"')
            elif any(k in lf for k in ("banner", "image", "img", "thumbnail", "cover", "photo")):
                # Images are produced by the image pipeline; the text model must never invent URLs.
                schema_hints.append(f'"{f}": ""')
            else:
                schema_hints.append(f'"{f}": "relevant dynamic value"')

        field_contract = kwargs.get("field_contract")
        if field_contract:
            full_system = f"{system_prompt}\nYou are writing one new record for the '{target_table}' table.\n{field_contract}"
        else:
            schema_json_format = "{\n  " + ",\n  ".join(schema_hints) + "\n}"
            full_system = (
                f"{system_prompt}\n"
                f"You are generating dynamic content for target table '{target_table}'.\n"
                f"You MUST generate a complete, valid JSON object matching EXACTLY these required fields:\n"
                f"{schema_json_format}\n"
                f"Ensure all content is dynamic, informative, and incorporates the topic and any retrieved knowledge context provided."
            )
        if rejection_feedback:
            full_system += f"\nIMPORTANT - Previous version was rejected with feedback: '{rejection_feedback}'. Address this feedback completely in your new generation."
        if recent_titles:
            recent_str = ", ".join([f"'{t}'" for t in recent_titles[:10]])
            full_system += f"\nAVOID DUPLICATION - Do NOT repeat or closely imitate these recently published titles: [{recent_str}]."

        budget = int(kwargs.get("max_output_tokens") or 450)
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": full_system,
            "format": "json",
            "stream": False,
            "keep_alive": "30m",
            "options": {
                "temperature": kwargs.get("temperature") if kwargs.get("temperature") is not None else 0.7,
                "num_predict": budget,
                # Room for system contract + RAG context + the answer without silent truncation,
                # but no larger than needed (a bigger window costs memory and prompt-eval time on CPU).
                "num_ctx": 4096 if budget + (len(full_system) + len(prompt)) // 3 + 256 <= 4096 else 8192,
            }
        }

        with httpx.Client(timeout=600.0) as client:
            res = client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Ollama generation failed with status {res.status_code}: {res.text}")

            response_json = res.json()
            usage.record_ollama(self.model, response_json, "generate")
            raw_response = response_json.get("response", "{}")

            cleaned = self._clean_json_output(raw_response)
            try:
                parsed = json.loads(cleaned)
            except Exception as json_err:
                raise ValueError(f"Model output did not parse into valid JSON: {str(json_err)}\nRaw output: {raw_response[:300]}")

            if not isinstance(parsed, dict):
                raise ValueError("Model output did not parse into a JSON object dictionary.")

            # Missing fields are left missing: the caller reports them instead of publishing invented filler.

            # Schema constraint post-validation & coercion
            if schema_constraints:
                for field, val in list(parsed.items()):
                    if field in schema_constraints:
                        c = schema_constraints[field]
                        enums = c.get("enum_values") or []
                        max_len = c.get("max_length")
                        if enums and str(val) not in [str(e) for e in enums]:
                            parsed[field] = enums[0]
                        if max_len and isinstance(parsed[field], str) and len(parsed[field]) > max_len:
                            parsed[field] = parsed[field][:max_len]

            return parsed

    # ------------------------------------------------------------------
    # Agent loop: structured chat
    # ------------------------------------------------------------------

    def _installed_models(self, timeout: float = 5.0) -> List[str]:
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.get(f"{self.base_url}/api/tags")
        except httpx.HTTPError as e:
            raise ProviderUnavailableError(f"Ollama is not reachable at {self.base_url} ({type(e).__name__}).")
        if res.status_code != 200:
            raise ProviderUnavailableError(f"Ollama returned HTTP {res.status_code} when listing models.")
        return [m.get("name", "") for m in res.json().get("models", [])]

    def _assert_model_installed(self) -> None:
        if getattr(self, "_model_verified", False):
            return
        models = self._installed_models()
        wanted = self.model
        found = any(
            m == wanted or m == f"{wanted}:latest" or (wanted.endswith(":latest") and m == wanted[:-7])
            for m in models
        )
        if not found:
            installed = ", ".join(models) or "none"
            raise ProviderUnavailableError(
                f"Ollama model '{wanted}' is not installed (installed: {installed}). "
                f"Run 'ollama pull {wanted}' or select an installed model in AI Providers."
            )
        self._model_verified = True

    def _stream_chat(self, payload: Dict[str, Any], ttft: float, idle: float, deadline: float) -> Dict[str, Any]:
        """
        Stream a chat response. A watchdog closes the connection if the first token takes
        longer than `ttft`, if no chunk arrives for `idle` seconds, or once `deadline`
        (monotonic) passes. Closing the stream makes Ollama stop generating, so a timed-out
        request never keeps the model busy for the next one.
        """
        state = {"first": None, "last": time.monotonic(), "reason": None, "done": False}
        start = time.monotonic()
        content_parts: List[str] = []
        final: Dict[str, Any] = {}

        def watchdog(response: httpx.Response) -> None:
            while not state["done"]:
                time.sleep(0.5)
                now = time.monotonic()
                if now >= deadline:
                    state["reason"] = "deadline"
                elif state["first"] is None and now - start > ttft:
                    state["reason"] = "first_token"
                elif state["first"] is not None and now - state["last"] > idle:
                    state["reason"] = "idle"
                if state["reason"]:
                    try:
                        response.close()
                    except Exception:
                        pass
                    return

        try:
            with httpx.Client(timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=30.0)) as client:
                with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as res:
                    if res.status_code == 404:
                        raise ProviderUnavailableError(f"Ollama model '{self.model}' was not found.")
                    if res.status_code != 200:
                        raise ProviderError(f"Ollama chat returned HTTP {res.status_code}.")
                    dog = threading.Thread(target=watchdog, args=(res,), daemon=True)
                    dog.start()
                    try:
                        for line in res.iter_lines():
                            if not line:
                                continue
                            chunk = json.loads(line)
                            piece = (chunk.get("message") or {}).get("content", "")
                            now = time.monotonic()
                            if piece:
                                if state["first"] is None:
                                    state["first"] = now
                                content_parts.append(piece)
                            state["last"] = now
                            if chunk.get("done"):
                                final = chunk
                                break
                    finally:
                        state["done"] = True
        except (ProviderError,):
            raise
        except (httpx.HTTPError, json.JSONDecodeError, RuntimeError) as e:
            if not state["reason"]:
                if isinstance(e, httpx.ConnectError):
                    raise ProviderUnavailableError(f"Ollama is not reachable at {self.base_url}.")
                raise ProviderError(f"Ollama stream failed ({type(e).__name__}).")

        if state["reason"]:
            waited = int(time.monotonic() - start)
            raise ProviderTimeoutError({
                "deadline": f"The local model did not finish within the time budget ({waited}s); the request was cancelled.",
                "first_token": f"The local model did not start answering within {int(ttft)}s (it may be busy or the machine is overloaded).",
                "idle": f"The local model stopped producing output for {int(idle)}s; the request was cancelled.",
            }[state["reason"]])
        final["content"] = "".join(content_parts)
        usage.record_ollama(self.model, final)
        return final

    @staticmethod
    def _agent_ctx(messages: List[Dict[str, str]], json_schema: Dict[str, Any]) -> int:
        """
        Fixed context window for agent decisions. Changing num_ctx between requests makes
        Ollama reload the model and drop its cached prompt prefix, which costs minutes on a CPU.
        """
        chars = sum(len(m.get("content", "")) for m in messages)
        needed = int(chars / 3.5) + settings.AGENT_NUM_PREDICT + 256
        if needed <= settings.AGENT_NUM_CTX:
            return settings.AGENT_NUM_CTX
        if needed > settings.AGENT_NUM_CTX_MAX:
            logger.warning("Agent prompt (~%d tokens) exceeds AGENT_NUM_CTX_MAX=%d; the oldest text may be cut.",
                           needed, settings.AGENT_NUM_CTX_MAX)
            return settings.AGENT_NUM_CTX_MAX
        return ((needed + 1023) // 1024) * 1024

    def chat_structured(
        self,
        messages: List[Dict[str, str]],
        json_schema: Dict[str, Any],
        timeout: float = 120.0,
        temperature: float = 0.2,
        deadline: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
        **_: Any,
    ) -> str:
        self._assert_model_installed()
        payload = {
            "model": self.model,
            "messages": messages,
            "format": json_schema,
            "stream": True,
            "keep_alive": "30m",
            # Short JSON decisions; a smaller context lowers memory (and swap) pressure on CPU-only machines.
            "options": {"temperature": temperature, "num_ctx": self._agent_ctx(messages, json_schema), "num_predict": max_output_tokens or settings.AGENT_NUM_PREDICT},
        }
        deadline = deadline if deadline is not None else time.monotonic() + timeout
        data = self._stream_chat(payload, ttft=settings.AGENT_FIRST_TOKEN_TIMEOUT,
                                 idle=settings.AGENT_IDLE_TIMEOUT, deadline=deadline)
        content = data.get("content", "")
        if not content.strip():
            raise ProviderError("Ollama returned an empty response.")
        if data.get("done_reason") == "length":
            raise ProviderError("Ollama response was cut off (context or token limit reached).")
        return content

    @staticmethod
    def _clean_json_output(raw_text: str) -> str:
        """Strip markdown code blocks or wrapper text."""
        cleaned = raw_text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
            cleaned = cleaned[start_idx:end_idx + 1]
        return cleaned.strip()

