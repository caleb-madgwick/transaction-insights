# CLAUDE.md

**Transaction Insights** — small financial dashboard, built in 8 stages within 3 hours. See `evidence/` for intent, design and decisions.

## Rules
- No Git commits — the human commits.
- No bank or employer names anywhere.
- Synthetic data only.
- No AI SDKs, external APIs or paid services.
- Build only the current stage.

## Stack
- **Frontend:** React + TypeScript + Vite, plain CSS, Recharts, native `fetch`, React state.
- **Backend:** FastAPI + Pydantic, SQLite (`sqlite3`), stdlib `csv`, Pytest.
- **Do not add:** ORMs, React Router, state libraries, Tailwind/component libraries, Axios, Pandas, Docker, microservices, DI frameworks, repository/service layers.
- Prefer plain functions over classes. Planned files and dependencies are in `evidence/design.md`; justify any new one.

Colours: red `#D71920`, white `#FFFFFF`, charcoal `#242424`, grey `#F5F6F8`. Minimal, responsive.

## Principles
- Least code that is correct, readable and tested.
- Backend calculates all figures; frontend only displays.
- Money as positive integer cents + explicit direction. No floats.
- Deterministic output. Never guess ambiguous data — ask or reject.
- Every query scoped by `dataset_id`.

## Data integrity
- Parameterised SQL; validate all input.
- Atomic imports; reject duplicate files and IDs.
- Missing categories are valid (human review).
- Category changes: approved values only, audited.
- No transaction data in logs.

## Docs
Keep all Markdown short: key points, bullets and tables. No long prose.

## Stages
1. Docs and structure
2. Backend core + sample data
3. CSV import + validation
4. Summary, transactions, category review
5. Frontend + Overview
6. History
7. How It Works
8. Hardening, evidence, final review

## Testing and reporting
- Pytest for backend incl. unhappy paths (temp DB). `npm run build` for frontend.
- Report actual commands and results. State anything skipped or unverified.
- End each stage: files changed, risks, then stop.
