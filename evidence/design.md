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
  importer.py      CSV parsing, aliases, mapping (Stage 3)
  requirements.txt  pytest.ini  tests/
frontend/src/      (Stage 5)
  App.tsx  Overview.tsx  History.tsx  HowItWorks.tsx  api.ts  styles.css
sample-data/       small-business.csv, retail-business.csv (static, synthetic)
verify.sh          all automated checks (local + CI)
.github/workflows/ci.yml
```

## Dependencies

| Backend | Frontend |
|---------|----------|
| fastapi, uvicorn (+ python-multipart in Stage 3) | react, react-dom, recharts |
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
| POST | `/datasets` | Upload CSV (+ optional mapping) | Stage 3 |
| GET | `/datasets/{id}/summary?start&end` | Totals, monthly, by category, text | Stage 4 |
| PATCH | `/datasets/{id}/transactions/{tid}` | Set category (audited) | Stage 4 |
| GET | `/categories` | Approved categories | Stage 4 |

- Errors: `{"detail": {"code", "message"}}`, e.g. `dataset_not_found`.
- Invalid path or body values: FastAPI's default 422.

## CSV import (Stage 3)
- `.csv`, UTF-8, ≤ 2 MB, stdlib `csv`, in memory.
- Known aliases (e.g. `payee` → company); unknown headers → user maps.
- Date `YYYY-MM-DD` or `DD/MM/YYYY`; amount positive, ≤ 2 decimals → cents.
- Direction: in/credit → INCOMING, out/debit → OUTGOING, else reject.
- Blank category → null; otherwise must be approved.
- All-or-nothing; duplicate file or transaction ID rejected.

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
