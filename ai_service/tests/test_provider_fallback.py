"""Gemini fallbacks: a model out of quota or overloaded is skipped at once and for a while, and the user is told why."""
import pytest

from ai_service.app import usage
from ai_service.app.providers import cloud_providers as cp
from ai_service.app.providers.base import ProviderHTTPError, ProviderError


@pytest.fixture(autouse=True)
def _clean():
    cp.reset_cooldowns()
    usage.begin()
    yield
    cp.reset_cooldowns()


def _answer(text='{"ok":true}'):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 3}}


def test_quota_error_falls_back_at_once_and_is_remembered(monkeypatch):
    calls = []

    def fake_post(url, headers, payload, timeout, label, retries=3):
        model = url.split("/models/")[1].split(":")[0]
        calls.append((model, retries, timeout))
        if model == "gemini-3.5-flash":
            raise ProviderHTTPError("quota", status=429, detail="You exceeded your current quota, please check your plan and billing details.")
        return _answer()

    monkeypatch.setattr(cp, "_post_json", fake_post)
    provider = cp.GeminiProvider(api_key="k" * 30, model_name="gemini-3.5-flash")

    assert provider.chat_structured([{"role": "user", "content": "hi"}], {"type": "object"}, timeout=120) == '{"ok":true}'
    assert [c[0] for c in calls] == ["gemini-3.5-flash", "gemini-3.5-flash-lite"]
    assert calls[0][1] == 0, "no back-off retries when another model can answer"
    assert calls[0][2] <= cp.GeminiProvider.STALL_SECONDS, "a model that stalls cannot use the whole budget"
    assert usage.notes() == ["gemini-3.5-flash: its quota is used up", "answered with gemini-3.5-flash-lite"]

    # Next request: the exhausted model is skipped without a call, and the user is still told why.
    calls.clear()
    usage.begin()
    provider.chat_structured([{"role": "user", "content": "hi"}], {"type": "object"}, timeout=120)
    assert [c[0] for c in calls] == ["gemini-3.5-flash-lite"]
    assert "gemini-3.5-flash: its quota is used up" in usage.notes()


def test_errors_that_are_not_about_availability_are_raised(monkeypatch):
    def fake_post(url, headers, payload, timeout, label, retries=3):
        raise ProviderHTTPError("bad request", status=400, detail="Request contains an invalid argument.")

    monkeypatch.setattr(cp, "_post_json", fake_post)
    provider = cp.GeminiProvider(api_key="k" * 30, model_name="gemini-3.5-flash")
    with pytest.raises(ProviderHTTPError):
        provider.chat_structured([{"role": "user", "content": "hi"}], {"type": "object"}, timeout=60)


def test_cooldown_reasons():
    assert cp.cooldown_for(429, "You exceeded your current quota")[1] == "its quota is used up"
    assert cp.cooldown_for(429, "Resource exhausted, try later")[1] == "rate limited"
    assert cp.cooldown_for(503, "high demand")[1] == "busy (high demand)"
    assert cp.cooldown_for(400, "invalid argument") is None


def test_quota_errors_are_never_retried(monkeypatch):
    sent = []

    class FakeResponse:
        status_code = 429
        text = ""

        def json(self):
            return {"error": {"message": "You exceeded your current quota"}}

    class FakeClient:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            sent.append(url)
            return FakeResponse()

    monkeypatch.setattr(cp.httpx, "Client", FakeClient)
    monkeypatch.setattr(cp.time, "sleep", lambda s: None)
    with pytest.raises(ProviderHTTPError):
        cp._post_json("https://example.test/x", {}, {}, 10, "Test", retries=3)
    assert len(sent) == 1
