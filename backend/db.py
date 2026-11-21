"""SQLite connection and schema."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "transaction_insights.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
    dataset_id  INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    file_sha256 TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    dataset_id     INTEGER NOT NULL REFERENCES datasets (dataset_id),
    transaction_id TEXT NOT NULL,
    date           TEXT NOT NULL,
    company        TEXT NOT NULL,
    category       TEXT,
    direction      TEXT NOT NULL CHECK (direction IN ('INCOMING', 'OUTGOING')),
    amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
    currency       TEXT NOT NULL CHECK (currency = 'AUD'),
    PRIMARY KEY (dataset_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS category_audit (
    audit_id          INTEGER PRIMARY KEY,
    dataset_id        INTEGER NOT NULL,
    transaction_id    TEXT NOT NULL,
    previous_category TEXT,
    new_category      TEXT NOT NULL,
    changed_at        TEXT NOT NULL,
    FOREIGN KEY (dataset_id, transaction_id) REFERENCES transactions (dataset_id, transaction_id)
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    conn.executescript(SCHEMA)
    conn.close()
