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

## Status
Stage 1 of 8: docs and structure only.

## Docs
[Intent](evidence/intent.md) · [Design](evidence/design.md) · [Decisions](evidence/decisions.md)
