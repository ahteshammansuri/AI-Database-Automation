import pytest
from fastapi.testclient import TestClient
from backend.app.database import init_platform_db, engine, Base
from backend.app.main import app


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Ensure platform database tables are created before running tests."""
    init_platform_db()
    yield
    # Keep database tables for inspection or teardown if needed


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
