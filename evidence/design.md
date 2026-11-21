# Design

## Architecture
React SPA → (`fetch`, JSON) → FastAPI → SQLite. One process, one database file, no external services.

- **Frontend:** display, filters, upload/mapping forms. No calculations.
- **Backend:** validation, import, all calculations, audit.

## Files

```
backend/
  main.py          routes, sample loading (+ summary in Stage 4)
  db.py            sqlite3 connection + schema
  models.py        Transaction model + categories (shared; avoids circular imports)
  importer.py      CSV parsing, aliases, mapping, validation (no DB access)
  requirements.txt  pytest.ini  tests/
frontend/src/      (Stage 5)
  App.tsx  Overview.tsx  History.tsx  HowItWorks.tsx  api.ts  styles.css
sample-data/       small-business.csv, retail-business.csv (static, synthetic)
  fixtures/        small valid/invalid import examples
verify.sh          all automated checks (local + CI)
.github/workflows/ci.yml
```

## Dependencies

| Backend | Frontend |
|---------|----------|
| fastapi, uvicorn, python-multipart (uploads) | react, react-dom, recharts |
| pytest, httpx2 (TestClient) | vite 6, typescript, @vitejs/plugin-react |

- Vite 6: local Node 22.9 is too old for Vite 7.
- httpx2: Starlette deprecates httpx for its test client.

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
| GET | `/datasets/{id}/transactions` | List transactions | Done (filters: Stage 4) |
| POST | `/datasets/preview` | Validate CSV + mapping; saves nothing | Done |
| POST | `/datasets` | Import CSV as new dataset (atomic) | Done |
| GET | `/datasets/{id}/summary?start&end` | Totals, monthly, by category, text | Stage 4 |
| PATCH | `/datasets/{id}/transactions/{tid}` | Set category (audited) | Stage 4 |
| GET | `/categories` | Approved categories | Stage 4 |

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

## Calculations and review (Stage 4)
- Income = INCOMING, Expenses = OUTGOING, Net = Income − Expenses. Uncategorised included.
- Integer cents only; fixed-template summary text.
- Category change: approved value only, update + audit in one transaction.

## Security
- Parameterised SQL, input validation, DB constraints.
- Uploads not stored; no transaction data in logs.
- No auth (local demo gap).

## Future (not built)
- **AI categorisation:** suggests → checked against approved list → human approves → audited.
- **AI summaries:** explain verified totals only; template fallback.
- **Production:** CDN, API gateway, managed host, PostgreSQL, CI, secrets manager, OIDC auth.
