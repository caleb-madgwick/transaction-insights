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
| 5 | `1b36dfd4` | Passed: 104 tests + frontend build ([run 44870924083](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44870924083)) |
| 6 | Not pushed | Unverified |

## Stage 6 local results (21 Nov 2026, macOS, Python 3.13.13, Node 22.9.0)
| Check | Result |
|-------|--------|
| `./verify.sh` | 104 passed, frontend build OK, exit 0 |

**Browser tests:** headless Chrome via scratch `puppeteer-core` scripts (not project dependencies), against a live backend on a fresh DB and a Vite dev server. Slow and failed requests were simulated with request interception.

| Suite | Result |
|-------|--------|
| Stage 5 review fixes (stale sample selection, stale CSV preview) | Before the fixes, 3 of 4 scenarios failed. After the fixes, 5/5 checks pass. |
| History workflow | 27/27 |
| Overview regression (Stage 5 suite) | 23/23 |

- **Review fixes:**
  - A slow sample load no longer overrides a newer dataset choice (A) or a later import (B).
  - Clearing the file discards a pending preview, and the panel isn't left stuck in a busy state (D).
  - Replacing the file (C) already worked.
- **History:**
  - All rows shown newest first, in the same order as the API; dates and AUD amounts formatted; uncategorised rows highlighted.
  - Direction, date, category and combined filters match API counts; invalid range shows the backend message; empty-results message.
  - **Needs review** shows the 4 uncategorised rows.
  - A save with the network aborted shows "Not saved…", keeps the original category, shows no success message and writes no audit row.
  - A successful save updates the backend, writes one audit row (previous NULL → Supplies), drops the queue from 4 to 3 and refreshes the count.
  - **Overview afterwards:** totals unchanged, "Needs review" card 4 → 3, Supplies +amount and Uncategorised −amount.
  - With the first dataset's responses delayed 1.5 s, a quick switch to Retail shows only Retail rows.
  - At 390 px, the table scrolls inside its card with no page overflow.
  - With the backend stopped, a readable error and the page keeps working.

## Limitations
- No frontend unit tests; the browser suites are scratch scripts and aren't in CI.
- No linting.
- Tested on Python 3.13 and Node 22 only.
- Production bundle is ~705 kB (~207 kB gzipped), mostly Recharts; Vite shows a size warning (not an error).
