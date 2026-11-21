# Design

## Architecture
React (Vite) → `fetch` (HTTP/JSON, multipart CSV upload) → FastAPI → SQLite. Runs locally; no external services.

- **Frontend:** display, filters, upload and mapping forms. No money arithmetic.
- **Backend:** validation, import, all calculations, audit.
- **CI:** GitHub Actions runs `./verify.sh` on every push and PR to `main`.

## Files
| Path | Role |
|------|------|
| `backend/main.py` | Routes, filters, sample loading, category review |
| `backend/importer.py` | CSV parsing, mapping, validation (no DB) |
| `backend/summary.py` | Totals, breakdowns, written summary (no DB) |
| `backend/models.py` · `db.py` | Transaction model, categories · SQLite schema |
| `frontend/src/App.tsx` | Insights page: data source, Run Insights, import, results |
| `frontend/src/History.tsx` | Review table, filters, category assignment |
| `frontend/src/HowItWorks.tsx` | Engineering walkthrough |
| `frontend/src/api.ts` | API types, fetch wrapper, money formatting |
| `sample-data/` | 5 synthetic samples; `fixtures/` = 8 CSV test scenarios |
| `scripts/browser-smoke/` | Optional headless Chrome smoke test (own `puppeteer-core` install, not in CI) |

**Dependencies:** fastapi, uvicorn, python-multipart, pytest, httpx2 · react, react-dom, recharts, vite 6, typescript, @vitejs/plugin-react 4.7 (Vite 6 because Node 22.9 is too old for Vite 7).

## Data
| Table | Key fields |
|-------|------------|
| `datasets` | dataset_id, name, file_sha256 (unique) |
| `transactions` | (dataset_id, transaction_id) PK, date, company, category (null = needs review), direction, amount_cents > 0, currency = AUD |
| `category_audit` | dataset_id, transaction_id, previous_category, new_category, changed_at |

## Key rules
- **Money:** amounts parsed with `Decimal` into positive integer cents plus an explicit direction. No floats.
- **Amount limit:** 1 cent to $1,000,000,000.00 per transaction (`MAX_AMOUNT_CENTS`), enforced by the shared row validator and the model, so preview and import agree. Over-long numbers are rejected before conversion. Max dataset total: 5,000 × 10¹¹ = 5 × 10¹⁴ cents, below SQLite's 2⁶³ − 1 and JavaScript's 2⁵³ − 1.
- **Import:** `.csv`, UTF-8, ≤ 1 MB, ≤ 5,000 rows. Preview validates without writing; import re-validates and inserts all rows or none.
- **No guessing:** unknown headers need a mapping; direction comes from a column or signed amounts, otherwise the file is rejected.
- **Duplicates:** identical file bytes (SHA-256) → 409; duplicate transaction IDs within a file → rejected. No semantic deduplication: the same rows with different whitespace, line endings or order import as a new dataset. That is deliberate: identical-looking rows can be separate payments, and safe merging needs reliable source IDs and business rules.
- **Summary:** net = income − expenses, uncategorised rows included. One query feeds every figure. A category is only called "largest" if it exceeds uncategorised expenses.
- **Review:** approved categories only; update and audit row commit together. Repeating a change is a no-op.
- **Health:** `GET /health` = liveness (no DB). `GET /ready` = read-only DB and schema check; 503 with no details if unavailable.
- **Scope:** every query is filtered by `dataset_id` and uses bound parameters.

## Frontend behaviour
- Pick one **Data source** (sample, CSV test scenario, imported upload or your own file), then **Run Insights**. Nothing is analysed before that.
- Each dataset is labelled `sample:`, `fixture:` or `upload` by file hash. A test scenario is imported once and then reused; only uploads appear under Imported datasets.
- Changing the source hides old results; request sequence numbers stop late responses overwriting newer ones.
- Review filters: Direction, Category, Needs review, Clear all. Filtering is done by the backend. No date filters.
- Errors: API messages are shown as-is; a network failure says "Cannot reach the server"; a non-JSON 500 shows a generic server-error message.
- Category save: a 4xx says "Not saved" (confirmed rejection). A network failure or 5xx says the save could not be confirmed and reloads the list and summary from the server.

## Security (local only)
- **Implemented:** input validation, parameterised SQL, DB constraints, `.csv`-only uploads with size and row limits, allowlisted sample files, no upload storage, React output escaping.
- **Not implemented:** authentication, authorisation, rate limiting, TLS, proxy body-size limit. See [operate.md](operate.md).

## Future (not built)
- **Agent pattern:** deterministic code first; AI does one narrow task; code checks its output; a human approves; the change is audited. Only the AI step is missing today.
- AI category suggestions checked against the approved list, approved by a human and audited.
- AI-written summaries from verified totals, with the template as fallback.
- Production hosting and promotion path: [operate.md](operate.md#production-proposed).
