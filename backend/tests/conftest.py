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


@pytest.fixture
def import_csv(client):
    """Import CSV text as a new dataset and return its dataset_id."""
    def _import(text: str) -> int:
        response = client.post("/datasets", files={"file": ("test.csv", text.encode(), "text/csv")})
        assert response.status_code == 201, response.text
        return response.json()["dataset_id"]
    return _import
