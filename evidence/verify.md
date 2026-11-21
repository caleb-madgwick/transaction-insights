# Verification

## Command
```bash
./verify.sh    # repo root; backend venv active and `npm ci` already run in frontend/
```
It runs the backend Pytest suite, then `npm run build` in `frontend/` (`tsc --noEmit` type-check + Vite production build). Either failure gives a non-zero exit.

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR targeting `main`: one Ubuntu job with Python 3.13 + `pip install`, Node 22 + `npm ci`, then `./verify.sh`.

## Automated checks (128 backend tests + frontend build)
| Check | Covers |
|-------|--------|
| `test_api.py` (32) | Model validation, health, sample loading, concurrent first loads, 404/422, foreign keys, isolation |
| `test_import.py` (33) | CSV layouts, aliases, mapping, invalid values, duplicates, bad files, preview never saves, atomic rollback |
| `test_summary.py` (28) | Exact totals, cents, months, breakdowns, one date range, net ±/0, empty data, filters |
| `test_review.py` (11) | End-to-end review, audit contents, idempotency, rejected updates write no audit |
| `test_examples.py` (24) | All 5 samples load (≥ 40 rows, 6 months); scenarios match descriptions; previews equal the real files and save nothing; only allowlisted files served (traversal → 404); each fixture's label matches its real backend outcome |
| Frontend build | TypeScript strict type-check and production bundle |

## Remote CI (GitHub Actions)
| Stage | Commit | Result |
|-------|--------|--------|
| 3 | `6379105` | Passed, 64 tests ([run 44868403061](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44868403061)) |
| 4 | `e05dae9` | Passed ([run 44869249995](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44869249995)) |
| 5 | `1b36dfd4` | Passed: 104 tests + build ([run 44870924083](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44870924083)) |
| 6 | `964b7c20` | Passed ([run 44871972807](https://github.com/caleb-madgwick/transaction-insights/actions/runs/44871972807)) |
| UX cleanup | Not pushed | Unverified |

## UX cleanup local results (21 Nov 2026, macOS, Python 3.13.13, Node 22.9.0)
| Check | Result |
|-------|--------|
| `./verify.sh` | 128 passed, frontend build OK, exit 0 |
| Guided browser test (headless Chrome, scratch `puppeteer-core` script, live backend on a fresh DB) | 47/47 |

**What the browser test checked:**
- **Initial page:** no figures, charts or review table; no load, summary or transaction requests (request log checked); three steps shown; nothing selected; Run Insights disabled.
- **Single dropdown:** 5 samples + 8 test scenarios; tabs are Insights / How It Works.
- **Selecting a source:** makes no requests. Sample **Preview CSV** headers equal the real file.
- **Run Insights:** cards equal the API; the review table appears beneath.
- **Changing source:** previous figures stay labelled with a "You selected…" hint; nothing is requested until the next run.
- **Stale runs:** with a slow sample load, an older run never overwrites a newer run, and is discarded if the selection changes.
- **Test scenarios:** each shows the real backend outcome (Valid / Needs mapping / Missing column / row errors). Run Insights is enabled only when valid; rejections store nothing.
  - A valid scenario is imported then analysed in one click.
  - Manual mapping makes the unknown-headers file runnable.
  - A duplicate import is rejected with guidance and leaves results unchanged.
- **Your own file:** an upload through Import CSV shows "Your file: …" and imports and analyses.
- **Mapping follows the source:** hidden when a sample is chosen; on a quick scenario switch, only the newest file's mapping shows.
- **Review:** 2 highlighted rows for the missing-category file.
  - A save with the network aborted keeps the category and writes no audit row.
  - A successful save clears the highlight, writes one audit row, and refreshes the summary (totals unchanged, review 2 → 1).
- **Layout and errors:** no filter or date controls; hint under the dropdown; Run Insights last; no overflow at 390 px; backend down shows a readable error; no console errors.

Layout measured in Chrome: dropdown and Import CSV button both 46 px tall; Run Insights centred.

## Limitations
- The browser test is a scratch script and isn't in CI; there are no frontend unit tests.
- No linting.
- Tested on Python 3.13 and Node 22 only.
- Bundle ~705 kB (~207 kB gzipped); Vite shows a size warning.
