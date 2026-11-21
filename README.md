# Transaction Insights

Lightweight financial dashboard: import transactions, view income and expenses, fix missing categories. Synthetic data only.

## Features
- **Overview** (done): totals, net cash flow, review count, monthly and category charts, written summary, date filter, dataset selection, CSV upload with column mapping.
- **History** (done): transaction table (newest first), filters, needs-review highlighting, manual category assignment.
- **How It Works** (Stage 7): interactive engineering walkthrough.

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

## Frontend setup
Requires Node.js 22.

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173
```

- **Run both:** start the backend (`uvicorn main:app --reload` in `backend/`) and the frontend in two terminals, then open http://localhost:5173. Vite forwards `/api/*` to the backend on port 8000.
- **Samples:** the app loads Small Business on first open. Switch with **Data source** (Small Business, Retail Business, or any imported dataset).
- **Upload:** click **Import CSV** and choose a file. The detected column mapping is shown; change any column with the dropdowns (or set it to *Ignore*). Row-level errors are listed. **Import** is enabled once the preview is valid, and the new dataset is then selected.
- **Date filter:** **From** / **To** update every card and chart through the backend summary; **Clear** resets them.

### History and category review
- **Table:** shows the selected dataset's transactions, newest first: date, company, category, direction and amount in AUD.
- **Filters:** From / To dates, Direction (All / Incoming / Outgoing) and Category (All / Uncategorised / any approved category) combine. **Needs review** is a quick filter for uncategorised rows, and **Clear filters** resets them all. All filtering is done by the backend.
- **Counts:** "Showing X of Y transactions" for the current filters, plus how many in the whole dataset need review.
- **Review:** uncategorised rows are highlighted. Pick a category from the dropdown on any row; **Save** appears only when the value changed. The backend validates the change and writes the audit record; on failure the row keeps its original category and shows the error.

**Demo:**
1. Open **History** and click **Needs review** (4 rows for Small Business).
2. Choose a category for one row and click **Save**. The row leaves the list and the count drops to 3.
3. Open **Overview**. Totals are unchanged, "Needs review" shows 3, and the category chart includes the change.

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

## Summary, history and review
| Endpoint | Purpose |
|----------|---------|
| `GET /datasets/{id}/summary?start_date=&end_date=` | Totals, counts, income/expense by category, monthly, uncategorised count and amount, written summary |
| `GET /datasets/{id}/transactions?start_date=&end_date=&category=&direction=` | History, newest first. `category=uncategorised` is the review queue. |
| `PATCH /datasets/{id}/transactions/{tid}/category` | Body `{"category": "Supplies"}`. Approved values only; audited. |
| `GET /categories` | Approved category list |

- Dates are ISO `YYYY-MM-DD` and inclusive. All filters are optional and combine with AND.
- Invalid values return 422.
- Money is always integer cents.

```bash
curl -X POST localhost:8000/datasets/small-business/load
curl "localhost:8000/datasets/1/transactions?category=uncategorised"
curl -X PATCH localhost:8000/datasets/1/transactions/SB-005/category \
     -H 'Content-Type: application/json' -d '{"category": "Supplies"}'
curl "localhost:8000/datasets/1/summary?start_date=2026-03-01&end_date=2026-03-31"
```

```json
{"total_income_cents": 641305, "total_expenses_cents": 662365, "net_cents": -21060,
 "monthly": [{"month": "2026-03", "income_cents": 641305, "expenses_cents": 662365}],
 "expenses_by_category": [{"category": "Wages", "amount_cents": 310000}, ...],
 "uncategorised_count": 1,
 "summary_text": "During the selected period, income was $6,413.05 and expenses were $6,623.65, resulting in negative net cash flow of $210.60. Wages was the largest expense category. 1 transaction requires review."}
```

Reassigning a category changes the category breakdowns, never the totals. A repeat of the same change is a no-op.

## Verification and CI
- **Local:** from the repo root, with the venv active and `npm ci` already run in `frontend/`, run `./verify.sh` (non-zero exit on failure).
- **CI:** GitHub Actions installs both dependency sets and runs `./verify.sh` on every push to `main` and every pull request targeting `main`.
- **Checks:** the backend Pytest suite, then the frontend `npm run build` (TypeScript type-check + production bundle).
- Details: [evidence/verify.md](evidence/verify.md).

## Status

| Stage | Status |
|-------|--------|
| 1 Docs | Done |
| 2 Backend + samples | Done |
| 3 CSV import | Done |
| 4 Summary + review | Done |
| 5 Frontend + Overview | Done |
| 6 History + review | Done |
| 7–8 | Not started |

## Docs
[Intent](evidence/intent.md) · [Design](evidence/design.md) · [Decisions](evidence/decisions.md) · [Verification](evidence/verify.md) · [Agentic workflow](evidence/agentic-workflow.md)
