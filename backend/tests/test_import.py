import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

import db
from importer import MAX_BYTES, MAX_ROWS
from models import MAX_AMOUNT_CENTS, Transaction

FIXTURES = Path(__file__).parent.parent.parent / "sample-data" / "fixtures"


def post(client, path, content, mapping=None, filename="upload.csv"):
    data = {"mapping": json.dumps(mapping)} if mapping is not None else {}
    return client.post(path, files={"file": (filename, content, "text/csv")}, data=data)


def fixture(name):
    return (FIXTURES / name).read_bytes()


def stored(client):
    """(transaction count, total cents) across the whole database."""
    with closing(db.connect()) as conn:
        return tuple(conn.execute("SELECT COUNT(*), COALESCE(SUM(amount_cents), 0) FROM transactions").fetchone())


def transactions(client, dataset_id):
    return client.get(f"/datasets/{dataset_id}/transactions").json()


# --- Valid imports ---

def test_signed_amount_import(client):
    preview = post(client, "/datasets/preview", fixture("signed-amount.csv")).json()
    assert preview["valid"] and preview["row_count"] == 3

    body = post(client, "/datasets", fixture("signed-amount.csv")).json()
    assert body["imported_count"] == 3
    rows = {t["company"]: t for t in transactions(client, body["dataset_id"])}
    assert (rows["Example Supplies"]["direction"], rows["Example Supplies"]["amount_cents"]) == ("OUTGOING", 12550)
    assert (rows["Example Client"]["direction"], rows["Example Client"]["amount_cents"]) == ("INCOMING", 150000)


def test_explicit_direction_import(client):
    response = post(client, "/datasets", fixture("explicit-direction.csv"))
    assert response.status_code == 201
    rows = transactions(client, response.json()["dataset_id"])
    assert [(t["direction"], t["amount_cents"]) for t in rows] == [  # newest first
        ("OUTGOING", 200000), ("INCOMING", 150000), ("OUTGOING", 12550)]


def test_known_aliases_recognised(client):
    csv = b" Trans_Date ,COUNTERPARTY,Type,Transaction  Amount,transaction direction\n2026-07-01,Co,,1,OUTGOING\n"
    preview = post(client, "/datasets/preview", csv).json()
    assert preview["mapping"] == {
        "Trans_Date": "date", "COUNTERPARTY": "company", "Type": "category",
        "Transaction  Amount": "amount", "transaction direction": "direction"}
    assert preview["valid"]


def test_repeated_identical_rows_without_ids_are_kept(client):
    csv = b"date,company,amount\n2026-07-01,Cafe,-4.50\n2026-07-01,Cafe,-4.50\n"
    assert post(client, "/datasets", csv).json()["imported_count"] == 2


def test_missing_category_accepted(client):
    body = post(client, "/datasets", fixture("missing-category.csv")).json()
    assert body["uncategorised_count"] == 2
    assert sum(t["category"] is None for t in transactions(client, body["dataset_id"])) == 2


# --- Column mapping ---

def test_manual_mapping_of_unknown_headers(client):
    content = fixture("unknown-headers.csv")
    preview = post(client, "/datasets/preview", content).json()
    assert preview["missing_fields"] == ["date", "company", "amount"]
    assert preview["unmapped_columns"] == ["When", "Payee", "Kind", "Sum"]

    rejected = post(client, "/datasets", content)
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "mapping_required"

    mapping = {"When": "date", "Payee": "company", "Kind": "category", "Sum": "amount"}
    assert post(client, "/datasets/preview", content, mapping).json()["valid"]
    assert post(client, "/datasets", content, mapping).json()["imported_count"] == 2


@pytest.mark.parametrize("mapping", [
    {"Nope": "date", "Payee": "company", "Sum": "amount"},                  # unknown column
    {"When": "posted", "Payee": "company", "Sum": "amount"},                # unsupported field
    {"When": "date", "Payee": "company", "Kind": "company", "Sum": "amount"},  # duplicate target
    ["When", "date"],                                                      # not an object
])
def test_invalid_mapping_rejected(client, mapping):
    response = post(client, "/datasets/preview", fixture("unknown-headers.csv"), mapping)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_mapping"


def test_mapping_missing_required_field(client):
    response = post(client, "/datasets", fixture("unknown-headers.csv"), {"When": "date", "Payee": "company"})
    assert response.status_code == 422
    assert response.json()["detail"]["missing_fields"] == ["amount"]


