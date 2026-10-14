import pytest
from backend.app.config import settings
from backend.app.connectors.mysql import MySQLConnector
from backend.app.security.guardrails import classify_table_sensitivity, DatabaseSecurityViolation


def test_table_sensitivity_classification():
    assert classify_table_sensitivity("users")[0] == "RESTRICTED"
    assert classify_table_sensitivity("payments")[0] == "RESTRICTED"
    assert classify_table_sensitivity("user_passwords")[0] == "RESTRICTED"
    assert classify_table_sensitivity("audit_logs")[0] == "RESTRICTED"
    assert classify_table_sensitivity("posts")[0] == "ALLOWLISTED"
    assert classify_table_sensitivity("categories")[0] == "ALLOWLISTED"
    assert classify_table_sensitivity("tags")[0] == "ALLOWLISTED"
    assert classify_table_sensitivity("some_random_table")[0] == "REVIEW_NEEDED"


def test_mysql_connector_connectivity():
    connector = MySQLConnector(
        host=settings.DEMO_MYSQL_HOST,
        port=settings.DEMO_MYSQL_PORT,
        database=settings.DEMO_MYSQL_DATABASE,
        username=settings.DEMO_MYSQL_USER,
        password=settings.DEMO_MYSQL_PASSWORD
    )
    result = connector.test_connection()
    assert result.success is True
    assert result.latency_ms is not None
    assert result.latency_ms > 0
    assert result.server_version is not None


def test_mysql_connector_bad_credentials():
    connector = MySQLConnector(
        host=settings.DEMO_MYSQL_HOST,
        port=settings.DEMO_MYSQL_PORT,
        database=settings.DEMO_MYSQL_DATABASE,
        username="invalid_user_999",
        password="bad_password_xyz"
    )
    result = connector.test_connection()
    assert result.success is False
    assert "bad_password_xyz" not in result.message  # Verify secret is not leaked


def test_mysql_schema_introspection():
    connector = MySQLConnector(
        host=settings.DEMO_MYSQL_HOST,
        port=settings.DEMO_MYSQL_PORT,
        database=settings.DEMO_MYSQL_DATABASE,
        username=settings.DEMO_MYSQL_USER,
        password=settings.DEMO_MYSQL_PASSWORD
    )
    schema = connector.introspect_schema(connection_id=1)
    assert schema.database_name == settings.DEMO_MYSQL_DATABASE
    table_names = [t.name for t in schema.tables]
    assert "posts" in table_names
    assert "categories" in table_names
    assert "users" in table_names
    assert "payments" in table_names

    # Check sensitivity
    users_tbl = next(t for t in schema.tables if t.name == "users")
    assert users_tbl.category == "RESTRICTED"
    assert users_tbl.restriction_reason is not None

    posts_tbl = next(t for t in schema.tables if t.name == "posts")
    assert posts_tbl.category == "ALLOWLISTED"

    # Check columns on posts
    col_names = [c.name for c in posts_tbl.columns]
    assert "title" in col_names
    assert "slug" in col_names
    assert "content" in col_names
    assert "status" in col_names

    status_col = next(c for c in posts_tbl.columns if c.name == "status")
    assert status_col.enum_values == ["draft", "published", "archived"]

    # Check relationships
    relationships = posts_tbl.relationships
    assert any(r.constrained_column == "category_id" and r.referenced_table == "categories" for r in relationships)


def test_api_connection_flow(client):
    # Seed default demo connection
    seed_res = client.post("/api/v1/connections/seed-demo")
    assert seed_res.status_code == 200
    conn_data = seed_res.json()
    assert conn_data["name"] == "Synthetic Demo Blog CMS"
    assert conn_data["database"] == settings.DEMO_MYSQL_DATABASE
    assert "password" not in conn_data  # Check password is never in response

    # Test saved connection
    test_res = client.post(f"/api/v1/connections/{conn_data['id']}/test")
    assert test_res.status_code == 200
    assert test_res.json()["success"] is True

    # Retrieve schema via API
    schema_res = client.get(f"/api/v1/connections/{conn_data['id']}/schema")
    assert schema_res.status_code == 200
    schema_data = schema_res.json()
    assert len(schema_data["tables"]) >= 4
