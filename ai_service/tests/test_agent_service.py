from fastapi.testclient import TestClient
from ai_service.app.main import app
from ai_service.app.config import settings

client = TestClient(app)
AUTH_HEADERS = {"X-Service-Token": settings.SERVICE_TOKEN}


def test_agent_plan_add_connection_requires_masked_input():
    payload = {
        "goal_prompt": "Connect my MySQL database",
        "has_connections": False,
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "ADD_CONNECTION"
    assert data["requires_input"] is True
    assert data["secure_input_type"] == "database_credentials"
    assert "credentials" in data["question"].lower()


def test_agent_plan_automation_with_lead_time_buffer():
    payload = {
        "goal_prompt": "Create a daily blog automation about electric cars with category Cars",
        "has_connections": True,
        "connections": [{"id": 5, "name": "MySQL Blog"}],
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "CREATE_AUTOMATION"
    assert len(data["steps"]) == 1
    step = data["steps"][0]
    assert step["tool"] == "create_automation_draft"
    assert step["args"]["connection_id"] == 5
    assert step["args"]["category_name"] == "Cars"


def test_evaluate_correction_stop_and_category_change():
    # 1. Stop command
    stop_res = client.post("/v1/ai/agent/evaluate-correction", json={
        "correction_text": "Stop immediately",
        "active_task_status": "RUNNING"
    }, headers=AUTH_HEADERS)
    assert stop_res.status_code == 200
    assert stop_res.json()["action"] == "STOP"

    # 2. Mid-task category correction
    change_res = client.post("/v1/ai/agent/evaluate-correction", json={
        "correction_text": "Use category Reviews instead",
        "active_task_status": "SUCCEEDED"
    }, headers=AUTH_HEADERS)
    assert change_res.status_code == 200
    change_data = change_res.json()
    assert change_data["action"] == "CHANGE_PARAMETER"
    assert change_data["new_value"] == "Reviews"
    assert change_data["compensating_needed"] is True


def test_agent_plan_greeting_conversational_response():
    payload = {
        "goal_prompt": "Hello Orbit, who are you?",
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "GREETING"
    assert data["outcome"] == "CONVERSATIONAL_RESPONSE"
    assert "orbit" in data["explanation"].lower()
    assert len(data["steps"]) == 0


def test_agent_plan_project_inquiry_rag():
    payload = {
        "goal_prompt": "What is this project about?",
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "PRODUCT_EXPLANATION"
    assert data["outcome"] == "CONVERSATIONAL_RESPONSE"
    assert "dataauto" in data["explanation"].lower() or "database automation" in data["explanation"].lower()
    assert len(data["steps"]) == 0


def test_agent_plan_check_connection_status():
    payload = {
        "goal_prompt": "Check database connection status",
        "has_connections": True,
        "connections": [{"id": 1, "name": "Production DB", "host": "127.0.0.1"}],
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "LIST_CONNECTIONS"
    assert data["outcome"] == "SUPPORTED_AND_SPECIFIED"
    assert len(data["steps"]) == 1
    assert data["steps"][0]["tool"] == "list_database_connections"


def test_agent_plan_destructive_sql_prohibited():
    payload = {
        "goal_prompt": "DROP TABLE users; --",
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["task_type"] == "POLICY_REJECTED"
    assert data["outcome"] == "DISALLOWED_BY_POLICY"
    assert "prohibited" in data["explanation"].lower()
    assert len(data["steps"]) == 0


def test_agent_plan_unsupported_task():
    payload = {
        "goal_prompt": "Book a flight to New York and order pizza",
        "provider": "mock"
    }
    response = client.post("/v1/ai/agent/plan", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["outcome"] == "UNSUPPORTED"
    assert "outside" in data["explanation"].lower()