def test_ambiguous_source_columns_require_mapping(client):
    csv = b"date,merchant,description,amount\n2026-07-01,A,B,-1.00\n"
    detail = post(client, "/datasets", csv).json()["detail"]
    assert detail["code"] == "mapping_required"
    assert detail["missing_fields"] == ["company"]
    assert "merchant, description" in detail["errors"][0]["message"]


def test_missing_required_column(client):
    detail = post(client, "/datasets", fixture("missing-required-column.csv")).json()["detail"]
    assert detail["code"] == "missing_required_column"
    assert detail["missing_fields"] == ["amount"]


# --- Row validation ---

def test_invalid_amounts_rejected(client):
    detail = post(client, "/datasets", fixture("invalid-amount.csv")).json()["detail"]
    assert detail["code"] == "invalid_rows"
    assert [(e["row"], e["field"]) for e in detail["errors"]] == [(2, "amount"), (3, "amount"), (4, "amount")]


def test_invalid_dates_rejected(client):
    detail = post(client, "/datasets", fixture("invalid-date.csv")).json()["detail"]
    assert [(e["row"], e["field"]) for e in detail["errors"]] == [(2, "date"), (3, "date")]


@pytest.mark.parametrize("csv", [
    b"date,company,direction,amount\n2026-07-01,Co,credit,10.00\n",     # unrecognised direction
    b"date,company,direction,amount\n2026-07-01,Co,INCOMING,-10.00\n",  # sign conflicts with direction
    b"date,company,amount\n2026-07-01,Co,10.00\n2026-07-02,Co,5.00\n",  # unsigned, no direction column
])
def test_ambiguous_direction_rejected(client, csv):
    detail = post(client, "/datasets", csv).json()["detail"]
    assert detail["code"] == "invalid_rows"
    assert detail["errors"][0]["field"] == "direction"


def test_invalid_category_rejected_with_permitted_values(client):
    detail = post(client, "/datasets", b"date,company,category,amount\n2026-07-01,Co,Snacks,-1.00\n").json()["detail"]
    assert detail["errors"][0]["field"] == "category"
    assert "Supplies" in detail["errors"][0]["message"]


def test_non_aud_currency_rejected(client):
    detail = post(client, "/datasets", b"date,company,amount,currency\n2026-07-01,Co,-1.00,USD\n").json()["detail"]
    assert detail["errors"][0]["field"] == "currency"


def test_duplicate_transaction_ids_rejected(client):
    detail = post(client, "/datasets", fixture("duplicate-transactions.csv")).json()["detail"]
    assert detail["errors"] == [{"row": 4, "field": "transaction_id",
                                 "message": "Duplicate transaction_id 'T-1' (first on row 2)."}]


# --- File-level failures ---

@pytest.mark.parametrize("filename, content, status, code", [
    ("data.txt", b"date,company,amount\n", 415, "unsupported_file_type"),
    ("data.csv", b"", 400, "empty_file"),
    ("data.csv", b"date,company,amount\n", 400, "empty_file"),
    ("data.csv", b"\xff\xfe\x00bad", 400, "invalid_encoding"),
    ("data.csv", b"date,date,amount\n2026-07-01,x,1\n", 400, "malformed_csv"),
    ("data.csv", b"a" * (MAX_BYTES + 1), 413, "file_too_large"),
])
def test_bad_files_rejected(client, filename, content, status, code):
    response = post(client, "/datasets/preview", content, filename=filename)
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


def test_wrong_column_count_is_a_row_error(client):
    detail = post(client, "/datasets", b"date,company,amount\n2026-07-01,Co\n").json()["detail"]
    assert detail["errors"][0] == {"row": 2, "field": None, "message": "Expected 3 values, found 2."}


# --- Persistence guarantees ---

def test_preview_never_persists(client):
    post(client, "/datasets/preview", fixture("signed-amount.csv"))
    assert client.get("/datasets").json()["datasets"] == []
    assert stored(client) == (0, 0)


def test_duplicate_file_import_prevented(client):
    content = fixture("explicit-direction.csv")
    assert post(client, "/datasets", content).status_code == 201
    before = stored(client)
    response = post(client, "/datasets", content, filename="renamed.csv")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "duplicate_file"
    assert stored(client) == before


