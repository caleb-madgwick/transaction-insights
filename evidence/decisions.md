# Decisions

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 1 | Deterministic calculations, no runtime AI | Correct, testable, reproducible figures | Less expressive summary text |
| 2 | SQLite (`sqlite3`), no ORM | Zero setup, real transactions | Single-user only; Postgres for production |
| 3 | Atomic imports + duplicate checks | No partial or double-counted data | Whole file rejected for one bad row |
| 4 | Explicit column mapping, no guessing; direction from a column or a documented sign convention | Every value has a clear meaning | Some files need a mapping step; unsigned files need a direction column |
| 5 | Minimal stack: React state, native fetch, plain CSS, stdlib CSV | Fewest dependencies and files to verify | No deep links; fewer UI niceties |

## System design

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 6 | Backend calculates every figure; frontend only displays | One tested source of truth; UI can't drift from the API | Extra round trip after each review change |
| 7 | Store positive cents + explicit `direction`, not signed amounts | Direction can't be lost to a sign error; DB `CHECK` constraints enforce it | Conversion step at import |
| 8 | Each upload is its own dataset; `(dataset_id, transaction_id)` key and every query scoped by dataset | Full isolation; no merge rules needed | No cross-dataset views or deduplication |
| 9 | Stateless preview, then full re-validation on import; uploads never stored | No orphan files or half-validated state; import can't trust the client | File is parsed twice and sent twice |
| 10 | Category is the only editable field: approved list, update + audit row in one transaction, repeat = no-op | Human review without touching financial values; safe to retry | No custom categories; other fields can't be corrected |
| 11 | Modular monolith: one FastAPI app, plain functions; pure `importer`/`summary` modules, DB only in `main`/`db` | Core logic testable without a DB; little code to review | Needs restructuring (e.g. Postgres, auth) to scale |

## Development process

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 12 | Plan in ChatGPT, implement in Claude Code | Intent, architecture and scoped stage prompts fixed before any code | Two tools to keep consistent |
| 13 | Persistent agent rules in `CLAUDE.md` | Same technical constraints in every stage and session | Rules must be kept current; they can't cover everything |
| 14 | Independent review, not the implementing agent's own assessment | Found stale async responses, ambiguous save failures and unsafe number limits that tests and builds passed | Extra review and fix cycles |
| 15 | Only the human commits to Git | Every change reviewed before it enters a small, staged history | Slower than letting the agent commit |
| 16 | Fresh agent session for final verification | Less anchored on earlier implementation context | Context has to be rebuilt from the repo |
