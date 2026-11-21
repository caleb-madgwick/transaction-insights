# Intent

## Problem
Transaction CSVs are inconsistent and often miss categories. Users need trustworthy income/expense figures and an easy way to fix missing categories, without the tool guessing.

## Users
- Individual or small-business owner reviewing transactions.
- Technical reviewer assessing the engineering.

## Workflow
1. Select a sample dataset or upload a CSV (map unknown columns if asked).
2. **Overview:** totals, charts, summary, date filter.
3. **History:** filter transactions, assign missing categories.
4. **How It Works:** see how it's built.

## Assumptions
- Single local user, no auth.
- AUD only. Dates `YYYY-MM-DD` or `DD/MM/YYYY`.
- Direction must be explicit; signed amounts rejected.
- Each upload = new dataset.
- Fixed approved category list; blank category = uncategorised.
- Synthetic data, no runtime AI, 3-hour timebox.

## Out of scope
Auth, multi-currency, editing/deleting transactions, merging uploads, debit/credit column formats, live bank feeds, runtime AI, cloud deployment.

## Acceptance criteria
- [ ] Two sample datasets load on start, never duplicated.
- [ ] Non-CSV files rejected.
- [ ] Missing required columns named in error.
- [ ] Unknown headers → mapping prompt → import succeeds.
- [ ] Any invalid row (date, amount, direction, currency, category) rejects the whole file.
- [ ] Duplicate files and duplicate transaction IDs rejected.
- [ ] Blank categories import as uncategorised.
- [ ] Income, expenses, net are correct and include uncategorised rows.
- [ ] Chart aggregates sum to totals.
- [ ] Summary text is deterministic.
- [ ] Filters work and are scoped to the dataset.
- [ ] Category change saved with audit record; invalid category rejected.
- [ ] UI shows clear errors and refreshes summary after changes.
- [ ] How It Works labels each item as implemented, verified or future.

## Done when
- Criteria met or gaps documented.
- `pytest` and `npm run build` pass (real output recorded).
- Runs locally from README.
