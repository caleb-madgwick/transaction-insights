# Intent

## Problem
Transaction CSVs are inconsistent and often miss categories. Users need trustworthy income/expense figures and an easy way to fix missing categories, without the tool guessing.

## Users
- Individual or small-business owner reviewing transactions.
- Technical reviewer assessing the engineering.

## Workflow
1. **Choose:** a sample dataset, an imported dataset, a CSV test scenario, or upload a CSV (map unknown columns if asked).
2. **Analyse:** click Run Insights to see totals, charts and a summary.
3. **Review:** assign missing categories in the review table below.
4. **How It Works:** see how it's built.

## Assumptions
- Single local user, no auth.
- AUD only. Dates `YYYY-MM-DD` only.
- Direction comes from a direction column, or from signed amounts (negative = OUTGOING). Unsigned amounts with no direction column are rejected.
- Each upload = new dataset.
- Fixed approved category list; blank category = uncategorised.
- Synthetic data, no runtime AI, 3-hour timebox.

## Out of scope
Auth, multi-currency, editing/deleting transactions, merging uploads, debit/credit column formats, date filters in the UI, live bank feeds, runtime AI, production deployment.

## Acceptance criteria
All met. Verified by Pytest (P), the browser smoke test (B) or both; see [verify.md](verify.md).

| Criterion | Verified |
|-----------|----------|
| 5 sample datasets load; loading twice never duplicates | P, B |
| Non-CSV files rejected; missing required columns named | P, B |
| Unknown headers → mapping → import succeeds | P, B |
| Any invalid row rejects the whole file; nothing stored | P, B |
| Amounts above $1,000,000,000.00 rejected the same way by preview and import | P |
| Duplicate files and duplicate transaction IDs rejected | P, B |
| Blank categories import as uncategorised | P |
| Income, expenses, net exact and include uncategorised rows | P, B |
| Monthly and category breakdowns sum to totals | P |
| Written summary deterministic and never misleading on the largest category | P |
| Review filters match the backend and are scoped to the dataset | P, B |
| Category change approved-only, audited, totals unchanged | P, B |
| Unconfirmed save never reported as "Not saved"; state reloaded | B |
| Clear errors; no stale results; summary refreshes after review | B |
| How It Works separates implemented from future designs | B |
| `./verify.sh` passes locally and in CI | Local, CI |
