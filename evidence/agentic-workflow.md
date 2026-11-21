# Agentic Workflow

I used ChatGPT to explore options, define the scope and break the work into 8 small stages with focused prompts. I made and own the architectural decisions.

Implementation is carried out using Claude Code in VS Code, following the guidelines in `CLAUDE.md`. Each stage is implemented incrementally, with Claude running relevant tests and reporting its changes. I then use a separate review prompt to identify potential issues, verify the output, and make corrections where needed.

I remain responsible for reviewing the code, validating the results, and making all Git commits to maintain a clear, incremental development history.

## How I steer the AI

I steer the agent with firm rules in `CLAUDE.md` rather than long one-off prompts. Each prompt covers one stage and ends with a stop, so I can check the work before moving on. I don't take "it builds" as proof. I use independent review prompts and browser checks to look for problems the tests miss, and I send fixes back to the agent with a regression test required.

**Representative instructions** (verbatim from `CLAUDE.md`):

| Instruction | Purpose |
|-------------|---------|
| "Money as positive integer cents + explicit direction. No floats." | No rounding or sign errors |
| "Deterministic output. Never guess ambiguous data — ask or reject." | Unclear files are rejected, not interpreted |
| "Atomic imports; reject duplicate files and IDs." | No partial or double-counted data |
| "Build only the current stage." / "End each stage: files changed, risks, then stop." | Small, reviewable steps |
| "Report actual commands and results. State anything skipped or unverified." | Evidence over claims |

**Where I intervened** (found by independent review, not by the implementing agent):

| Agent output | What I caught | Fix |
|--------------|---------------|-----|
| Async data loads | A late, older response could overwrite newer results | Request sequence numbers; browser test with a delayed older run |
| Category save errors | A lost response was reported as "Not saved" though the server may have committed | Distinguish confirmed rejection (4xx) from unconfirmed (network/5xx) and reload; browser test commits then aborts |
| Amount parsing | A 20-digit amount passed preview, then caused a 500 on import | Shared $1bn limit in preview and import; regression tests |
| Sample loading | Concurrent loads of the same sample could duplicate it | Load is idempotent; concurrency test |
