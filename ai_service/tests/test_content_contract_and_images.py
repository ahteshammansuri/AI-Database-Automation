import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.providers.mock_provider import MockAIProvider
from ai_service.app.services import content_contract as contract

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}

SPECS = [
    {"name": "title", "kind": "title", "max_length": 60, "required": True},
    {"name": "excerpt", "kind": "summary", "max_length": 200, "required": True},
    {"name": "content", "kind": "body", "required": True},
    {"name": "category_id", "kind": "relation_label", "entity": "category", "options": ["Databases", "Cloud"], "allow_new": True, "required": True},
    {"name": "status", "kind": "enum", "enum_values": ["draft", "published"], "required": True},
]


def test_contract_lists_every_field_with_limits_and_options():
    text = contract.build_field_contract(SPECS, "long")
    for name in ("title", "excerpt", "content", "category_id", "status"):
        assert f'"{name}"' in text
    assert "Maximum 60 characters" in text
    assert "About 1300 words" in text
    assert "Databases; Cloud" in text
    assert "propose a new, short category name" in text
    assert '"draft", "published"' in text
    assert "never invent URLs" in text


def test_token_budget_scales_with_body_length():
    assert contract.token_budget(SPECS, "long") > contract.token_budget(SPECS, "short")
    assert contract.token_budget([{"name": "t", "kind": "title"}], "long") < 600


def test_missing_and_normalize_never_fabricate():
    data = contract.normalize_values({"title": '  "Quoted"  ', "content": "", "junk": "x", "excerpt": None}, SPECS)
    assert data["title"] == "Quoted"
    assert "junk" not in data
    assert set(contract.missing_fields(data, SPECS)) == {"content", "excerpt", "category_id", "status"}


def test_generate_with_field_specs_returns_exactly_the_contracted_fields():
    res = client.post("/v1/ai/generate", headers=AUTH, json={
        "provider": "mock",
        "prompt": "Write one new post.\nTopic and direction: Zero downtime migrations",
        "target_table": "posts",
        "field_specs": SPECS,
        "length": "short",
    })
    body = res.json()
    assert body["success"] is True
    assert body["missing_fields"] == []
    assert set(body["data"]) == {"title", "excerpt", "content", "category_id", "status"}
    assert len(body["data"]["title"]) <= 60
    assert body["data"]["category_id"] == "Databases"
    assert body["data"]["status"] == "draft"
    assert "unsplash" not in str(body["data"]).lower()


def test_missing_fields_are_reported_after_one_repair_attempt(monkeypatch):
    calls = []

    def partial(self, prompt, system_prompt, target_table, required_fields, **kwargs):
        calls.append(list(required_fields))
        return {"title": "Only a title"}

    monkeypatch.setattr(MockAIProvider, "generate_structured_data", partial)
    res = client.post("/v1/ai/generate", headers=AUTH, json={
        "provider": "mock", "prompt": "x", "target_table": "posts", "field_specs": SPECS[:3],
    })
    body = res.json()
    assert body["success"] is True
    assert set(body["missing_fields"]) == {"excerpt", "content"}
    assert len(calls) == 2, "one repair pass, then honest report"
    assert calls[1] == ["excerpt", "content"]
    assert "excerpt" not in body["data"], "no placeholder text is invented"


def test_legacy_mock_generation_never_returns_stock_image_urls():
    res = client.post("/v1/ai/generate", headers=AUTH, json={
        "provider": "mock", "prompt": "topic: food", "target_table": "posts",
        "required_fields": ["title", "banner", "meta_img", "content"],
    })
    data = res.json()["data"]
    assert "banner" not in data and "meta_img" not in data


def test_local_designed_cover_has_exact_size_and_valid_png():
    for w, h in [(1600, 900), (1200, 630), (800, 800)]:
        res = client.post("/v1/ai/generate-image", headers=AUTH, json={
            "provider": "local", "prompt": "cover", "width": w, "height": h,
            "title": "Zero-Downtime Schema Migrations for Busy Databases", "label": "Databases",
        })
        body = res.json()
        assert body["success"] is True, body
        assert body["provider_used"] == "local"
        assert body["mime_type"] == "image/png"
        img = Image.open(io.BytesIO(base64.b64decode(body["image_base64"])))
        assert img.size == (w, h)


def test_paid_image_provider_without_key_fails_clearly():
    res = client.post("/v1/ai/generate-image", headers=AUTH, json={"provider": "openai", "prompt": "x", "width": 1200, "height": 630})
    body = res.json()
    assert body["success"] is False
    assert "API key" in body["error"]


def test_image_endpoint_requires_service_token():
    assert client.post("/v1/ai/generate-image", json={"prompt": "x"}).status_code == 401