def test_invalid_import_leaves_existing_data_unchanged(client):
    client.post("/datasets/small-business/load")
    before = stored(client)
    datasets_before = client.get("/datasets").json()["datasets"]

    # Two valid rows and one bad row: nothing may be written.
    csv = b"date,company,amount\n2026-07-01,A,-10.00\n2026-07-02,B,20.00\n2026-07-03,C,oops\n"
    assert post(client, "/datasets", csv).status_code == 422

    assert stored(client) == before
    assert client.get("/datasets").json()["datasets"] == datasets_before


def test_database_failure_rolls_back_whole_import(client):
    row = Transaction(transaction_id="T1", dataset_id=0, date="2026-07-01", company="Co",
                      direction="INCOMING", amount_cents=100)
    with closing(db.connect()) as conn, pytest.raises(sqlite3.IntegrityError):
        with conn:
            db.insert_dataset(conn, "Broken", "hash", [row, row])  # second row violates PK
    assert client.get("/datasets").json()["datasets"] == []
    assert stored(client) == (0, 0)


def test_imported_datasets_are_isolated(client):
    first = post(client, "/datasets", fixture("signed-amount.csv")).json()["dataset_id"]
    second = post(client, "/datasets", fixture("explicit-direction.csv")).json()["dataset_id"]
    assert first != second
    assert all(t["dataset_id"] == first for t in transactions(client, first))
    assert all(t["dataset_id"] == second for t in transactions(client, second))
    assert len(transactions(client, first)) == len(transactions(client, second)) == 3


# --- Monetary limits (MAX_AMOUNT_CENTS = $1,000,000,000.00) ---

SIGNED = "date,company,amount\n2026-07-01,Co,{}\n"
DIRECTED = "date,company,direction,amount\n2026-07-01,Co,{},{}\n"


@pytest.mark.parametrize("csv, direction", [
    (SIGNED.format("+1000000000.00"), "INCOMING"),
    (SIGNED.format("-1000000000.00"), "OUTGOING"),
    (SIGNED.format("+0001000000000"), "INCOMING"),  # leading zeros are not counted as size
    (DIRECTED.format("OUTGOING", "1000000000.00"), "OUTGOING"),
])
def test_maximum_amount_accepted(client, csv, direction):
    response = post(client, "/datasets", csv.encode())
    assert response.status_code == 201, response.text
    [row] = transactions(client, response.json()["dataset_id"])
    assert (row["direction"], row["amount_cents"]) == (direction, MAX_AMOUNT_CENTS)


@pytest.mark.parametrize("csv", [
    SIGNED.format("+1000000000.01"),
    SIGNED.format("-1000000000.01"),
    DIRECTED.format("INCOMING", "1000000000.01"),
    SIGNED.format("-99999999999999999999.99"),             # beyond SQLite INTEGER
    DIRECTED.format("OUTGOING", "9" * 100_000),           # very long number
])
def test_over_limit_amount_rejected_by_preview_and_import(client, csv):
    preview = post(client, "/datasets/preview", csv.encode())
    assert preview.status_code == 200
    assert not preview.json()["valid"]
    assert preview.json()["errors"] == [
        {"row": 2, "field": "amount", "message": "Amount must not exceed $1,000,000,000.00."}]

    response = post(client, "/datasets", csv.encode())
    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == preview.json()["errors"]
    assert client.get("/datasets").json()["datasets"] == []
    assert stored(client) == (0, 0)


def test_maximum_dataset_totals_stay_exact_in_javascript(client):
    # 5,000 rows (the import limit) at the maximum amount, half each way.
    rows = "".join(f"2026-07-01,Co,{'-' if i % 2 else ''}1000000000.00\n" for i in range(MAX_ROWS))
    dataset_id = post(client, "/datasets", f"date,company,amount\n{rows}".encode()).json()["dataset_id"]
    summary = client.get(f"/datasets/{dataset_id}/summary").json()
    half = MAX_ROWS // 2 * MAX_AMOUNT_CENTS
    assert summary["total_income_cents"] == summary["total_expenses_cents"] == half
    assert stored(client) == (MAX_ROWS, MAX_ROWS * MAX_AMOUNT_CENTS)
    assert MAX_ROWS * MAX_AMOUNT_CENTS <= 2**53 - 1  # Number.MAX_SAFE_INTEGER
