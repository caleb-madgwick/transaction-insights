import type { ReactNode } from "react";

// One-page engineering walkthrough. Everything describes the code in this repo unless labelled "Future design".

const FLOW = [
  ["Choose", "Sample, CSV test scenario or your own file", "GET /datasets"],
  ["Validate", "Preview, map columns, see row errors", "POST /datasets/preview"],
  ["Import", "All rows or none", "POST /datasets · POST /datasets/{sample_id}/load"],
  ["Analyse", "Totals, charts, written summary", "GET /datasets/{dataset_id}/summary"],
  ["Review", "Approve a category; change is audited", "PATCH /datasets/{dataset_id}/transactions/{transaction_id}/category"],
];

const DECISIONS = [
  ["Deterministic calculations, no runtime AI", "Correct, testable, reproducible figures", "Less expressive summary text"],
  ["Money as integer cents + direction", "Exact totals in the backend, never floats", "Amounts converted for display"],
  ["SQLite via sqlite3, no ORM", "Zero setup, real transactions", "Single-user; Postgres for production"],
  ["Atomic imports + duplicate checks", "No partial or double-counted data", "One bad row rejects the file"],
  ["Explicit column mapping, no guessing", "Every value has a clear meaning", "Some files need a mapping step"],
  ["Minimal stack (React state, fetch, plain CSS)", "Fewest dependencies to verify", "No deep links; fewer UI niceties"],
];

const SYSTEM_DECISIONS = [
  ["Backend calculates every figure; frontend only displays", "One tested source of truth", "Extra round trip after each review change"],
  ["Each upload is its own dataset; every query scoped by dataset", "Full isolation; no merge rules needed", "No cross-dataset views or deduplication"],
  ["Stateless preview, full re-validation on import; uploads never stored", "No orphan files; import never trusts the client", "File is parsed and sent twice"],
  ["Category is the only editable field: approved list, audited, repeat = no-op", "Human review without touching money; safe to retry", "No custom categories or other corrections"],
  ["One FastAPI app; pure importer and summary modules, DB only in main/db", "Core logic testable without a DB; little code to review", "Needs restructuring to scale"],
];

const PROCESS_DECISIONS = [
  ["Plan in ChatGPT, implement in Claude Code", "Architecture and stage prompts fixed before code", "Two tools to keep consistent"],
  ["Persistent agent rules in CLAUDE.md", "Same constraints in every stage and session", "Rules must be kept current"],
  ["Independent review, not the agent's own assessment", "Found stale async responses, ambiguous save failures and unsafe number limits the build passed", "Extra review and fix cycles"],
  ["Only the human commits to Git", "Every change reviewed; small, staged history", "Slower than agent commits"],
  ["Fresh agent session for final verification", "Less anchored on earlier implementation context", "Context rebuilt from the repo"],
];

const PIPELINE: [string, boolean][] = [
  ["Pull request", true], ["./verify.sh in GitHub Actions", true], ["Code review", false], ["Versioned build", false],
  ["Staging + smoke tests", false], ["Approval", false], ["Production", false], ["Monitor / roll back", false],
];

// Human-in-the-loop agent pattern: everything except the AI step already exists in this app.
const AGENT_FLOW: [string, boolean][] = [
  ["Deterministic code: parse, validate, calculate", true], ["AI: one narrow task (suggest a category)", false],
  ["Code check: approved list only", true], ["Human approves or corrects", true], ["Audited", true],
];

const SAFETY = [
  ["Data", "Synthetic data only. No credentials or paid APIs. Uploaded files are parsed in memory, never saved."],
  ["Input safety", "Strict CSV validation, parameterised SQL, allowlisted sample files."],
  ["Fails safely", "Invalid CSV → structured row errors, nothing imported. Amounts over $1,000,000,000.00 rejected. " +
    "Duplicate file → 409. Invalid category → 422. A save with no reply is reported as unconfirmed and reloaded."],
  ["Integrity", "Atomic imports, dataset-scoped queries, audited and idempotent category changes."],
  ["Operability", "GET /health (liveness) and GET /ready (database check). Uvicorn request logs show method, path " +
    "and status; paths can contain transaction IDs. The app logs no CSV contents. Readable errors if the API is down or fails."],
  ["Not implemented (production)", "Authentication, authorisation, rate limiting, proxy request-size limits, " +
    "TLS and monitoring are proposed designs, not built. Single-user local SQLite."],
];

