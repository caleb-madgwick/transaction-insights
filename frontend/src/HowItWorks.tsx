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
  ["SQLite via sqlite3, no ORM", "Zero setup, real transactions", "Single-user; Postgres for production"],
  ["Atomic imports + duplicate checks", "No partial or double-counted data", "One bad row rejects the file"],
  ["Explicit column mapping, no guessing", "Every value has a clear meaning", "Some files need a mapping step"],
  ["Minimal stack (React state, fetch, plain CSS)", "Fewest dependencies to verify", "No deep links; fewer UI niceties"],
];

const PIPELINE: [string, boolean][] = [
  ["Pull request", true], ["./verify.sh in GitHub Actions", true], ["Code review", false], ["Versioned build", false],
  ["Staging + smoke tests", false], ["Approval", false], ["Production", false], ["Monitor / roll back", false],
];

const SAFETY = [
  ["Data", "Synthetic data only. No credentials or paid APIs. Uploaded files are parsed in memory, never saved."],
  ["Input safety", "Strict CSV validation, parameterised SQL, allowlisted sample files."],
  ["Fails safely", "Invalid CSV → structured row errors, nothing imported. Duplicate file → 409. Invalid category → 422."],
  ["Integrity", "Atomic imports, dataset-scoped queries, audited and idempotent category changes."],
  ["Operability", "GET /health, uvicorn request logs (no transaction values), readable error if the API is down."],
  ["Known gaps", "No authentication (local demo); single-user SQLite."],
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
        <table className="decisions-table">
          <thead><tr><th>Decision</th><th>Why</th><th>Trade-off</th></tr></thead>
          <tbody>
            {DECISIONS.map(([d, why, t]) => <tr key={d}><td>{d}</td><td>{why}</td><td>{t}</td></tr>)}
          </tbody>
        </table>
        <p className="callout">Money is stored as integer cents with an explicit direction, parsed with <code>Decimal</code> at
          the CSV boundary and totalled in the backend. <strong>$1,000.00 − $650.00 = $350.00</strong>, calculated
          exactly, never estimated.</p>
      </Section>

      <Section id="ai" n={3} title="AI agents & verification">
        <div className="two-col">
          <div>
            <h3>How it was built</h3>
            <ul className="ticks">
              <li>ChatGPT: scope and stage plan.</li>
              <li>Claude Code (VS Code): implementation and tests, one scoped stage at a time.</li>
              <li>Separate review prompts checked each stage. The developer reviewed and committed every change.</li>
            </ul>
          </div>
          <div>
            <h3>How the output was verified</h3>
            <ul className="ticks">
              <li><code>./verify.sh</code>: <strong>128</strong> Pytest tests on temporary databases, plus the TypeScript
                check and production build. Passed in GitHub Actions for <code>aa43e38</code> (21 Nov 2026).</li>
              <li>Headless Chrome scripts against the live app (manual, not in CI).</li>
              <li>Deliberate bugs introduced to confirm the tests fail.</li>
            </ul>
          </div>
        </div>
        <p className="callout">Example: verification found that simultaneous first loads of a sample returned 500s
          (duplicate file hash). Fixed with <code>BEGIN IMMEDIATE</code>; a regression test now runs 8 parallel loads.</p>
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
          {SAFETY.map(([title, text]) => <div key={title} className="mini"><strong>{title}</strong><p>{text}</p></div>)}
        </div>
      </Section>

      <Section id="next" n={6} title="What I'd improve with more time" future>
        <ul className="ticks">
          <li>Authentication, per-user data isolation and PostgreSQL with migrations.</li>
          <li>Structured logging, metrics and a deploy pipeline to staging and production.</li>
          <li>Frontend tests in CI; date filters and pagination in the review table.</li>
          <li>AI-assisted categorisation: AI suggests → approved list check → human approves → audited.</li>
          <li>AI-written summaries from verified totals, with every number checked and the current text as fallback.</li>
        </ul>
      </Section>
    </div>
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
  const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" className={accent ? "d-box d-accent" : "d-box"} />
      <text x={x + w / 2} y={y + 28} className="d-title">{title}</text>
      {lines.map((l, i) => <text key={l} x={x + w / 2} y={y + 54 + i * 20} className="d-line">{l}</text>)}
    </g>
  );
  return (
    <svg viewBox="0 0 760 330" className="diagram" role="img"
         aria-label="Browser running React talks to FastAPI over JSON; FastAPI reads sample CSVs and stores data in SQLite; all on the local machine">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="d-arrowhead" />
        </marker>
      </defs>
      <rect x="6" y="6" width="748" height="318" rx="14" className="d-boundary" />
      <text x="24" y="30" className="d-caption">Your machine · runs locally · synthetic data · no credentials</text>

      {box(24, 60, 200, 140, "Browser", ["React + TypeScript", "Choose data · Run Insights", "Charts · Review table"])}
      {box(280, 60, 220, 140, "FastAPI + Pydantic", ["importer.py · validate CSV", "summary.py · cent totals", "main.py · API + audit"], true)}
      {box(556, 60, 180, 140, "SQLite", ["datasets", "transactions", "category_audit"])}
      {box(300, 250, 180, 56, "sample-data/", [])}
      <text x="390" y="296" className="d-line">synthetic CSVs</text>

      <line x1="226" y1="130" x2="276" y2="130" className="d-link" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <text x="251" y="118" className="d-label">JSON</text>
      <line x1="502" y1="130" x2="552" y2="130" className="d-link" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <text x="527" y="118" className="d-label">SQL</text>
      <line x1="390" y1="248" x2="390" y2="204" className="d-link" markerEnd="url(#arrow)" />
    </svg>
  );
}
