"""Transaction Insights API."""
import csv
import hashlib
import io
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as PathParam

import db
from models import Transaction

SAMPLE_DIR = Path(__file__).parent.parent / "sample-data"
SAMPLES = {"small-business": "Small Business", "retail-business": "Retail Business"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Transaction Insights", lifespan=lifespan)


def not_found(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": code, "message": message})


def to_cents(amount: str) -> int:
    """Convert a decimal dollar string to integer cents without floats."""
    cents = Decimal(amount) * 100
    if cents != cents.to_integral_value():
        raise ValueError(f"Amount '{amount}' has more than 2 decimal places")
    return int(cents)


def sample_bytes(sample_id: str) -> bytes:
    return (SAMPLE_DIR / f"{sample_id}.csv").read_bytes()


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
        {"sample_id": sample_id, "name": name,
         "dataset_id": loaded.get(hashlib.sha256(sample_bytes(sample_id)).hexdigest())}
        for sample_id, name in SAMPLES.items()
    ]
    datasets = [
        {k: r[k] for k in ("dataset_id", "name", "created_at", "transaction_count")}
        for r in rows
    ]
    return {"samples": samples, "datasets": datasets}


@app.post("/datasets/{sample_id}/load")
def load_sample(sample_id: str):
    if sample_id not in SAMPLES:
        raise not_found("sample_not_found",
                        f"Unknown sample '{sample_id}'. Available: {', '.join(SAMPLES)}")
    content = sample_bytes(sample_id)
    file_hash = hashlib.sha256(content).hexdigest()

    with closing(db.connect()) as conn:
        with conn:  # one transaction: dataset and all rows, or nothing
            existing = conn.execute(
                "SELECT dataset_id FROM datasets WHERE file_sha256 = ?", (file_hash,)
            ).fetchone()
            if existing:
                dataset_id = existing["dataset_id"]
            else:
                dataset_id = conn.execute(
                    "INSERT INTO datasets (name, file_sha256, created_at) VALUES (?, ?, ?)",
                    (SAMPLES[sample_id], file_hash, datetime.now(timezone.utc).isoformat()),
                ).lastrowid
                transactions = [
                    Transaction(
                        transaction_id=row["transaction_id"],
                        dataset_id=dataset_id,
                        date=row["date"],
                        company=row["company"],
                        category=row["category"] or None,
                        direction=row["direction"],
                        amount_cents=to_cents(row["amount"]),
                        currency=row["currency"],
                    )
                    for row in csv.DictReader(io.StringIO(content.decode("utf-8")))
                ]
                conn.executemany(
                    "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [(t.dataset_id, t.transaction_id, t.date.isoformat(), t.company,
                      t.category, t.direction, t.amount_cents, t.currency)
                     for t in transactions],
                )
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
            raise not_found("dataset_not_found", f"Dataset {dataset_id} does not exist")
        rows = conn.execute(
            "SELECT * FROM transactions WHERE dataset_id = ? ORDER BY date, transaction_id",
            (dataset_id,),
        ).fetchall()
    return [dict(r) for r in rows]
