def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == "1.0.0"
    assert "/api/v1" in data["api_v1"]


def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["platform_db"] == "connected"
    assert "timestamp" in data


def test_stats_endpoint(client):
    response = client.get("/api/v1/stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_connections" in data
    assert "active_automations" in data
    assert "pending_approvals" in data
