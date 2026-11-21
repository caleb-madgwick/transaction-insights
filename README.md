# Transaction Insights

Lightweight financial dashboard: import transactions, view income and expenses, fix missing categories. Synthetic data only.

## Features (planned)
- **Overview:** totals, charts, summary, date filter, upload.
- **History:** filterable table, assign missing categories.
- **How It Works:** interactive engineering walkthrough.

## Stack
React + TypeScript + Vite · FastAPI + Pydantic · SQLite · Recharts · Pytest

## Structure
```
backend/      API and tests
frontend/     React app
sample-data/  Synthetic CSVs (fixtures/ = import examples)
evidence/     Intent, design, decisions
```

## Backend setup
Requires Python 3.11+.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Run:** `uvicorn main:app --reload`, then open http://127.0.0.1:8000/docs.
- `POST /datasets/small-business/load` loads a sample.
- The database is created at `backend/transaction_insights.db` and is git-ignored.

**Test:** `pytest` (each test uses its own temporary database).

## CSV import
Two layouts are supported (UTF-8, ≤ 1 MB, ≤ 5,000 rows, ISO dates, AUD):

```
date,company,category,amount              date,company,category,direction,amount
2026-11-01,Store,Supplies,-125.50         2026-11-01,Store,Supplies,OUTGOING,125.50
2026-11-02,Client,Sales,1500.00           2026-11-02,Client,Sales,INCOMING,1500.00
```
- **Signed:** negative = OUTGOING, positive = INCOMING.
- **Explicit:** direction must be `INCOMING` or `OUTGOING`, and amounts must be unsigned.
- **Optional columns:** `category` (blank = needs review), `currency`, `transaction_id`.

| Endpoint | Purpose |
|----------|---------|
| `POST /datasets/preview` | Validate and show the mapping and errors. Saves nothing. |
| `POST /datasets` | Re-validate and import as a new dataset (all rows or none) |

Both take multipart `file`, plus an optional `mapping` field (JSON: CSV column → field). Import also takes an optional `name`.

```bash
curl -F file=@sample-data/fixtures/signed-amount.csv localhost:8000/datasets/preview
curl -F file=@sample-data/fixtures/unknown-headers.csv \
     -F 'mapping={"When":"date","Payee":"company","Kind":"category","Sum":"amount"}' \
     localhost:8000/datasets
```

**Common errors** (`{"detail": {"code", "message", ...}}`):
- `unsupported_file_type`, `empty_file`, `invalid_encoding`, `malformed_csv`, `file_too_large`
- `mapping_required` (unknown headers), `missing_required_column`, `invalid_mapping`
- `invalid_rows`: row-level `{row, field, message}` for bad dates, amounts, direction, category, currency or duplicate IDs
- `duplicate_file` (409): this file was already imported

Example files are in `sample-data/fixtures/`.

## Verification and CI
- **Local:** from the repo root with the venv active, run `./verify.sh` (non-zero exit on failure).
- **CI:** GitHub Actions runs `./verify.sh` on every push to `main` and every pull request targeting `main`.
- **Checks:** the backend Pytest suite. Frontend build checks are added in Stage 5.
- Details: [evidence/verify.md](evidence/verify.md).

## Status

| Stage | Status |
|-------|--------|
| 1 Docs | Done |
| 2 Backend + samples | Done |
| 3 CSV import | Done |
| 4–8 | Not started |

## Docs
[Intent](evidence/intent.md) · [Design](evidence/design.md) · [Decisions](evidence/decisions.md) · [Verification](evidence/verify.md) · [Agentic workflow](evidence/agentic-workflow.md)
