import csv
from collections import Counter
from contextlib import closing
from decimal import Decimal
from pathlib import Path

import pytest

import db

SAMPLES = Path(__file__).parent.parent.parent / "sample-data"

# Hand-checked: income 1500.10 + 0.20 + 300.00 = 1800.30; expenses 125.50 + 89.95 = 215.45.
MIXED = """transaction_id,date,company,category,direction,amount
T1,2026-01-15,Client A,Sales,INCOMING,1500.10
T2,2026-01-20,Store,Supplies,OUTGOING,125.50
T3,2026-03-05,Power Co,,OUTGOING,89.95
T4,2026-03-31,Savings Interest,Interest,INCOMING,0.20
T5,2026-04-01,Client B,,INCOMING,300.00
"""


def summary(client, dataset_id, query=""):
    return client.get(f"/datasets/{dataset_id}/summary?{query}").json()


def ids(client, dataset_id, query=""):
    response = client.get(f"/datasets/{dataset_id}/transactions?{query}")
    assert response.status_code == 200
    return [t["transaction_id"] for t in response.json()]


# --- Financial calculations ---

def test_totals_breakdowns_and_months(client, import_csv):
    s = summary(client, import_csv(MIXED))
    assert (s["total_income_cents"], s["total_expenses_cents"], s["net_cents"]) == (180030, 21545, 158485)
    assert (s["income_count"], s["expense_count"]) == (3, 2)
    assert s["income_by_category"] == [
        {"category": "Sales", "amount_cents": 150010},
        {"category": None, "amount_cents": 30000},
        {"category": "Interest", "amount_cents": 20}]
    assert s["expenses_by_category"] == [
        {"category": "Supplies", "amount_cents": 12550},
        {"category": None, "amount_cents": 8995}]
    assert s["monthly"] == [
        {"month": "2026-01", "income_cents": 150010, "expenses_cents": 12550},
        {"month": "2026-02", "income_cents": 0, "expenses_cents": 0},  # gap filled
        {"month": "2026-03", "income_cents": 20, "expenses_cents": 8995},
        {"month": "2026-04", "income_cents": 30000, "expenses_cents": 0}]
    assert (s["uncategorised_count"], s["uncategorised_cents"]) == (2, 38995)


def test_cents_are_exact(client, import_csv):
    # 0.10 + 0.20 is 0.30000000000000004 in floating point.
    s = summary(client, import_csv("date,company,amount\n2026-01-01,A,+0.10\n2026-01-02,B,+0.20\n2026-01-03,C,-0.30\n"))
    assert (s["total_income_cents"], s["total_expenses_cents"], s["net_cents"]) == (30, 30, 0)


@pytest.mark.parametrize("sample_id", ["small-business", "retail-business"])
def test_matches_independent_calculation(client, sample_id):
    expected, by_month = Counter(), Counter()
    with open(SAMPLES / f"{sample_id}.csv") as f:
        for row in csv.DictReader(f):
            cents = int(Decimal(row["amount"]) * 100)
            expected[row["direction"]] += cents
            expected[row["direction"], row["category"] or None] += cents
            by_month[row["date"][:7], row["direction"]] += cents

    s = summary(client, client.post(f"/datasets/{sample_id}/load").json()["dataset_id"])
    assert s["total_income_cents"] == expected["INCOMING"]
    assert s["total_expenses_cents"] == expected["OUTGOING"]
    assert s["net_cents"] == expected["INCOMING"] - expected["OUTGOING"]
    for c in s["expenses_by_category"]:
        assert c["amount_cents"] == expected["OUTGOING", c["category"]]
    for m in s["monthly"]:
        assert (m["income_cents"], m["expenses_cents"]) == (by_month[m["month"], "INCOMING"],
                                                            by_month[m["month"], "OUTGOING"])


def test_every_figure_uses_the_same_date_range(client):
    dataset_id = client.post("/datasets/retail-business/load").json()["dataset_id"]
    s = summary(client, dataset_id, "start_date=2026-02-10&end_date=2026-04-20")
    assert [m["month"] for m in s["monthly"]] == ["2026-02", "2026-03", "2026-04"]
    assert sum(m["income_cents"] for m in s["monthly"]) == s["total_income_cents"]
    assert sum(m["expenses_cents"] for m in s["monthly"]) == s["total_expenses_cents"]
    assert sum(c["amount_cents"] for c in s["income_by_category"]) == s["total_income_cents"]
    assert sum(c["amount_cents"] for c in s["expenses_by_category"]) == s["total_expenses_cents"]
    assert s["income_count"] + s["expense_count"] == len(
        ids(client, dataset_id, "start_date=2026-02-10&end_date=2026-04-20"))


def test_inclusive_date_range_in_summary(client, import_csv):
    s = summary(client, import_csv(MIXED), "start_date=2026-01-20&end_date=2026-03-31")  # T2, T3, T4
    assert (s["total_income_cents"], s["total_expenses_cents"]) == (20, 21545)
    assert (s["start_date"], s["end_date"]) == ("2026-01-20", "2026-03-31")


