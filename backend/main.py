"""Transaction Insights API."""
import csv
import hashlib
import io
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Form, Path as PathParam, UploadFile
from fastapi.responses import JSONResponse, Response

import db
from importer import ALIAS_TO_FIELD, MAX_BYTES, api_error, normalise, parse_csv, parse_mapping
from models import CATEGORIES, CategoryUpdate, IsoDate, Transaction
from summary import build_summary

SAMPLE_DIR = Path(__file__).parent.parent / "sample-data"
FIXTURE_DIR = SAMPLE_DIR / "fixtures"
PREVIEW_ROWS = 8

# Allowlists: only these files can be loaded or previewed; ids map to fixed file names.
SAMPLES = {
    "small-business": ("Small Business", "Consultancy with balanced income and expenses over six months."),
    "retail-business": ("Retail Business", "Shop with card sales, inventory purchases and operating costs."),
    "freelancer": ("Freelancer", "Irregular client invoices: strong months and a very quiet April."),
    "missing-categories": ("Missing Categories", "Cafe with 12 uncategorised transactions to practise review."),
    "cash-flow-challenge": ("Cash Flow Challenge", "Workshop where expenses exceed income in four of six months."),
}
FIXTURES = {  # (name, expected outcome, explanation)
    "signed-amount": ("Signed amounts", "Valid", "Negative amounts are expenses, positive amounts are income."),
    "explicit-direction": ("Explicit direction", "Valid",
                           "Unsigned amounts with an INCOMING/OUTGOING column and alternative header names."),
    "unknown-headers": ("Unknown headers", "Needs mapping",
                        "Columns When, Payee, Kind and Sum must be mapped to date, company, category and amount."),
    "missing-category": ("Missing categories", "Needs review",
                         "Blank categories import successfully and appear in Transaction Review."),
    "invalid-amount": ("Invalid amount", "Expected rejection", "Three decimal places, text and zero amounts are rejected."),
    "invalid-date": ("Invalid date", "Expected rejection", "A date that doesn't exist and a DD/MM/YYYY date are rejected."),
    "missing-required-column": ("Missing required column", "Expected rejection", "There is no amount column."),
    "duplicate-transactions": ("Duplicate transaction IDs", "Expected rejection", "The same transaction ID appears twice."),
}
UNCATEGORISED = "uncategorised"

DatasetId = Annotated[int, PathParam(ge=1, le=2**63 - 1)]  # SQLite INTEGER range; else 422
CategoryFilter = Literal[CATEGORIES + (UNCATEGORISED,)]
Direction = Literal["INCOMING", "OUTGOING"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Transaction Insights", lifespan=lifespan)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sample_bytes(sample_id: str) -> bytes:
    return (SAMPLE_DIR / f"{sample_id}.csv").read_bytes()


def csv_preview(path: Path) -> dict:
    """First rows of a CSV exactly as written in the file (read-only, nothing stored)."""
    rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    columns, data = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
    category = next((i for i, c in enumerate(columns) if ALIAS_TO_FIELD.get(normalise(c)) == "category"), None)
    return {
        "file_name": path.name,
        "columns": columns,
        "rows": data[:PREVIEW_ROWS],
        "row_count": len(data),
        "missing_category_count": None if category is None else
            sum(1 for r in data if len(r) > category and not r[category].strip()),
    }


def require_dataset(conn: sqlite3.Connection, dataset_id: int) -> None:
    if not conn.execute("SELECT 1 FROM datasets WHERE dataset_id = ?", (dataset_id,)).fetchone():
        raise api_error(404, "dataset_not_found", f"Dataset {dataset_id} does not exist")


def where_clause(dataset_id: int, start_date=None, end_date=None, category=None, direction=None):
    """SQL WHERE from fixed fragments; every value is a bound parameter."""
    if start_date and end_date and start_date > end_date:
        raise api_error(422, "invalid_date_range", "start_date must be on or before end_date.")
    clauses, params = ["dataset_id = ?"], [dataset_id]
    if start_date:
        clauses.append("date >= ?")
        params.append(start_date.isoformat())
    if end_date:
        clauses.append("date <= ?")
        params.append(end_date.isoformat())
    if category == UNCATEGORISED:
        clauses.append("category IS NULL")
    elif category:
        clauses.append("category = ?")
        params.append(category)
    if direction:
        clauses.append("direction = ?")
        params.append(direction)
    return " AND ".join(clauses), params


async def read_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".csv"):
        raise api_error(415, "unsupported_file_type", "Only .csv files are supported.")
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise api_error(413, "file_too_large", f"File must be {MAX_BYTES // 1_000_000} MB or smaller.")
    return content


