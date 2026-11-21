import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, ApiError, countLabel as count, errorText, FIELDS, formatMoney, formatMonth } from "./api";
import type { CsvPreview, DatasetList, Fixture, Preview, Summary } from "./api";
import History from "./History";
import HowItWorks from "./HowItWorks";

const TABS = ["Insights", "How It Works"] as const;
type Tab = (typeof TABS)[number];

// Axis labels only; exact values use formatMoney.
const axisMoney = (cents: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: "compact" }).format(cents / 100);
const tooltipMoney = (value: unknown) => formatMoney(Number(value));

export default function App() {
  const [tab, setTab] = useState<Tab>("Insights");
  const [list, setList] = useState<DatasetList | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [categories, setCategories] = useState<string[] | null | undefined>(undefined);  // null = failed
  const [source, setSource] = useState("");  // "sample:<id>", "dataset:<id>", "fixture:<id>" or "upload"
  const [analysed, setAnalysed] = useState<{ id: number; name: string } | null>(null);  // what results show
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);  // bumped after a category change to re-fetch the summary
  const [importSeed, setImportSeed] = useState<{ file: File | null; key: number }>({ file: null, key: 0 });
  const [csv, setCsv] = useState<CsvStatus | null>(null);  // the loaded CSV, once its preview has run

  // Every source change or Run Insights takes a new number; an older run can never apply its result.
  const run = useRef(0);
  const listRequest = useRef(0);

  async function refreshList() {
    const request = ++listRequest.current;
    const latest = await api.datasets();
    if (request === listRequest.current) setList(latest);
  }

  useEffect(() => {
    // Only the selector's options load up front; nothing is analysed until Run Insights.
    refreshList().catch((e) => setError(errorText(e)));
    api.fixtures().then(setFixtures).catch(() => setFixtures([]));
    api.categories().then((r) => setCategories(r.categories)).catch(() => setCategories(null));
  }, []);

  useEffect(() => {
    if (analysed === null) return;
    let current = true;  // ignore responses for a dataset that is no longer being analysed
    setLoading(true);
    setError("");
    api.summary(analysed.id)
      .then((s) => current && setSummary(s))
      .catch((e) => {
        if (current) {
          setSummary(null);
          setError(errorText(e));
        }
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [analysed, refreshKey]);

  const [kind, sourceId] = source.split(":");
  const sample = kind === "sample" ? list?.samples.find((s) => s.sample_id === sourceId) : undefined;
  const fixture = kind === "fixture" ? fixtures.find((f) => f.fixture_id === sourceId) : undefined;
  const imported = list?.datasets.filter((d) => d.source === "upload") ?? [];  // samples and scenarios aren't listed
  const scenarioDataset = fixture && list?.datasets.find((d) => d.source === `fixture:${fixture.fixture_id}`);
  const sourceName = sample?.name ?? imported.find((d) => `dataset:${d.dataset_id}` === source)?.name ?? "";

  const fromFile = kind === "fixture" || kind === "upload";  // Run Insights imports the file, then analyses it
  const canRun = scenarioDataset ? true : fromFile ? csv?.ready === true : source !== "";

  function resetImport(file: File | null = null) {
    setCsv(null);
    setImportSeed((seed) => ({ file, key: seed.key + 1 }));
  }

  // Any new source hides the previous results until Run Insights is clicked again.
  function startNewSource(value: string): number {
    const request = ++run.current;  // a run still in progress for the old source must not apply
    setRunning(false);
    setSource(value);
    setNotice("");
    setError("");
    setAnalysed(null);  // unmounts results and review; the summary effect ignores late responses
    setSummary(null);
    return request;
  }

  function chooseSource(value: string) {
    const request = startNewSource(value);
    resetImport();  // hide the previous file's mapping straight away
    if (value.startsWith("fixture:")) loadExample(value.slice("fixture:".length), request);
  }

  async function runInsights() {
    const request = ++run.current;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      let target = { id: Number(sourceId), name: sourceName };
      if (sample) {
        target = { id: (await api.loadSample(sample.sample_id)).dataset_id, name: sample.name };  // idempotent
        await refreshList();
      } else if (scenarioDataset) {
        target = { id: scenarioDataset.dataset_id, name: fixture!.name };  // already imported once: reuse it
      } else if (fromFile && csv) {
        const result = await api.importCsv(csv.file, csv.mapping);  // backend re-validates; all rows or none
        await refreshList();
        target = { id: result.dataset_id, name: fixture?.name ?? result.name };
        if (request === run.current) {
          if (kind === "upload") {
            resetImport();
            setSource(`dataset:${result.dataset_id}`);  // the upload is now an imported dataset
          }
          setNotice(`Imported ${count(result.imported_count)} (${result.uncategorised_count} need review).`);
        }
      }
      if (request !== run.current) return;
      setSummary(null);  // never show the previous dataset's figures under the new name
      setAnalysed(target);
      if (tab === "How It Works") setTab("Insights");
    } catch (e) {
      if (request !== run.current) return;
      setError(e instanceof ApiError && e.code === "duplicate_file"
        ? "This file has already been imported. Choose the existing dataset, sample or test scenario in the Data source list."
        : errorText(e));
    } finally {
      if (request === run.current) setRunning(false);
    }
  }

  async function loadExample(fixtureId: string, request: number) {
    try {
      const file = await api.fixtureFile(fixtureId);
      if (request === run.current) resetImport(file);  // only the newest selection's file is shown
    } catch (e) {
      if (request === run.current) setError(errorText(e));
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand"><span className="mark" />Transaction Insights</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
      </header>

      <main className="content">
        {tab === "Insights" && !analysed && <Steps />}
        {tab === "Insights" && (
          <section className="card setup">
            <div className="setup-row">
              <label className="field grow">
                <span>Data source</span>
                <select value={source} onChange={(e) => chooseSource(e.target.value)} disabled={!list}>
                  {kind === "upload" && <option value="upload">Your file: {csv?.file.name ?? "…"}</option>}
                  <option value="" disabled>{list ? "Choose sample data or an imported dataset…" : error ? "Data sources unavailable" : "Loading…"}</option>
                  {list && (
                    <optgroup label="Sample datasets">
                      {list.samples.map((s) => <option key={s.sample_id} value={`sample:${s.sample_id}`}>{s.name}</option>)}
                    </optgroup>
                  )}
                  {fixtures.length > 0 && (
                    <optgroup label="CSV import test scenarios (not datasets)">
                      {fixtures.map((f) => (
                        <option key={f.fixture_id} value={`fixture:${f.fixture_id}`}>{f.name} ({f.outcome})</option>
                      ))}
                    </optgroup>
                  )}
                  {imported.length > 0 && (
                    <optgroup label="Imported datasets">
                      {imported.map((d) => (
                        <option key={d.dataset_id} value={`dataset:${d.dataset_id}`}>
                          {d.name} ({count(d.transaction_count)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <label htmlFor="csv-file" className="button secondary import-button">Import CSV</label>
            </div>
            <p className="muted hint">
              Upload a CSV containing a date, company and amount. Negative amounts are expenses; positive
              amounts are income. Alternatively, provide an INCOMING or OUTGOING column. Missing categories
              can be reviewed later.
            </p>

            {sample && (
              <PreviewToggle key={source} label={sample.description}
                             load={() => api.samplePreview(sample.sample_id)} />
            )}
            {fixture && (
              <PreviewToggle key={source} load={() => api.fixturePreview(fixture.fixture_id)} label={
                <><span className={`pill outcome ${fixture.outcome.toLowerCase().replace(/ /g, "-")}`}>
                  {fixture.outcome}</span> {fixture.description} Its validation result is shown below.</>
              } />
            )}

            <CsvImport key={importSeed.key} initialFile={importSeed.file} onStatus={setCsv}
                       onPicked={() => startNewSource("upload")} />

            <button className="button primary run" onClick={runInsights} disabled={!canRun || running || loading}>
              {running || loading ? "Running…" : "Run Insights"}
            </button>
          </section>
        )}

        {notice && <p className="banner success">{notice}</p>}
        {error && <p className="banner error">{error}</p>}

        {tab === "Insights" && analysed && (
          <>
            <div className="results-head">
              <h2>Insights for {analysed.name}</h2>
            </div>
            {loading && !summary ? <p className="muted">Loading summary…</p>
              : summary && <Overview summary={summary} stale={loading} />}
            {summary && categories !== undefined && (  // review appears only once a run has produced results
              <History key={analysed.id} datasetId={analysed.id} name={analysed.name} categories={categories}
                       total={list?.datasets.find((d) => d.dataset_id === analysed.id)?.transaction_count ?? null}
                       onChanged={() => setRefreshKey((k) => k + 1)} />
            )}
          </>
        )}
        {tab === "How It Works" && <HowItWorks />}
      </main>
    </div>
  );
}

function Steps() {
  const steps = [
    ["Choose", "Select sample data or upload a CSV."],
    ["Analyse", "View income, expenses, cash flow and trends."],
    ["Review", "Inspect transactions and correct missing categories."],
  ];
  return (
    <section className="steps">
      {steps.map(([title, text], i) => (
        <div key={title} className="card step">
          <span className="step-number">{i + 1}</span>
          <div><strong>{title}</strong><p className="muted">{text}</p></div>
        </div>
      ))}
    </section>
  );
}

function PreviewToggle({ label, load }: { label: ReactNode; load: () => Promise<CsvPreview> }) {
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setOpen(!open);
    if (!preview) {
      try {
        setPreview(await load());
      } catch (e) {
        setError(errorText(e));
      }
    }
  }

  return (
    <div className="preview-toggle">
      <p className="muted">{label} <button className="button link inline" onClick={toggle}>
        {open ? "Hide CSV" : "Preview CSV"}</button></p>
      {open && error && <p className="banner error">{error}</p>}
      {open && preview && <CsvTable preview={preview} />}
    </div>
  );
}

function CsvTable({ preview: p }: { preview: CsvPreview }) {
  const missing = p.missing_category_count === null ? "no category column"
    : p.missing_category_count === 0 ? "no missing categories" : `${p.missing_category_count} missing categories`;
  return (
    <div className="csv-preview">
      <p className="muted">{p.file_name} · {p.row_count} rows · {missing}{p.row_count > p.rows.length && ` · first ${p.rows.length} shown`}</p>
      <div className="table-wrap">
        <table className="mapping csv-table">
          <thead><tr>{p.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {p.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j} className={cell === "" ? "blank" : ""}>{cell || "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Overview({ summary: s, stale }: { summary: Summary; stale: boolean }) {
  const categories = s.expenses_by_category.map((c) => ({
    name: c.category ?? "Uncategorised", amount_cents: c.amount_cents, uncategorised: c.category === null,
  }));
  const empty = s.monthly.length === 0;

  return (
    <div className={stale ? "overview stale" : "overview"}>
      <section className="cards">
        <Card label="Total income" value={formatMoney(s.total_income_cents)} detail={count(s.income_count)} />
        <Card label="Total expenses" value={formatMoney(s.total_expenses_cents)} detail={count(s.expense_count)} />
        <Card label="Net cash flow" value={formatMoney(s.net_cents)}
              tone={s.net_cents > 0 ? "positive" : s.net_cents < 0 ? "negative" : undefined}
              detail="Income minus expenses" />
        <Card label="Needs review" value={String(s.uncategorised_count)}
              tone={s.uncategorised_count > 0 ? "attention" : undefined}
              detail={`${formatMoney(s.uncategorised_cents)} uncategorised`} />
      </section>

      <section className="card summary-text">
        <h2>Summary</h2>
        <p>{s.summary_text}</p>
      </section>

      <section className="charts">
        <div className="card">
          <h2>Income vs expenses</h2>
          {empty ? <p className="muted">No transactions in this dataset.</p> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={s.monthly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e6e8ec" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12 }} width={64} />
                <Tooltip formatter={tooltipMoney} labelFormatter={(m) => formatMonth(String(m))} />
                <Legend />
                <Line type="monotone" dataKey="income_cents" name="Income" stroke="#1e7f5c" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="expenses_cents" name="Expenses" stroke="#242424" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Expenses by category</h2>
          {categories.length === 0 ? <p className="muted">No expenses in this dataset.</p> : (
            <ResponsiveContainer width="100%" height={Math.max(160, categories.length * 34)}>
              <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e6e8ec" horizontal={false} />
                <XAxis type="number" tickFormatter={axisMoney} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                <Tooltip formatter={tooltipMoney} />
                <Bar dataKey="amount_cents" name="Expenses" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {categories.map((c) => <Cell key={c.name} fill={c.uncategorised ? "#d71920" : "#4a5361"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className={`card stat ${tone ?? ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="muted">{detail}</span>
    </div>
  );
}

interface CsvStatus { file: File; mapping: Record<string, string> | null; ready: boolean }

function CsvImport({ initialFile, onPicked, onStatus }: {
  initialFile: File | null; onPicked: () => void; onStatus: (status: CsvStatus | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const latest = useRef(0);  // only the newest preview request may update the screen

  useEffect(() => {
    if (initialFile) chooseFile(initialFile);  // an example file chosen in the Data source list
  }, []);

  async function check(f: File, m: Record<string, string> | null) {
    const request = ++latest.current;
    setError(null);
    onStatus({ file: f, mapping: m, ready: false });  // not runnable until this preview passes
    try {
      const result = await api.preview(f, m);
      if (request !== latest.current) return;
      setPreview(result);
      setMapping(result.mapping);
      onStatus({ file: f, mapping: result.mapping, ready: result.valid });
    } catch (e) {
      if (request !== latest.current) return;
      setPreview(null);
      setError(e instanceof ApiError ? e : new ApiError(errorText(e)));
    }
  }

  function chooseFile(f: File | null) {
    latest.current++;  // any file change (or clearing it) cancels pending previews
    setFile(f);
    setPreview(null);
    setMapping(null);
    setError(null);
    if (f) check(f, null);
    else onStatus(null);
  }

  function mapColumn(column: string, field: string) {
    // Assigning a field to one column removes it from any other column: no duplicate mappings.
    const next = Object.fromEntries(Object.entries(mapping ?? {}).filter(([c, f]) => c !== column && f !== field));
    if (field) next[column] = field;
    setMapping(next);
    check(file!, next);
  }

  const rowErrors = error?.errors.length ? error.errors : preview && !preview.valid ? preview.errors : [];
  const totalErrors = error?.errors.length ? error.errors.length : preview?.error_count ?? 0;

  return (
    <div className="import">
      <input id="csv-file" type="file" accept=".csv,text/csv" hidden
             onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f) onPicked(); chooseFile(f); }} />
      {file && <p className="file-name">File: <strong>{file.name}</strong></p>}

      {preview && (
        <>
          <table className="mapping">
            <thead><tr><th>Column in file</th><th>Maps to</th></tr></thead>
            <tbody>
              {preview.columns.map((column) => (
                <tr key={column}>
                  <td>{column}</td>
                  <td>
                    <select value={mapping?.[column] ?? ""} onChange={(e) => mapColumn(column, e.target.value)}>
                      <option value="">Ignore</option>
                      {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={preview.valid ? "status ok" : "status"}>
            {preview.valid
              ? `Ready: ${preview.row_count} rows (${preview.uncategorised_count} without a category). ` +
                "Run Insights will import and analyse this file."
              : preview.missing_fields.length
                ? preview.unmapped_columns.length
                  ? `Map a column to: ${preview.missing_fields.join(", ")}.`
                  : `Missing required column: ${preview.missing_fields.join(", ")}. This file can't be imported.`
                : `${preview.error_count} problem(s) found. Fix the file and choose it again.`}
          </p>
        </>
      )}

      {error && <p className="banner error">{error.message}</p>}
      {rowErrors.length > 0 && (
        <ul className="row-errors">
          {rowErrors.map((e, i) => (
            <li key={i}>{e.row !== null && `Row ${e.row} · `}{e.field && <strong>{e.field}: </strong>}{e.message}</li>
          ))}
          {totalErrors > rowErrors.length && <li>…and {totalErrors - rowErrors.length} more.</li>}
        </ul>
      )}
    </div>
  );
}
