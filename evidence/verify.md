# Verification

## Command
```bash
./verify.sh    # repo root, backend venv active
```
CI (`.github/workflows/ci.yml`) runs the same script on every push to `main` and every PR targeting `main`, using Ubuntu and Python 3.13.

## Automated checks
| Check | Covers |
|-------|--------|
| Backend Pytest (31 tests) | Transaction model validation, health, sample loading, no duplicates on reload, 404/422 errors, foreign keys, dataset isolation |

Each test uses a temporary SQLite database.

## Latest local results (21 Nov 2026)
| Run | Result |
|-----|--------|
| `./verify.sh` (macOS, Python 3.13.13) | 31 passed, exit 0 |
| `verify.sh` run from another directory | exit 0 |
| One deliberately failing test added temporarily | exit 1 (failure propagates) |
| Clean copy of tracked files + fresh venv + `pip install -r backend/requirements.txt` | 31 passed (no private setup needed) |

**Remote CI:** not yet run. Results are recorded here once the workflow has run on GitHub.

## Limitations
- Backend tests only; no linting or type checking.
- Tested on Python 3.13 only.
- No end-to-end or browser tests.

## Future
Stage 5 adds frontend verification: `actions/setup-node` in CI, plus `npm ci && npm run build` (TypeScript check + bundle) in `verify.sh`.
