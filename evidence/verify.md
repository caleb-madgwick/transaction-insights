# Verification

## Command
```bash
./verify.sh    # repo root, backend venv active
```
CI (`.github/workflows/ci.yml`) runs the same script on every push to `main` and every PR targeting `main`, using Ubuntu and Python 3.13.

## Automated checks
| Test file | Covers |
|-----------|--------|
| `test_api.py` (31) | Model validation, health, sample loading, no duplicates on reload, 404/422 errors, foreign keys, isolation |
| `test_import.py` (33) | Both CSV layouts, aliases, manual and invalid mapping, missing columns, bad amounts/dates/direction/category/currency, duplicate IDs and files, bad files, preview never saves, atomic rollback, isolation |

Each test uses a temporary SQLite database.

## Latest local results (21 Nov 2026)
| Run | Result |
|-----|--------|
| `./verify.sh` (macOS, Python 3.13.13) | 64 passed, exit 0 |
| Manual server smoke test (preview, mapped import, duplicate, invalid date, .txt) | 200, 201, 409, 422, 415; server log has no uploaded values |
| Amount parsing spot check (`0.10`, `-0.01`, `1e5`, `1,000`, `$5`, `NaN`, `12.345`) | Exact cents or a clear rejection |

**Remote CI:** passed on GitHub for the Stage 2 + CI commit. Stage 3 not yet pushed.

## Limitations
- Backend tests only; no linting or type checking.
- Tested on Python 3.13 only.
- No end-to-end or browser tests.

## Future
Stage 5 adds frontend verification: `actions/setup-node` in CI, plus `npm ci && npm run build` (TypeScript check + bundle) in `verify.sh`.
