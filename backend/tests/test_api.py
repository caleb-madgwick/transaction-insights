import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import db
from main import app, load_sample
from models import Transaction

VALID = {
    "transaction_id": "T1", "dataset_id": 1, "date": "2026-01-05", "company": "Test Co",
    "category": "Sales", "direction": "INCOMING", "amount_cents": 1250, "currency": "AUD",
}


# --- Transaction model ---

def test_valid_transaction_accepted():
    t = Transaction(**VALID)
    assert t.amount_cents == 1250
    assert t.date.isoformat() == "2026-01-05"


@pytest.mark.parametrize("direction", ["incoming", "IN", "", "SIDEWAYS"])
def test_invalid_direction_rejected(direction):
    with pytest.raises(ValidationError):
        Transaction(**{**VALID, "direction": direction})


@pytest.mark.parametrize("amount", [0, -100, 12.5, "1250", None])
def test_invalid_amount_rejected(amount):
    with pytest.raises(ValidationError):
        Transaction(**{**VALID, "amount_cents": amount})


@pytest.mark.parametrize("value", [
    "2026-02-30", "05/01/2026", "not-a-date", "", 1767571200, "1767571200", "2026-01-05T00:00:00",
])
def test_invalid_date_rejected(value):
    with pytest.raises(ValidationError):
        Transaction(**{**VALID, "date": value})


@pytest.mark.parametrize("field, value", [
    ("company", "   "), ("currency", "USD"), ("category", "Not A Category"),
])
def test_other_invalid_fields_rejected(field, value):
    with pytest.raises(ValidationError):
        Transaction(**{**VALID, field: value})


def test_missing_category_accepted():
    data = {k: v for k, v in VALID.items() if k != "category"}
    assert Transaction(**data).category is None
    assert Transaction(**{**VALID, "category": None}).category is None


# --- API ---

def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_sample_loads(client):
    response = client.post("/datasets/small-business/load")
    assert response.status_code == 200
    body = response.json()
    assert body["transaction_count"] == 49
    assert body["already_loaded"] is False

    transactions = client.get(f"/datasets/{body['dataset_id']}/transactions").json()
    assert len(transactions) == 49
    assert any(t["category"] is None for t in transactions)
    assert {t["direction"] for t in transactions} == {"INCOMING", "OUTGOING"}

    samples = client.get("/datasets").json()["samples"]
    loaded = {s["sample_id"]: s["dataset_id"] for s in samples}
    assert loaded.pop("small-business") == body["dataset_id"]
    assert set(loaded.values()) == {None}  # loading one sample loads nothing else


def test_loading_twice_does_not_duplicate(client):
    first = client.post("/datasets/retail-business/load").json()
    # A fresh client re-runs startup against the same DB file (simulated restart).
    with TestClient(app) as restarted:
        second = restarted.post("/datasets/retail-business/load").json()
        datasets = restarted.get("/datasets").json()["datasets"]

    assert second["dataset_id"] == first["dataset_id"]
    assert second["already_loaded"] is True
    assert second["transaction_count"] == first["transaction_count"] == 52
    assert len(datasets) == 1


def test_concurrent_first_loads_create_one_dataset(client):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: load_sample("small-business"), range(8)))
    assert {r["dataset_id"] for r in results} == {1}
    assert sum(not r["already_loaded"] for r in results) == 1
    assert len(client.get("/datasets").json()["datasets"]) == 1


def test_unknown_dataset_returns_404(client):
    response = client.get("/datasets/999/transactions")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "dataset_not_found"


@pytest.mark.parametrize("dataset_id", ["abc", "0", "99999999999999999999"])
def test_invalid_dataset_id_returns_422(client, dataset_id):
    assert client.get(f"/datasets/{dataset_id}/transactions").status_code == 422


def test_foreign_keys_enforced(client):
    with closing(db.connect()) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO transactions VALUES (999, 'T1', '2026-01-05', 'Test Co', NULL, "
            "'INCOMING', 100, 'AUD')"
        )


def test_unknown_sample_returns_404(client):
    response = client.post("/datasets/no-such-sample/load")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "sample_not_found"


def test_transactions_isolated_by_dataset(client):
    small = client.post("/datasets/small-business/load").json()["dataset_id"]
    retail = client.post("/datasets/retail-business/load").json()["dataset_id"]
    assert small != retail

    small_rows = client.get(f"/datasets/{small}/transactions").json()
    retail_rows = client.get(f"/datasets/{retail}/transactions").json()

    assert all(t["dataset_id"] == small for t in small_rows)
    assert all(t["dataset_id"] == retail for t in retail_rows)
    assert all(t["transaction_id"].startswith("SB-") for t in small_rows)
    assert all(t["transaction_id"].startswith("RB-") for t in retail_rows)
