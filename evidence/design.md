# Design

## Architecture
React SPA → (`fetch`, JSON) → FastAPI → SQLite. One process, one database file, no external services.

- **Frontend:** display, filters, upload/mapping forms. No calculations.
- **Backend:** validation, import, all calculations, audit.

## Files

```
backend/
  main.py          routes, filters, sample loading, category review
  db.py            sqlite3 connection + schema
  models.py        Transaction model, ISO date type, categories (shared; avoids circular imports)
  importer.py      CSV parsing, aliases, mapping, validation (no DB access)
  summary.py       summary calculations + written summary (no DB access)
  requirements.txt  pytest.ini  tests/
frontend/
  src/App.tsx      guided Insights page: data source, Run Insights, CSV import/mapping, results
  src/History.tsx  transaction review table, filters, category assignment
  src/HowItWorks.tsx  one-page engineering walkthrough (inline SVG architecture diagram)
  src/api.ts       response types, one fetch wrapper, integer-cent money formatting
  src/styles.css   all styles (CSS variables for the palette)
  vite.config.ts   dev proxy: /api/* → FastAPI :8000
sample-data/       5 samples: small-business, retail-business, freelancer, missing-categories,
                   cash-flow-challenge (static, synthetic)
  fixtures/        small valid/invalid import examples
verify.sh          all automated checks (local + CI)
.github/workflows/ci.yml
```

## Dependencies

| Backend | Frontend |
|---------|----------|
| fastapi, uvicorn, python-multipart (uploads) | react, react-dom, recharts |
| pytest, httpx2 (TestClient) | vite 6, typescript 5.9, @vitejs/plugin-react 4.7 |

- Vite 6 and plugin-react 4.7: local Node 22.9 is too old for Vite 7+ and plugin-react 5+.
- httpx2: Starlette deprecates httpx for its test client.

## Frontend
- **Guided flow:** nothing is analysed on load; only the dataset, scenario and category lists are fetched.
  - The user chooses one source in a single dropdown (samples, CSV test scenarios, imported datasets, or their own file), then clicks **Run Insights**.
  - **Run Insights:** samples are loaded via the idempotent `/load`; CSV files are imported (re-validated, all-or-nothing) then analysed.
  - Run Insights is disabled until a file passes preview.
- **One page:** the summary and the review table appear after a successful run. Review filters (Direction, Category, Needs review) use the backend query parameters; no date filters in the UI.
- **Backend figures only:** the frontend does no money arithmetic.
- **Stale responses:**
  - Every source change or run takes a sequence number, so an older run, example download or list fetch can't overwrite a newer one.
  - Changing the source clears the import area immediately.
- **Changing the source:** hides previous results until Run Insights. Late responses are ignored.
- **Test scenarios:** the real fixture file goes through the normal preview, so labels match real backend outcomes (tested). Invalid files stay invalid.
- **Dataset origin:** `GET /datasets` labels each dataset `sample:<id>`, `fixture:<id>` or `upload` (by file hash). Only uploads are listed as imported datasets; a scenario that was already imported is reused.

## Data model

| Table | Fields |
|-------|--------|
| `datasets` | dataset_id (PK), name, file_sha256 (unique), created_at |
| `transactions` | PK (dataset_id, transaction_id), date, company, category (nullable), direction, amount_cents (>0), currency (AUD) |
| `category_audit` | dataset_id, transaction_id, previous_category, new_category, changed_at |

- Foreign keys enforced. Model dates must be `YYYY-MM-DD` strings.
- **Income categories:** Sales, Services, Interest, Refunds.
- **Expense categories:** Rent, Wages, Inventory, Supplies, Utilities, Marketing, Software, Insurance, Travel, Fees.

