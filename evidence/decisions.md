# Decisions

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 1 | Deterministic calculations, no runtime AI | Correct, testable, reproducible figures | Less expressive summary text |
| 2 | SQLite (`sqlite3`), no ORM | Zero setup, real transactions | Single-user only; Postgres for production |
| 3 | Atomic imports + duplicate checks | No partial or double-counted data | Whole file rejected for one bad row |
| 4 | Explicit column mapping, no guessing | Every value has a clear meaning | Some files need a mapping step |
| 5 | Minimal stack: React state, native fetch, plain CSS, stdlib CSV | Fewest dependencies and files to verify | No deep links; fewer UI niceties |
