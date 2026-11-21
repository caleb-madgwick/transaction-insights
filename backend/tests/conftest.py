import pytest
from fastapi.testclient import TestClient

import db
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """API client backed by a fresh temporary SQLite database."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client
