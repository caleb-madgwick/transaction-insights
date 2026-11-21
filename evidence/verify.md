# Verification

## Commands
```bash
source backend/.venv/bin/activate   # repo root; `npm ci` already run in frontend/
./verify.sh                         # runs locally and in CI
```
Runs Pytest (146 tests, each on a temporary DB), then `npm run build` (`tsc` type-check + Vite build). Any failure → non-zero exit. CI (`.github/workflows/ci.yml`) runs the same script on every push and PR to `main` (Ubuntu, Python 3.13, Node 22, no secrets). **Only `./verify.sh` runs in CI.**

```bash
(cd scripts/browser-smoke && npm ci) && scripts/browser-smoke/run.sh   # optional, local only
```
Starts an isolated backend (temporary DB, port 8100) and Vite (5273), runs 61 checks in headless Chrome (`CHROME_PATH` overrides the macOS default), stops both, and exits non-zero on any failure. The development DB is never touched.

| Tests | Covers |
|-------|--------|
| `test_api.py` (36) | Models incl. amount bound, health, readiness, sample loading, concurrent loads, 404/422, isolation |
| `test_import.py` (43) | Layouts, mapping, invalid values, amount limits, duplicates, bad files, atomic rollback |
| `test_summary.py` (31) | Exact cents, totals, breakdowns, months, filters, written summary |
| `test_review.py` (11) | Review flow, audit rows, idempotency, rejected updates |
| `test_examples.py` (25) | Samples, fixture outcomes, allowlisted files, dataset origin |

## Results
| Check | Code | Result |
|-------|------|--------|
| GitHub Actions | `221bf33` | Passed, 129 tests + build ([run 44875040130](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44875040130)) |
| Clean checkout: fresh clone, new venv, `pip install`, `npm ci`, `./verify.sh` | `221bf33` | 129 passed, build OK, exit 0 |
| `./verify.sh` (macOS, Python 3.13.13, Node 22.9.0) | Stage 8 tree (committed as `a2a4bed`) | 132 passed, build OK, exit 0 |
| Scratch browser script (not committed then) | Stage 8 tree (committed as `a2a4bed`) | 57/57 |
| GitHub Actions | `a2a4bed` | Passed ([run 44877086877](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44877086877)) |
| `./verify.sh` (macOS, Python 3.13.13, Node 22.9.0) | Assurance pass, uncommitted | 146 passed, build OK, exit 0 |
| `scripts/browser-smoke/run.sh` (headless Chrome) | Assurance pass, uncommitted | 61/61 |
| GitHub Actions | Assurance pass | Not yet pushed: unverified |

**New regression tests (14):**
- Max amount accepted (signed +/−, leading zeros, explicit direction).
- One cent over, 20-digit and 100,000-digit amounts rejected by preview and import with the same row error; nothing stored.
- 5,000 rows at the max: totals exact and ≤ `Number.MAX_SAFE_INTEGER`.
- Model rejects `amount_cents` above the max.
- `/ready`: 200 when healthy; 503 with no details when the DB can't be opened or a table is missing.

**Browser smoke test** (`scripts/browser-smoke/smoke.mjs`, ported from the earlier scratch script):
- **Happy path:** nothing analysed on open; cards match the API; saving a category writes one audit row; review count drops; totals are unchanged.
- **Save outcomes:** a 422 says "Not saved" with no audit row. For a **lost response**, the PATCH really commits on the backend and the browser connection is then aborted. The UI says the save could not be confirmed, never "Not saved", and reloads to show the saved state. Retrying the same category adds no audit row. A 500 is also reported as unconfirmed.
- **Unhappy paths:** invalid amount, missing column and unknown headers (mapping prompt) are rejected and nothing is stored. A duplicate upload is rejected.
- **Stale data:** switching source hides old results; a deliberately delayed older run never overwrites a newer one.
- **Filters, errors, How It Works:** filters match the API. Backend down → "Cannot reach the server". How It Works endpoints exist in OpenAPI and its example JSON matches live responses. No overflow at 390 px.

**Attack probes (manual, live API, Stage 8 tree):** `.exe` and `x.csv.exe` → 415; binary or zip renamed `.csv` → 400. SQL in CSV fields is stored as literal text and no tables are affected. SQL in path, query or body → 404/422. Path traversal → 404. `<img onerror>` in a company name renders as text, with no script run. Before this pass, a 20-digit amount passed preview and then returned 500 on import; it is now a row error.

## Gaps
- Browser smoke test is optional and local; not in CI. No frontend unit tests. No linting.
- Tested only on Python 3.13 and Node 22; smoke test only on macOS Chrome.
- A CSV field over 131,072 characters is rejected as malformed CSV (400) by Python's `csv` limit, not as an amount row error.
- JS bundle 725.62 kB (214.25 kB gzipped); Vite warns about size.
- No authentication, authorisation, rate limiting or monitoring.
- The 1 MB upload limit is checked after the request is received; production needs a proxy limit.
- `requirements.txt` pins direct dependencies only; transitive versions can drift.
