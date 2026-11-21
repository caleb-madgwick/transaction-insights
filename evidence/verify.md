# Verification

## Command
```bash
./verify.sh    # repo root, backend venv active
```
CI (`.github/workflows/ci.yml`) runs the same script on every push to `main` and every PR targeting `main`, using Ubuntu and Python 3.13.

## Automated checks (103 tests)
| Test file | Covers |
|-----------|--------|
| `test_api.py` (31) | Model validation, health, sample loading, no duplicates on reload, 404/422 errors, foreign keys, isolation |
| `test_import.py` (33) | CSV layouts, aliases, mapping, missing columns, invalid values, duplicate IDs and files, bad files, preview never saves, atomic rollback |
| `test_summary.py` (28) | Exact totals (hand-checked and recomputed from sample CSVs), cents, monthly gaps, breakdowns, one date range for all figures, net ±/0, empty data, filters, sort order, isolation |
| `test_review.py` (11) | End-to-end review workflow, persistence, audit contents, idempotency, invalid/unknown/cross-dataset updates write no audit |

Each test uses a temporary SQLite database.

## Remote CI (GitHub Actions)
| Stage | Commit | Result |
|-------|--------|--------|
| 3 | `6379105` | Passed, 64 tests ([run 44868403061](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44868403061)) |
| 4 | Not pushed | Unverified |

## Stage 4 local results (21 Nov 2026, macOS, Python 3.13.13)
| Check | Result |
|-------|--------|
| `./verify.sh` | 103 passed, exit 0 |
| Deliberate bugs, each run against the suite and then reverted (uncategorised excluded from totals, audit written every time, exclusive start date, update not scoped to dataset, no gap filling) | Every bug caught (1–12 failing tests each) |
| SQL injection strings in filters and transaction ID | 422 / 404; data unchanged |

## Limitations
- Backend tests only; no linting or type checking.
- Tested on Python 3.13 only.
- No end-to-end or browser tests.

## Future
Stage 5 adds frontend verification: `actions/setup-node` in CI, plus `npm ci && npm run build` (TypeScript check + bundle) in `verify.sh`.
