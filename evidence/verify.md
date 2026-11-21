# Verification

## Command
```bash
./verify.sh    # repo root; backend venv active and `npm ci` already run in frontend/
```
It runs the backend Pytest suite, then `npm run build` in `frontend/` (`tsc --noEmit` type-check + Vite production build). Either failure gives a non-zero exit.

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR targeting `main`: one Ubuntu job with Python 3.13 + `pip install`, Node 22 + `npm ci`, then `./verify.sh`.

## Automated checks (129 backend tests + frontend build)
| Check | Covers |
|-------|--------|
| `test_api.py` (32) | Model validation, health, sample loading, concurrent first loads, 404/422, foreign keys, isolation |
| `test_import.py` (33) | CSV layouts, aliases, mapping, invalid values, duplicates, bad files, preview never saves, atomic rollback |
| `test_summary.py` (28) | Exact totals, cents, months, breakdowns, one date range, net ±/0, empty data, filters |
| `test_review.py` (11) | End-to-end review, audit contents, idempotency, rejected updates write no audit |
| `test_examples.py` (25) | All 5 samples load; scenarios match descriptions; previews equal the real files; allowlist (traversal → 404); fixture labels match real outcomes; dataset origin (sample / fixture / upload) |
| Frontend build | TypeScript strict type-check and production bundle |

## Remote CI (GitHub Actions)
| Stage | Commit | Result |
|-------|--------|--------|
| 3 | `6379105` | Passed, 64 tests ([run 44868403061](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44868403061)) |
| 4 | `e05dae9` | Passed ([run 44869249995](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44869249995)) |
| 5 | `1b36dfd4` | Passed: 104 tests + build ([run 44870924083](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44870924083)) |
| 6 | `964b7c20` | Passed ([run 44871972807](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44871972807)) |
| UX cleanup | `aa43e3833` | Passed: 128 tests + build ([run 44873451988](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44873451988)) |
| 7 | Not pushed | Unverified |

## Stage 7 local results (21 Nov 2026, macOS, Python 3.13.13, Node 22.9.0)
| Check | Result |
|-------|--------|
| `./verify.sh` | 129 passed, frontend build OK, exit 0 |
| Guided Insights browser test (headless Chrome, scratch `puppeteer-core` script, live backend on a fresh DB) | 53/53 |
| How It Works browser test (same setup) | 19/19 |

**Guided Insights test:**
- **Initial page:** no figures and no load or summary requests.
- **Run Insights:** shows backend figures. A new source hides the previous results, and slow older runs never bring them back.
- **Test scenarios:** each shows its real backend outcome. A valid scenario is imported once, then reused on re-run, and isn't listed under Imported datasets.
- **Duplicates and uploads:** a duplicate upload is rejected; your own upload is listed under Imported datasets.
- **Review filters:** Direction, Category, combined, Needs review and Clear all match API counts. There are no date inputs.
- **Review saves:** a failed save keeps the category and writes no audit row. A successful save writes one audit row and leaves totals unchanged.
- **Layout:** no overflow at 390 px; backend-down error; no console errors.

**How It Works test:**
- **Structure:** six labelled sections; implemented versus future labels correct.
- **Diagram:** the architecture is an SVG diagram.
- **Endpoints:** every endpoint shown exists in the backend's `/openapi.json`.
- **Examples:** the JSON examples match live responses field by field.
- **Facts:** the CI figure is shown with its source and date; no bank names; 552 words; no overflow at 390 px.

## Limitations
- The browser tests are scratch scripts and aren't in CI; there are no frontend unit tests.
- No linting.
- Tested on Python 3.13 and Node 22 only.
- Bundle ~705 kB (~207 kB gzipped); Vite shows a size warning.
