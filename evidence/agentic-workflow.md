# Agentic Workflow

I used ChatGPT to define the project scope, make architectural decisions, and break development into small, manageable stages with focused prompts.

Implementation is carried out using Claude Code in VS Code, following the guidelines in `CLAUDE.md`. Each stage is implemented incrementally, with Claude running relevant tests and reporting its changes. I then use a separate review prompt to identify potential issues, verify the output, and make corrections where needed.

I remain responsible for reviewing the code, validating the results, and making all Git commits to maintain a clear, incremental development history.

## How I steer the AI

I steer the agent with firm rules in `CLAUDE.md` rather than long one-off prompts: money as integer cents with an explicit direction, never guessing ambiguous data, atomic imports, every query scoped by dataset, and reporting actual test results. Each prompt covers one stage and ends with a stop, so I can check the work before moving on. I don't take "it builds" as proof. I use independent review prompts and browser checks to look for problems the tests miss, such as concurrent sample loads and stale async responses, and I send fixes back to the agent with a regression test required.
