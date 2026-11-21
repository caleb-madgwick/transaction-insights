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
sample-data/  Synthetic CSVs
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

## Status

| Stage | Status |
|-------|--------|
| 1 Docs | Done |
| 2 Backend + samples | Done |
| 3–8 | Not started |

## Docs
[Intent](evidence/intent.md) · [Design](evidence/design.md) · [Decisions](evidence/decisions.md) · [Agentic workflow](evidence/agentic-workflow.md)
