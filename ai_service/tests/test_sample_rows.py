import json

import pytest
from fastapi.testclient import TestClient

from ai_service.app.config import settings
from ai_service.app.main import app
from ai_service.app.providers.mock_provider import MockAIProvider

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_TOKEN}
COLUMNS = [
    {"name": "name", "family": "string", "type": "varchar(80)", "max_length": 80, "unique": True},
    {"name": "price", "family": "decimal", "type": "decimal(8,2)"},
    {"name": "category_id", "family": "integer", "type": "int", "link": {"table": "categories", "options": [{"id": 1, "label": "Shoes"}, {"id": 2, "label": "Bags"}]}},
]


@pytest.fixture(autouse=True)
def reset():
    MockAIProvider.reset_script()
    yield
    MockAIProvider.reset_script()


def body(**extra):
    return {"provider": "mock", "table": "products", "columns": COLUMNS, "count": 3, "instructions": "summer fashion", **extra}


def test_rows_follow_the_request_and_duplicates_of_unique_values_are_dropped():
    MockAIProvider.script(
        json.dumps({"rows": [
            {"name": "Linen tote", "price": 39.5, "category_id": 2},
            {"name": "Linen tote", "price": 41, "category_id": 2},       # repeats a unique value
            {"name": "Canvas sneaker", "price": 59, "category_id": 1},
        ]}),
        json.dumps({"rows": [{"name": "Raffia sandal", "price": 45, "category_id": 1}]}),
    )
    res = client.post("/v1/ai/sample-rows", json=body(existing_unique={"name": ["Canvas sneaker"]}), headers=AUTH).json()

    assert res["success"] is True
    # The repeated "Linen tote" and the already-used "Canvas sneaker" are dropped; asking again fills one more row,
    # then the model has nothing left to say and the shortfall is reported instead of invented.
    assert [r["name"] for r in res["rows"]] == ["Linen tote", "Raffia sandal"]
    assert res["requested"] == 3 and res["problems"]
    prompt = MockAIProvider.captured_requests[0]["messages"][1]["content"]
    assert "summer fashion" in prompt and "1=Shoes" in prompt and "must be different in every row" in prompt
    schema = MockAIProvider.captured_requests[0]["json_schema"]
    assert schema["properties"]["rows"]["items"]["properties"]["category_id"]["enum"] == [1, 2]


def test_invalid_json_is_retried_and_a_provider_error_is_reported():
    MockAIProvider.script("not json", json.dumps({"rows": [{"name": "A", "price": 1, "category_id": 1}]}))
    res = client.post("/v1/ai/sample-rows", json=body(count=1), headers=AUTH).json()
    assert res["success"] is True and len(res["rows"]) == 1
    assert any("not valid JSON" in p for p in res["problems"])

    MockAIProvider.reset_script()  # nothing scripted: the provider raises
    res = client.post("/v1/ai/sample-rows", json=body(count=2), headers=AUTH).json()
    assert res["success"] is False and res["rows"] == [] and res["error"]


def test_table_names_are_validated():
    assert client.post("/v1/ai/sample-rows", json=body(table="products; drop"), headers=AUTH).status_code == 422