## API

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET | `/health` | Health check | Done |
| GET | `/datasets` | Samples + loaded datasets | Done |
| POST | `/datasets/{sample_id}/load` | Load sample (idempotent) | Done |
| GET | `/datasets/{id}/transactions?start_date&end_date&category&direction` | Filtered list, newest first | Done |
| POST | `/datasets/preview` | Validate CSV + mapping; saves nothing | Done |
| POST | `/datasets` | Import CSV as new dataset (atomic) | Done |
| GET | `/datasets/{id}/summary?start_date&end_date` | Totals, monthly, by category, text | Done |
| PATCH | `/datasets/{id}/transactions/{tid}/category` | Set category (audited) | Done |
| GET | `/categories` | Approved categories | Done |
| GET | `/samples/{id}/preview` | Sample CSV first rows (allowlist, read-only) | Done |
| GET | `/fixtures`, `/fixtures/{id}/preview`, `/fixtures/{id}/file` | CSV test scenarios for the UI | Done |

- Errors: `{"detail": {"code", "message", ...}}`, e.g. `dataset_not_found`, `mapping_required`, `invalid_rows`, `duplicate_file`.
- Invalid path or body values: FastAPI's default 422.

## CSV import
- `.csv`, UTF-8, ≤ 1 MB, ≤ 5,000 rows; parsed in memory with stdlib `csv` and never stored.
- **Two steps:** preview (validate, no writes), then import (re-upload and re-validate, then insert in one transaction).
- **Mapping:** known aliases matched case-insensitively, ignoring spaces and underscores. A supplied `mapping` replaces auto-detection. Required: date, company, amount.
- **Rejected:** unknown column, unsupported field, two columns mapped to one field, a field matched by several columns.
- **Amount:** `[+-]digits[.dd]` → `Decimal` → integer cents, never zero, no floats.
- **Direction:**
  - With a direction column: `INCOMING`/`OUTGOING` (any case), and the amount must be unsigned.
  - Without one: the sign decides (negative = OUTGOING).
  - No direction column and no signed amounts → rejected as ambiguous.
- **Category:** blank → null (needs review); otherwise must be approved (matched case-insensitively).
- **Errors:** file-level problems → 4xx with a `code`; row problems → `{row, field, message}` (up to 50).

**Duplicate identity**
- **File:** SHA-256 of the raw bytes (`UNIQUE`). Re-importing the same file → 409.
- **Transaction:** the `transaction_id` column if supplied (must be unique in the file; DB PK `(dataset_id, transaction_id)`), otherwise `row-<n>`.
- Identical rows without IDs are kept as separate transactions, since repeats are legitimate.

## Summary
- Income = sum of INCOMING, Expenses = sum of OUTGOING, Net = Income − Expenses. Uncategorised rows included.
- **One filtered query** feeds every figure: totals, counts, category breakdowns, monthly and text all use the same date range.
- Category breakdowns: largest first, ties by name; uncategorised = `category: null`.
- Monthly: every month from the first to the last month with data, gaps filled with 0.
- Python `int` arithmetic only. The text is a fixed template covering positive, negative or zero net, no expenses, and empty data.

## Filters and review
- Filters (`start_date`, `end_date` inclusive ISO; `category`, which includes `uncategorised`; `direction`) combine with AND. Invalid values → 422; start > end → `invalid_date_range`.
- WHERE clauses are built from fixed SQL fragments; every value is a bound parameter.
- **Review queue:** `GET .../transactions?category=uncategorised`.
- **Category update:** approved value only (422 otherwise). The transaction must exist in that dataset (404 otherwise).
  - Runs as `BEGIN IMMEDIATE` → UPDATE + `category_audit` INSERT → commit.
  - The same value again → 200, no new audit row.

## Security
- Parameterised SQL, input validation, DB constraints.
- Uploads not stored; no transaction data in logs.
- No auth (local demo gap).

## Future (not built)
- **AI categorisation:** suggests → checked against approved list → human approves → audited.
- **AI summaries:** explain verified totals only; template fallback.
- **Production:** CDN, API gateway, managed host, PostgreSQL, CI, secrets manager, OIDC auth.