@app.get("/health")
def health():
    """Liveness: the API process is answering. Does not touch the database."""
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Readiness: the database opens and has the required tables. Read-only; no error details exposed."""
    try:
        with closing(db.connect()) as conn:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    except sqlite3.Error:
        tables = set()
    if not {"datasets", "transactions", "category_audit"} <= tables:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ready"}


@app.get("/datasets")
def list_datasets():
    with closing(db.connect()) as conn:
        rows = conn.execute(
            """SELECT d.dataset_id, d.name, d.file_sha256, d.created_at,
                      COUNT(t.transaction_id) AS transaction_count
               FROM datasets d LEFT JOIN transactions t USING (dataset_id)
               GROUP BY d.dataset_id ORDER BY d.dataset_id"""
        ).fetchall()
    loaded = {r["file_sha256"]: r["dataset_id"] for r in rows}
    samples = [
        {"sample_id": sample_id, "name": name, "description": description,
         "dataset_id": loaded.get(sha256(sample_bytes(sample_id)))}
        for sample_id, (name, description) in SAMPLES.items()
    ]
    # Where each dataset came from, by file content: a sample, a CSV test scenario, or a user upload.
    origins = {sha256(sample_bytes(sample_id)): f"sample:{sample_id}" for sample_id in SAMPLES}
    origins |= {sha256((FIXTURE_DIR / f"{fixture_id}.csv").read_bytes()): f"fixture:{fixture_id}" for fixture_id in FIXTURES}
    datasets = [
        {**{k: r[k] for k in ("dataset_id", "name", "created_at", "transaction_count")},
         "source": origins.get(r["file_sha256"], "upload")}
        for r in rows
    ]
    return {"samples": samples, "datasets": datasets}


@app.post("/datasets/preview")
async def preview_csv(file: UploadFile, mapping: str | None = Form(None)):
    """Validate a CSV and report mapping and errors. Never writes to the database."""
    report, _ = parse_csv(await read_upload(file), parse_mapping(mapping))
    return report


@app.post("/datasets", status_code=201)
async def import_csv(file: UploadFile, mapping: str | None = Form(None), name: str = Form("")):
    """Re-validate and import a CSV as a new dataset: all rows or nothing."""
    content = await read_upload(file)
    report, transactions = parse_csv(content, parse_mapping(mapping))
    if report["missing_fields"]:
        code = "mapping_required" if report["unmapped_columns"] else "missing_required_column"
        raise api_error(422, code, f"Required fields not mapped: {', '.join(report['missing_fields'])}.",
                        **report)
    if not report["valid"]:
        raise api_error(422, "invalid_rows",
                        f"{report['error_count']} problem(s) found. Nothing was imported.", **report)

    name = name.strip() or Path(file.filename).stem
    try:
        with closing(db.connect()) as conn, conn:
            dataset_id = db.insert_dataset(conn, name, sha256(content), transactions)
    except sqlite3.IntegrityError as exc:
        if "file_sha256" not in str(exc):
            raise
        raise api_error(409, "duplicate_file", "This file has already been imported.")
    return {"dataset_id": dataset_id, "name": name, "imported_count": len(transactions),
            "uncategorised_count": report["uncategorised_count"]}


@app.post("/datasets/{sample_id}/load")
def load_sample(sample_id: str):
    if sample_id not in SAMPLES:
        raise api_error(404, "sample_not_found",
                        f"Unknown sample '{sample_id}'. Available: {', '.join(SAMPLES)}")
    content = sample_bytes(sample_id)

    with closing(db.connect()) as conn:
        with conn:  # one transaction: dataset and all rows, or nothing
            conn.execute("BEGIN IMMEDIATE")  # serialise concurrent first loads (e.g. React StrictMode)
            existing = conn.execute(
                "SELECT dataset_id FROM datasets WHERE file_sha256 = ?", (sha256(content),)
            ).fetchone()
            if existing:
                dataset_id = existing["dataset_id"]
            else:
                report, transactions = parse_csv(content)
                if not report["valid"]:
                    raise RuntimeError(f"Sample '{sample_id}' failed validation")
                dataset_id = db.insert_dataset(conn, SAMPLES[sample_id][0], sha256(content), transactions)
        count = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()[0]

    return {"dataset_id": dataset_id, "name": SAMPLES[sample_id][0],
            "transaction_count": count, "already_loaded": existing is not None}


@app.get("/samples/{sample_id}/preview")
def preview_sample(sample_id: str):
    if sample_id not in SAMPLES:
        raise api_error(404, "sample_not_found", f"Unknown sample '{sample_id}'.")
    return csv_preview(SAMPLE_DIR / f"{sample_id}.csv")


@app.get("/fixtures")
def list_fixtures():
    return [{"fixture_id": fixture_id, "name": name, "outcome": outcome, "description": description}
            for fixture_id, (name, outcome, description) in FIXTURES.items()]


@app.get("/fixtures/{fixture_id}/preview")
def preview_fixture(fixture_id: str):
    if fixture_id not in FIXTURES:
        raise api_error(404, "fixture_not_found", f"Unknown example '{fixture_id}'.")
    return csv_preview(FIXTURE_DIR / f"{fixture_id}.csv")


@app.get("/fixtures/{fixture_id}/file")
def fixture_file(fixture_id: str):
    """The raw example file, so the UI can send it through the normal import flow."""
    if fixture_id not in FIXTURES:
        raise api_error(404, "fixture_not_found", f"Unknown example '{fixture_id}'.")
    return Response((FIXTURE_DIR / f"{fixture_id}.csv").read_bytes(), media_type="text/csv")


@app.get("/categories")
def list_categories():
    return {"categories": list(CATEGORIES)}


@app.get("/datasets/{dataset_id}/transactions")
def list_transactions(
    dataset_id: DatasetId,
    start_date: IsoDate | None = None,
    end_date: IsoDate | None = None,
    category: CategoryFilter | None = None,
    direction: Direction | None = None,
) -> list[Transaction]:
    """Filters combine with AND. category=uncategorised is the review queue."""
    where, params = where_clause(dataset_id, start_date, end_date, category, direction)
    with closing(db.connect()) as conn:
        require_dataset(conn, dataset_id)
        rows = conn.execute(
            f"SELECT * FROM transactions WHERE {where} ORDER BY date DESC, transaction_id", params
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/datasets/{dataset_id}/summary")
def get_summary(dataset_id: DatasetId, start_date: IsoDate | None = None, end_date: IsoDate | None = None):
    where, params = where_clause(dataset_id, start_date, end_date)
    with closing(db.connect()) as conn:
        require_dataset(conn, dataset_id)
        rows = conn.execute(
            f"SELECT date, category, direction, amount_cents FROM transactions WHERE {where}", params
        ).fetchall()
    filtered = start_date is not None or end_date is not None
    return {"start_date": start_date, "end_date": end_date, **build_summary(rows, filtered)}


@app.patch("/datasets/{dataset_id}/transactions/{transaction_id}/category")
def update_category(dataset_id: DatasetId, transaction_id: str, update: CategoryUpdate) -> Transaction:
    """Set an approved category. Update and audit row commit together; a no-op writes nothing."""
    with closing(db.connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")  # lock before reading, so concurrent repeats can't double-audit
        require_dataset(conn, dataset_id)
        row = conn.execute(
            "SELECT * FROM transactions WHERE dataset_id = ? AND transaction_id = ?",
            (dataset_id, transaction_id),
        ).fetchone()
        if row is None:
            raise api_error(404, "transaction_not_found",
                            f"Transaction '{transaction_id}' not found in dataset {dataset_id}")
        if row["category"] != update.category:
            conn.execute(
                "UPDATE transactions SET category = ? WHERE dataset_id = ? AND transaction_id = ?",
                (update.category, dataset_id, transaction_id),
            )
            conn.execute(
                """INSERT INTO category_audit
                   (dataset_id, transaction_id, previous_category, new_category, changed_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (dataset_id, transaction_id, row["category"], update.category,
                 datetime.now(timezone.utc).isoformat()),
            )
    return {**dict(row), "category": update.category}
