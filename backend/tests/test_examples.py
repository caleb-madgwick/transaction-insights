"""Sample datasets, CSV example fixtures and their read-only preview endpoints."""
import csv
import io

import pytest

from main import FIXTURE_DIR, FIXTURES, PREVIEW_ROWS, SAMPLE_DIR, SAMPLES


def file_rows(path):
    return list(csv.reader(io.StringIO(path.read_text())))


# --- Sample datasets ---

@pytest.mark.parametrize("sample_id", SAMPLES)
def test_every_sample_loads_through_the_importer(client, sample_id):
    body = client.post(f"/datasets/{sample_id}/load").json()
    assert body["transaction_count"] == len(file_rows(SAMPLE_DIR / f"{sample_id}.csv")) - 1 >= 40
    months = client.get(f"/datasets/{body['dataset_id']}/summary").json()["monthly"]
    assert len(months) == 6


def test_samples_listed_with_descriptions(client):
    samples = client.get("/datasets").json()["samples"]
    assert [s["sample_id"] for s in samples] == list(SAMPLES)
    assert all(s["name"] and s["description"] and s["dataset_id"] is None for s in samples)


def test_sample_scenarios_match_their_descriptions(client):
    def summary(sample_id):
        dataset_id = client.post(f"/datasets/{sample_id}/load").json()["dataset_id"]
        return client.get(f"/datasets/{dataset_id}/summary").json()

    cash = summary("cash-flow-challenge")
    assert sum(m["expenses_cents"] > m["income_cents"] for m in cash["monthly"]) == 4
    assert summary("missing-categories")["uncategorised_count"] == 12
    april = next(m for m in summary("freelancer")["monthly"] if m["month"] == "2026-04")
    assert april["income_cents"] < april["expenses_cents"]


def test_sample_preview_shows_real_file_contents_without_saving(client):
    rows = file_rows(SAMPLE_DIR / "missing-categories.csv")
    preview = client.get("/samples/missing-categories/preview").json()
    assert preview["file_name"] == "missing-categories.csv"
    assert preview["columns"] == rows[0]
    assert preview["rows"] == rows[1:PREVIEW_ROWS + 1]
    assert preview["row_count"] == len(rows) - 1
    assert preview["missing_category_count"] == 12
    assert client.get("/datasets").json()["datasets"] == []  # nothing persisted


@pytest.mark.parametrize("path", [
    "/samples/no-such-sample/preview", "/samples/..%2Fmain/preview", "/samples/fixtures%2Finvalid-date/preview",
    "/fixtures/no-such-file/preview", "/fixtures/..%2F..%2Fbackend%2Fmain/file", "/fixtures/small-business/file",
])
def test_only_allowlisted_files_are_served(client, path):
    assert client.get(path).status_code == 404


# --- CSV example fixtures ---

def test_fixtures_listed_with_outcomes(client):
    fixtures = client.get("/fixtures").json()
    assert [f["fixture_id"] for f in fixtures] == list(FIXTURES)
    assert {f["outcome"] for f in fixtures} == {"Valid", "Needs mapping", "Needs review", "Expected rejection"}
    assert all((FIXTURE_DIR / f"{f['fixture_id']}.csv").exists() for f in fixtures)


def test_fixture_file_and_preview_are_the_real_file(client):
    raw = (FIXTURE_DIR / "invalid-amount.csv").read_bytes()
    assert client.get("/fixtures/invalid-amount/file").content == raw
    preview = client.get("/fixtures/invalid-amount/preview").json()
    assert preview["rows"][0] == file_rows(FIXTURE_DIR / "invalid-amount.csv")[1]
    assert client.get("/fixtures/missing-required-column/preview").json()["missing_category_count"] == 0


@pytest.mark.parametrize("fixture_id", FIXTURES)
def test_fixture_label_matches_actual_backend_outcome(client, fixture_id):
    """The UI label must describe what the importer really does with the file."""
    content = client.get(f"/fixtures/{fixture_id}/file").content
    report = client.post("/datasets/preview", files={"file": (f"{fixture_id}.csv", content, "text/csv")}).json()
    outcome = FIXTURES[fixture_id][1]
    if outcome == "Valid":
        assert report["valid"]
    elif outcome == "Needs mapping":
        assert report["missing_fields"] and report["unmapped_columns"]
    elif outcome == "Needs review":
        assert report["valid"] and report["uncategorised_count"] > 0
    else:
        assert not report["valid"]
