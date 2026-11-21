# Verification

## Command
```bash
./verify.sh    # repo root; backend venv active and `npm ci` already run in frontend/
```
It runs the backend Pytest suite, then `npm run build` in `frontend/` (`tsc --noEmit` type-check + Vite production build). Either failure gives a non-zero exit.

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR targeting `main`: one Ubuntu job with Python 3.13 + `pip install`, Node 22 + `npm ci`, then `./verify.sh`.

## Automated checks
| Check | Covers |
|-------|--------|
| `test_api.py` (32) | Model validation, health, sample loading, concurrent first loads, 404/422, foreign keys, isolation |
| `test_import.py` (33) | CSV layouts, aliases, mapping, invalid values, duplicates, bad files, preview never saves, atomic rollback |
| `test_summary.py` (28) | Exact totals (hand-checked and recomputed from CSVs), cents, months, breakdowns, one date range, net ±/0, empty data, filters |
| `test_review.py` (11) | End-to-end review, audit contents, idempotency, rejected updates write no audit |
| Frontend build | TypeScript strict type-check and production bundle |

## Remote CI (GitHub Actions)
| Stage | Commit | Result |
|-------|--------|--------|
| 3 | `6379105` | Passed, 64 tests ([run 44868403061](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44868403061)) |
| 4 | `e05dae9` | Passed ([run 44869249995](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44869249995)) |
| 5 | Not pushed | Unverified (first run with the frontend build) |

## Stage 5 local results (21 Nov 2026, macOS, Python 3.13.13, Node 22.9.0)
| Check | Result |
|-------|--------|
| `npm install` / `npm ci` | 0 vulnerabilities |
| `./verify.sh` | 104 passed, frontend build OK, exit 0 |
| `verify.sh` with a deliberate TypeScript error | exit 2 (failure propagates) |
| Clean copy + fresh venv + `npm ci` + `./verify.sh` | 104 passed, build OK |
| Concurrent first sample loads (fresh DB, 4 parallel requests), before the fix | 1 × 200, 3 × 500 (`IntegrityError`). Fixed; new test fails 5/5 without the fix and passes 5/5 with it |

**Browser test** (headless Chrome via a scratch `puppeteer-core` script, not a project dependency; live backend on a fresh DB + Vite dev server): 23/23 checks passed.
- Default Small Business loaded once; cards and summary text match the API.
- Both charts render one point or bar per backend entry, including Uncategorised.
- Switching to Retail updates the figures; date filter updates cards and chart; invalid range shows the backend message; Clear restores.
- Unknown headers → manual mapping → import → new dataset selected.
- Invalid file shows row/field errors, Import stays disabled, dashboard unchanged.
- Duplicate import shows the 409 message and adds no dataset.
- No horizontal overflow at 390 px; no console errors.
- With the backend stopped, a clear "Cannot reach the server" message and no crash.

## Limitations
- No frontend unit tests; the UI was verified with the scripted browser run above, which isn't in CI.
- No linting.
- Tested on Python 3.13 and Node 22 only.
- Production bundle is 705 kB (207 kB gzipped), mostly Recharts, which triggers Vite's size warning (not an error).
