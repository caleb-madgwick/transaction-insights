# Verification

## Command
```bash
./verify.sh    # repo root, backend venv active, `npm ci` already run
```
Runs Pytest (132 tests, each on a temporary DB), then `npm run build` (`tsc` type-check + Vite build). Any failure → non-zero exit. CI (`.github/workflows/ci.yml`) runs the same script on every push and PR to `main` (Ubuntu, Python 3.13, Node 22, no secrets).

| Tests | Covers |
|-------|--------|
| `test_api.py` (32) | Models, health, sample loading, concurrent loads, 404/422, isolation |
| `test_import.py` (33) | Layouts, mapping, invalid values, duplicates, bad files, atomic rollback |
| `test_summary.py` (31) | Exact cents, totals, breakdowns, months, filters, written summary |
| `test_review.py` (11) | Review flow, audit rows, idempotency, rejected updates |
| `test_examples.py` (25) | Samples, fixture outcomes, allowlisted files, dataset origin |

## Results
| Check | Code | Result |
|-------|------|--------|
| GitHub Actions | `221bf33` | Passed, 129 tests + build ([run 44875040130](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44875040130)) |
| Clean checkout: fresh clone, new venv, `pip install`, `npm ci`, `./verify.sh` | `221bf33` | 129 passed, build OK, exit 0 |
| `./verify.sh` (macOS, Python 3.13.13, Node 22.9.0) | Stage 8 working tree | 132 passed, build OK, exit 0 |
| Browser smoke test (headless Chrome, fresh DB) | Stage 8 working tree | 57/57 |
| GitHub Actions | Stage 8 | Not yet pushed: unverified |

**Browser test** (scratch `puppeteer-core` script, not committed):
- **Happy path:** cards match the API; saving a category writes one audit row; "Needs review" goes 12 → 11; totals are unchanged.
- **Unhappy paths:** invalid amount or date, missing column and unknown headers are rejected and nothing is stored. A duplicate upload is rejected with no success message. A failed save writes no audit row.
- **Stale data:** switching source hides old results; slow older runs never overwrite newer ones.
- **Filters and errors:** filters and their counts match the API. Backend down → "Cannot reach the server"; a 500 → a generic server error with no raw body.
- **How It Works:** endpoints exist in OpenAPI; example JSON matches live responses.
- **Earlier run:** at review time on `221bf33` the test scored 43/45. One fail was a bug in the test's pattern-matching (`/health,`); the other was a real stale test count (128). Both were fixed before the 57/57 run.

**Attack probes (manual, live API):** `.exe` and `x.csv.exe` → 415; binary or zip renamed `.csv` → 400. SQL in CSV fields is stored as literal text and no tables are affected. SQL in path, query or body → 404/422. Path traversal → 404. `<img onerror>` in a company name renders as text, with no script run.

## Gaps
- Browser checks are scratch scripts, not in CI. No frontend unit tests. No linting.
- Tested only on Python 3.13 and Node 22.
- JS bundle 724.95 kB (214.02 kB gzipped); Vite warns about size.
- No authentication, authorisation, rate limiting or monitoring.
- The 1 MB upload limit is checked after the request is received; production needs a proxy limit.
- `requirements.txt` pins direct dependencies only; transitive versions can drift.