@pytest.mark.parametrize("csv_text, phrase", [
    ("date,company,amount\n2026-01-01,A,100.00\n2026-01-02,B,-40.00\n", "positive net cash flow of $60.00"),
    ("date,company,amount\n2026-01-01,A,40.00\n2026-01-02,B,-100.00\n", "negative net cash flow of $60.00"),
    ("date,company,amount\n2026-01-01,A,50.00\n2026-01-02,B,-50.00\n", "net cash flow of $0.00"),
])
def test_net_cash_flow_sign(client, import_csv, csv_text, phrase):
    assert phrase in summary(client, import_csv(csv_text))["summary_text"]


def test_written_summary(client, import_csv):
    assert summary(client, import_csv(MIXED))["summary_text"] == (
        "Across all transactions, income was $1,800.30 and expenses were $215.45, resulting in "
        "positive net cash flow of $1,584.85. Supplies was the largest expense category. "
        "2 transactions require review.")


@pytest.mark.parametrize("uncategorised, sentence", [
    ("5.00", "Uncategorised expenses were at least as large as any single category."),
    ("1.00", "Uncategorised expenses were at least as large as any single category."),  # tie
    ("0.50", "Rent was the largest expense category."),
])
def test_largest_category_never_hides_bigger_uncategorised(client, import_csv, uncategorised, sentence):
    csv_text = f"date,company,category,amount\n2026-01-01,A,Rent,-1.00\n2026-01-02,B,,-{uncategorised}\n"
    assert sentence in summary(client, import_csv(csv_text))["summary_text"]


def test_zero_expenses(client, import_csv):
    s = summary(client, import_csv("date,company,category,amount\n2026-01-01,A,Sales,+10.00\n"))
    assert s["total_expenses_cents"] == 0 and s["expenses_by_category"] == []
    assert s["summary_text"].endswith("There were no expenses.")


def test_empty_dataset_and_empty_range(client, import_csv):
    with closing(db.connect()) as conn, conn:
        empty_id = db.insert_dataset(conn, "Empty", "no-file", [])
    for s in (summary(client, empty_id), summary(client, import_csv(MIXED), "start_date=2027-01-01")):
        assert (s["total_income_cents"], s["total_expenses_cents"], s["net_cents"]) == (0, 0, 0)
        assert s["monthly"] == s["income_by_category"] == s["expenses_by_category"] == []
        assert s["summary_text"] == "No transactions in the selected period."


def test_summary_unknown_dataset(client):
    assert client.get("/datasets/999/summary").status_code == 404


# --- Filtering ---

def test_inclusive_date_filter_newest_first(client, import_csv):
    assert ids(client, import_csv(MIXED), "start_date=2026-01-20&end_date=2026-03-31") == ["T4", "T3", "T2"]


def test_equal_dates_sorted_by_transaction_id(client, import_csv):
    dataset_id = import_csv("transaction_id,date,company,amount\nB,2026-01-01,X,-1.00\nA,2026-01-01,Y,-2.00\n"
                            "C,2026-01-02,Z,-3.00\n")
    assert ids(client, dataset_id) == ["C", "A", "B"]


@pytest.mark.parametrize("path", ["transactions", "summary"])
def test_start_after_end_rejected(client, import_csv, path):
    response = client.get(f"/datasets/{import_csv(MIXED)}/{path}?start_date=2026-02-01&end_date=2026-01-01")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_date_range"


@pytest.mark.parametrize("query", [
    "start_date=2026-13-01", "end_date=01/03/2026", "start_date=1767571200",
    "category=Nope", "category=sales", "direction=incoming", "direction=SIDEWAYS",
])
def test_invalid_filter_values_rejected(client, import_csv, query):
    assert client.get(f"/datasets/{import_csv(MIXED)}/transactions?{query}").status_code == 422


def test_category_filter_and_review_queue(client, import_csv):
    dataset_id = import_csv(MIXED)
    assert ids(client, dataset_id, "category=Sales") == ["T1"]
    assert ids(client, dataset_id, "category=uncategorised") == ["T5", "T3"]


def test_direction_filter(client, import_csv):
    assert ids(client, import_csv(MIXED), "direction=OUTGOING") == ["T3", "T2"]


def test_combined_filters(client, import_csv):
    dataset_id = import_csv(MIXED)
    assert ids(client, dataset_id, "direction=INCOMING&category=uncategorised&start_date=2026-04-01") == ["T5"]
    assert ids(client, dataset_id, "direction=OUTGOING&category=Sales") == []  # valid, no matches


def test_filters_and_summary_scoped_to_dataset(client, import_csv):
    first = import_csv(MIXED)
    second = import_csv("transaction_id,date,company,category,amount\nT1,2026-01-15,Other,Sales,+5.00\n")
    assert ids(client, second, "category=Sales") == ["T1"]
    assert client.get(f"/datasets/{second}/transactions?category=Sales").json()[0]["dataset_id"] == second
    assert summary(client, second)["total_income_cents"] == 500
    assert summary(client, first)["total_income_cents"] == 180030
