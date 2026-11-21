from contextlib import closing

import pytest

import db

CSV = """transaction_id,date,company,category,direction,amount
T1,2026-01-15,Client A,Sales,INCOMING,1000.00
T2,2026-01-20,Print Shop,,OUTGOING,45.50
"""


def audit_rows():
    with closing(db.connect()) as conn:
        return [dict(r) for r in conn.execute(
            "SELECT dataset_id, transaction_id, previous_category, new_category, changed_at "
            "FROM category_audit ORDER BY audit_id")]


def patch(client, dataset_id, transaction_id, body):
    return client.patch(f"/datasets/{dataset_id}/transactions/{transaction_id}/category", json=body)


def test_review_workflow_end_to_end(client):
    dataset_id = client.post("/datasets/small-business/load").json()["dataset_id"]
    before = client.get(f"/datasets/{dataset_id}/summary").json()

    queue = client.get(f"/datasets/{dataset_id}/transactions?category=uncategorised").json()
    assert len(queue) == before["uncategorised_count"] == 4
    target = next(t for t in queue if t["direction"] == "OUTGOING")

    response = patch(client, dataset_id, target["transaction_id"], {"category": "Marketing"})
    assert response.status_code == 200
    assert response.json() == {**target, "category": "Marketing"}

    after = client.get(f"/datasets/{dataset_id}/summary").json()
    for key in ("total_income_cents", "total_expenses_cents", "net_cents", "income_count", "expense_count"):
        assert after[key] == before[key]
    assert after["uncategorised_count"] == 3
    assert after["uncategorised_cents"] == before["uncategorised_cents"] - target["amount_cents"]

    def expense(s, category):
        return next((c["amount_cents"] for c in s["expenses_by_category"] if c["category"] == category), 0)
    assert expense(after, "Marketing") == expense(before, "Marketing") + target["amount_cents"]
    assert expense(after, None) == expense(before, None) - target["amount_cents"]

    [audit] = audit_rows()
    assert audit["dataset_id"] == dataset_id
    assert audit["transaction_id"] == target["transaction_id"]
    assert (audit["previous_category"], audit["new_category"]) == (None, "Marketing")
    assert audit["changed_at"].endswith("+00:00")


def test_update_persists_and_only_changes_category(client, import_csv):
    dataset_id = import_csv(CSV)
    before = client.get(f"/datasets/{dataset_id}/transactions").json()
    patch(client, dataset_id, "T2", {"category": "Supplies"})
    after = client.get(f"/datasets/{dataset_id}/transactions").json()
    assert after == [{**t, "category": "Supplies"} if t["transaction_id"] == "T2" else t for t in before]


def test_recategorising_records_previous_value(client, import_csv):
    dataset_id = import_csv(CSV)
    patch(client, dataset_id, "T1", {"category": "Services"})
    assert [(a["previous_category"], a["new_category"]) for a in audit_rows()] == [("Sales", "Services")]


def test_repeated_update_is_idempotent(client, import_csv):
    dataset_id = import_csv(CSV)
    first = patch(client, dataset_id, "T2", {"category": "Supplies"})
    second = patch(client, dataset_id, "T2", {"category": "Supplies"})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(audit_rows()) == 1


@pytest.mark.parametrize("body", [{"category": "Snacks"}, {"category": "supplies"}, {"category": None}, {}])
def test_invalid_category_rejected(client, import_csv, body):
    dataset_id = import_csv(CSV)
    assert patch(client, dataset_id, "T2", body).status_code == 422
    assert client.get(f"/datasets/{dataset_id}/transactions?category=uncategorised").json()[0]["transaction_id"] == "T2"
    assert audit_rows() == []


def test_unknown_transaction_and_dataset(client, import_csv):
    dataset_id = import_csv(CSV)
    response = patch(client, dataset_id, "NOPE", {"category": "Supplies"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "transaction_not_found"
    assert patch(client, 999, "T2", {"category": "Supplies"}).json()["detail"]["code"] == "dataset_not_found"
    assert audit_rows() == []


def test_cross_dataset_update_rejected(client, import_csv):
    first = import_csv(CSV)
    second = import_csv("transaction_id,date,company,amount\nX1,2026-02-01,Other,-1.00\n")
    assert patch(client, second, "T2", {"category": "Supplies"}).status_code == 404  # T2 belongs to first
    assert client.get(f"/datasets/{first}/transactions?category=uncategorised").json()[0]["transaction_id"] == "T2"
    assert audit_rows() == []


def test_categories_endpoint(client):
    categories = client.get("/categories").json()["categories"]
    assert "Supplies" in categories and len(categories) == len(set(categories)) == 14