const SUMMARY_EXAMPLE = `GET /datasets/1/summary
{
  "total_income_cents": 4186193,
  "total_expenses_cents": 3861170,
  "net_cents": 325023,
  "uncategorised_count": 4,
  "summary_text": "Across all transactions, income was $41,861.93 and expenses were $38,611.70, resulting in positive net cash flow of $3,250.23. Wages was the largest expense category. 4 transactions require review."
}

PATCH /datasets/1/transactions/SB-005/category   {"category": "Supplies"}
{
  "transaction_id": "SB-005",
  "dataset_id": 1,
  "date": "2026-01-20",
  "company": "Kestrel Print Co",
  "category": "Supplies",
  "direction": "OUTGOING",
  "amount_cents": 14580,
  "currency": "AUD"
}`;

export default function HowItWorks() {
  return (
    <div className="hiw">
      <section className="card hiw-intro">
        <h1>How It Works</h1>
        <p className="muted">What it does, how it's built and verified, and what comes next.</p>
      </section>

      <Section id="walkthrough" n={1} title="Walkthrough">
        <div className="diagram-wrap"><Architecture /></div>
        <ol className="flow-row">
          {FLOW.map(([step, text, endpoint], i) => (
            <li key={step}>
              <span className="flow-n">{i + 1}</span>
              <strong>{step}</strong>
              <p>{text}</p>
              <code>{endpoint}</code>
            </li>
          ))}
        </ol>
        <details className="hiw-details">
          <summary>Example request and response</summary>
          <p className="muted">Real responses captured from the local API with synthetic data. Fields shortened; not
            executed from this page.</p>
          <pre className="code">{SUMMARY_EXAMPLE}</pre>
        </details>
      </Section>

      <Section id="design" n={2} title="Design & technology choices">
        <p className="stack">React + TypeScript + Vite · FastAPI + Pydantic · SQLite (sqlite3) · Recharts · Pytest</p>
        <Decisions rows={DECISIONS} />
        <h3>System design</h3>
        <Decisions rows={SYSTEM_DECISIONS} />
      </Section>

      <Section id="ai" n={3} title="AI agents & verification">
        <div className="two-col">
          <div>
            <h3>How it was built</h3>
            <ul className="ticks">
              <li><strong>Plan:</strong> ChatGPT set the scope and stage prompts.</li>
              <li><strong>Build:</strong> Claude Code built one stage at a time, following <code>CLAUDE.md</code> rules.</li>
              <li><strong>Review:</strong> a separate prompt checked each stage.</li>
              <li><strong>Human:</strong> the developer reviewed and committed every change.</li>
            </ul>
          </div>
          <div>
            <h3>How it was verified</h3>
            <ul className="ticks">
              <li><strong>One command:</strong> <code>./verify.sh</code> runs the backend tests, TypeScript check and build.</li>
              <li><strong>Every push:</strong> GitHub Actions runs the same script.</li>
              <li><strong>Browser:</strong> an optional headless Chrome smoke test runs against the app (not in CI).</li>
            </ul>
          </div>
        </div>
        <h3>Process decisions</h3>
        <Decisions rows={PROCESS_DECISIONS} />
      </Section>

      <Section id="cicd" n={4} title="CI/CD & cloud" future>
        <div className="pipeline">
          {PIPELINE.map(([name, done]) => <span key={name} className={done ? "done" : ""}>{name}</span>)}
        </div>
        <p className="muted"><span className="legend done" /> Implemented today <span className="legend" /> Future design</p>
        <p className="stack">Static frontend on a CDN · FastAPI containers on a managed host · PostgreSQL · OIDC sign-in ·
          secrets manager · logs, metrics and alerts · versioned releases with rollback</p>
      </Section>

      <Section id="safety" n={5} title="Security, privacy, operability & failure handling">
        <div className="grid-cards">
          {SAFETY.map(([title, text]) => (
            <div key={title} className={title.startsWith("Not implemented") ? "mini gap" : "mini"}>
              <strong>{title}</strong><p>{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="next" n={6} title="What I'd improve with more time" future>
        <ul className="ticks">
          <li>Authentication, per-user data isolation and PostgreSQL with migrations.</li>
          <li>Structured logging, metrics and a deploy pipeline to staging and production.</li>
          <li>Frontend tests in CI; date filters and pagination in the review table.</li>
        </ul>
        <h3>The same pattern for an AI agent workflow</h3>
        <p className="callout">This app already keeps deterministic code (validation, cent totals, approved categories,
          audit) separate from human decisions (column mapping, category review). An AI agent workflow would use the
          same structure: code does everything it can deterministically, the AI does <strong>one narrow task</strong>,
          code checks its output, a human approves, and every change is audited. Only the AI step is missing today.</p>
        <div className="pipeline">
          {AGENT_FLOW.map(([name, done]) => <span key={name} className={done ? "done" : ""}>{name}</span>)}
        </div>
        <p className="muted"><span className="legend done" /> Implemented today <span className="legend" /> Future design</p>
        <ul className="ticks">
          <li>Categorisation: AI suggests a category for an uncategorised row; it must be on the approved list; the
            reviewer accepts or changes it.</li>
          <li>Summaries: AI rewrites the summary from verified totals only; every number is checked and the current
            template is the fallback.</li>
        </ul>
      </Section>
    </div>
  );
}

function Decisions({ rows }: { rows: string[][] }) {
  return (
    <table className="decisions-table">
      <thead><tr><th>Decision</th><th>Why</th><th>Trade-off</th></tr></thead>
      <tbody>
        {rows.map(([d, why, t]) => <tr key={d}><td>{d}</td><td>{why}</td><td>{t}</td></tr>)}
      </tbody>
    </table>
  );
}

function Section({ id, n, title, future = false, children }: {
  id: string; n: number; title: string; future?: boolean; children: ReactNode;
}) {
  return (
    <section id={id} className="card hiw-section">
      <div className="hiw-head">
        <h2><span className="step-number">{n}</span>{title}</h2>
        <span className={future ? "badge future" : "badge done"}>{future ? "Future design" : "Implemented"}</span>
      </div>
      {children}
    </section>
  );
}

function Architecture() {
  const box = (x: number, y: number, w: number, title: string, line: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={80} rx="10" className={accent ? "d-box d-accent" : "d-box"} />
      <text x={x + w / 2} y={y + 34} className="d-title">{title}</text>
      <text x={x + w / 2} y={y + 58} className="d-line">{line}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 250" className="diagram" role="img"
         aria-label="React in the browser talks to FastAPI over HTTP (JSON and CSV uploads); FastAPI reads sample CSVs and stores data in SQLite; all runs locally">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="d-arrowhead" />
        </marker>
      </defs>
      <rect x="6" y="6" width="748" height="238" rx="14" className="d-boundary" />
      <text x="24" y="30" className="d-caption">Runs locally · synthetic data</text>

      {box(24, 50, 186, "React", "Insights · Review")}
      {box(280, 50, 220, "FastAPI", "Validate · Calculate · Audit", true)}
      {box(556, 50, 180, "SQLite", "Datasets · Audit log")}
      {box(300, 160, 180, "Sample CSVs", "Synthetic data")}

      <line x1="212" y1="90" x2="276" y2="90" className="d-link" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <text x="244" y="80" className="d-label">HTTP/JSON</text>
      <line x1="502" y1="90" x2="552" y2="90" className="d-link" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <text x="527" y="80" className="d-label">SQL</text>
      <line x1="390" y1="158" x2="390" y2="134" className="d-link" markerEnd="url(#arrow)" />
    </svg>
  );
}
