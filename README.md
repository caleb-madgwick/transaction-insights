# Transaction Insights

Import transaction CSVs (or use a synthetic sample), see income, expenses and net cash flow, and fix missing categories through an audited review. All figures are calculated by the backend in integer cents. Synthetic data only.

**Stack:** React + TypeScript + Vite · Recharts · FastAPI + Pydantic · SQLite · Pytest · GitHub Actions

## Prerequisites
Python 3.13 and Node.js 22 (the tested versions). No accounts, keys or paid services.

## Run
Two terminals, from the repo root:

```bash
# Backend (port 8000)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

```bash
# Frontend
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**; Vite picks the next free port if that one is taken). The backend must be on port 8000, which the Vite proxy targets. API docs: http://127.0.0.1:8000/docs.

## Verify
```bash
source backend/.venv/bin/activate   # backend venv must be active
./verify.sh                         # backend tests + TypeScript check + build; same script runs in CI
```
Optional browser smoke test (not in CI; needs Google Chrome or `CHROME_PATH`, uses its own temporary DB and ports 8100/5273):
```bash
(cd scripts/browser-smoke && npm ci) && scripts/browser-smoke/run.sh
```

## Demo
On a fresh database:
1. Choose **Missing Categories** in **Data source** (optionally **Preview CSV**).
2. Click **Run Insights**: income $49,642.70, expenses $44,811.15, net $4,831.55, **12 need review**.
3. Click **Needs review**, pick a category for an expense row, then **Save**.
4. Review count drops to 11, the category chart updates, and the totals stay the same.

**Unhappy path:** choose **Invalid amount (Expected rejection)**. The row errors are listed, Run Insights stays disabled, and nothing is stored.

## CSV format
UTF-8 `.csv`, ≤ 1 MB, ≤ 5,000 rows, ISO dates, AUD. Amounts $0.01 to $1,000,000,000.00, max 2 decimals. Negative = expense, or add a `direction` column (`INCOMING`/`OUTGOING`). Blank category = needs review.

```
date,company,category,amount
2026-11-01,Store,Supplies,-125.50
2026-11-02,Client,Sales,1500.00
```

## Known limitations
- Single-user local demo on SQLite; no authentication.
- AUD only; fixed category list; no runtime AI.
- Duplicate detection is exact file bytes plus transaction IDs within a file; no cross-dataset deduplication.
- Audit trail is basic, not tamper-evident.
- Browser smoke test is optional and not in CI; no production deployment.

## Evidence
[Intent](evidence/intent.md) · [Design](evidence/design.md) · [Decisions](evidence/decisions.md) · [Verification](evidence/verify.md) · [Operations](evidence/operate.md) · [Agentic workflow](evidence/agentic-workflow.md)
