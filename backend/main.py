"""Transaction Insights API."""
import hashlib
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path

from fastapi import FastAPI, Form, Path as PathParam, UploadFile

import db
from importer import MAX_BYTES, api_error, parse_csv, parse_mapping
from models import Transaction

SAMPLE_DIR = Path(__file__).parent.parent / "sample-data"
SAMPLES = {"small-business": "Small Business", "retail-business": "Retail Business"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Transaction Insights", lifespan=lifespan)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sample_bytes(sample_id: str) -> bytes:
    return (SAMPLE_DIR / f"{sample_id}.csv").read_bytes()


async def read_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".csv"):
        raise api_error(415, "unsupported_file_type", "Only .csv files are supported.")
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise api_error(413, "file_too_large", f"File must be {MAX_BYTES // 1_000_000} MB or smaller.")
    return content


@app.get("/health")
def health():
    return {"status": "ok"}


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
        {"sample_id": sample_id, "name": name, "dataset_id": loaded.get(sha256(sample_bytes(sample_id)))}
        for sample_id, name in SAMPLES.items()
    ]
    datasets = [
        {k: r[k] for k in ("dataset_id", "name", "created_at", "transaction_count")}
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
            existing = conn.execute(
                "SELECT dataset_id FROM datasets WHERE file_sha256 = ?", (sha256(content),)
            ).fetchone()
            if existing:
                dataset_id = existing["dataset_id"]
            else:
                report, transactions = parse_csv(content)
                if not report["valid"]:
                    raise RuntimeError(f"Sample '{sample_id}' failed validation")
                dataset_id = db.insert_dataset(conn, SAMPLES[sample_id], sha256(content), transactions)
        count = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()[0]

    return {"dataset_id": dataset_id, "name": SAMPLES[sample_id],
            "transaction_count": count, "already_loaded": existing is not None}


@app.get("/datasets/{dataset_id}/transactions")
def list_transactions(
    dataset_id: int = PathParam(ge=1, le=2**63 - 1),  # SQLite INTEGER range; else 422
) -> list[Transaction]:
    with closing(db.connect()) as conn:
        if not conn.execute(
            "SELECT 1 FROM datasets WHERE dataset_id = ?", (dataset_id,)
        ).fetchone():
            raise api_error(404, "dataset_not_found", f"Dataset {dataset_id} does not exist")
        rows = conn.execute(
            "SELECT * FROM transactions WHERE dataset_id = ? ORDER BY date, transaction_id",
            (dataset_id,),
        ).fetchall()
    return [dict(r) for r in rows]
