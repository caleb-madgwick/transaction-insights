import { useEffect, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, ApiError, countLabel as count, errorText, FIELDS, formatMoney, formatMonth } from "./api";
import type { DatasetList, ImportResult, Preview, Summary } from "./api";
import History from "./History";

const TABS = ["Overview", "History", "How It Works"] as const;
type Tab = (typeof TABS)[number];
const DEFAULT_SAMPLE = "small-business";

// Axis labels only; exact values use formatMoney.
const axisMoney = (cents: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: "compact" }).format(cents / 100);
const tooltipMoney = (value: unknown) => formatMoney(Number(value));

export default function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [list, setList] = useState<DatasetList | null>(null);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [categories, setCategories] = useState<string[] | null | undefined>(undefined);  // null = failed
  const [refreshKey, setRefreshKey] = useState(0);  // bumped after a category change to re-fetch the summary

  function showDataset(id: number) {
    setSummary(null);  // never show one dataset's figures under another's name
    setStartDate("");
    setEndDate("");
    setDatasetId(id);
  }

  // Each selection (sample, existing dataset or finished import) takes a new number. An async
  // step only applies its result if no newer selection has started; list fetches work the same way.
  const selection = useRef(0);
  const listRequest = useRef(0);

  async function refreshList() {
    const request = ++listRequest.current;
    const latest = await api.datasets();
    if (request === listRequest.current) setList(latest);
  }

  async function selectSample(sampleId: string) {
    const request = ++selection.current;
    setError("");
    setNotice("");
    try {
      const { dataset_id } = await api.loadSample(sampleId);  // idempotent
      await refreshList();
      if (request === selection.current) showDataset(dataset_id);
    } catch (e) {
      if (request === selection.current) setError(errorText(e));
    }
  }

  function chooseDataset(id: number) {
    selection.current++;
    setNotice("");
    showDataset(id);
  }

  async function handleImported(result: ImportResult) {
    const request = ++selection.current;
    setShowImport(false);
    setNotice(`Imported ${count(result.imported_count)} into "${result.name}" ` +
              `(${result.uncategorised_count} need review).`);
    try {
      await refreshList();
    } catch (e) {
      setError(errorText(e));
    }
    if (request === selection.current) showDataset(result.dataset_id);
  }

  useEffect(() => {
    selectSample(DEFAULT_SAMPLE);
    api.categories().then((r) => setCategories(r.categories)).catch(() => setCategories(null));
  }, []);

  useEffect(() => {
    if (datasetId === null) return;
    let current = true;  // ignore responses for a dataset or range that is no longer selected
    setLoading(true);
    setError("");
    api.summary(datasetId, startDate, endDate)
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
  }, [datasetId, startDate, endDate, refreshKey]);

  const sampleFor = (id: number | null) => list?.samples.find((s) => s.dataset_id === id && id !== null);
  const imported = list?.datasets.filter((d) => !sampleFor(d.dataset_id)) ?? [];
  const selected = sampleFor(datasetId) ? `sample:${sampleFor(datasetId)!.sample_id}` : `dataset:${datasetId ?? ""}`;

  function changeSource(value: string) {
    const [kind, id] = value.split(":");
    if (kind === "sample") selectSample(id);
    else chooseDataset(Number(id));
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
        <section className="toolbar card">
          <label className="field">
            <span>Data source</span>
            <select value={selected} onChange={(e) => changeSource(e.target.value)} disabled={!list}>
              {!list && <option value={selected}>Loading…</option>}
              {list && (
                <optgroup label="Sample data">
                  {list.samples.map((s) => <option key={s.sample_id} value={`sample:${s.sample_id}`}>{s.name}</option>)}
                </optgroup>
              )}
              {imported.length > 0 && (
                <optgroup label="Imported">
                  {imported.map((d) => (
                    <option key={d.dataset_id} value={`dataset:${d.dataset_id}`}>
                      {d.name} ({d.transaction_count})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button className="button secondary" onClick={() => { setShowImport(!showImport); setNotice(""); }}>
            {showImport ? "Close import" : "Import CSV"}
          </button>

          {tab === "Overview" && (
            <div className="dates">
              <label className="field">
                <span>From</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">
                <span>To</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
              <button className="button link" onClick={() => { setStartDate(""); setEndDate(""); }}
                      disabled={!startDate && !endDate}>Clear</button>
            </div>
          )}
        </section>

        {showImport && <CsvImport onImported={handleImported} />}
        {notice && <p className="banner success">{notice}</p>}
        {error && <p className="banner error">{error}</p>}

        {tab === "Overview" && (
          loading && !summary ? <p className="muted">Loading summary…</p>
            : summary && <Overview summary={summary} stale={loading} />
        )}
        {tab === "History" && datasetId !== null && categories !== undefined && (
          <History key={datasetId} datasetId={datasetId} categories={categories}
                   total={list?.datasets.find((d) => d.dataset_id === datasetId)?.transaction_count ?? null}
                   onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
        {tab === "How It Works" && <Placeholder text="The engineering walkthrough arrives in Stage 7." />}
      </main>
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
          {empty ? <p className="muted">No transactions in this period.</p> : (
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
          {categories.length === 0 ? <p className="muted">No expenses in this period.</p> : (
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

function Placeholder({ text }: { text: string }) {
  return <section className="card placeholder"><p className="muted">{text}</p></section>;
}

function CsvImport({ onImported }: { onImported: (result: ImportResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);  // only the newest preview request may update the screen

  async function check(f: File, m: Record<string, string> | null) {
    const request = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api.preview(f, m);
      if (request !== latest.current) return;
      setPreview(result);
      setMapping(result.mapping);
    } catch (e) {
      if (request !== latest.current) return;
      setPreview(null);
      setError(e instanceof ApiError ? e : new ApiError(errorText(e)));
    } finally {
      if (request === latest.current) setBusy(false);
    }
  }

  function chooseFile(f: File | null) {
    latest.current++;  // any file change (or clearing it) cancels pending previews
    setBusy(false);
    setFile(f);
    setPreview(null);
    setMapping(null);
    setError(null);
    if (f) check(f, null);
  }

  function mapColumn(column: string, field: string) {
    // Assigning a field to one column removes it from any other column: no duplicate mappings.
    const next = Object.fromEntries(Object.entries(mapping ?? {}).filter(([c, f]) => c !== column && f !== field));
    if (field) next[column] = field;
    setMapping(next);
    check(file!, next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onImported(await api.importCsv(file!, mapping));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(errorText(e)));
    } finally {
      setBusy(false);
    }
  }

  const rowErrors = error?.errors.length ? error.errors : preview && !preview.valid ? preview.errors : [];
  const totalErrors = error?.errors.length ? error.errors.length : preview?.error_count ?? 0;

  return (
    <section className="card import">
      <h2>Import CSV</h2>
      <p className="muted">
        Required columns: date (YYYY-MM-DD), company, amount. Either use signed amounts
        (<strong>negative = OUTGOING, positive = INCOMING</strong>) or add a direction column
        (INCOMING / OUTGOING) with unsigned amounts. Blank categories are imported for review.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />

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
              ? `Ready to import ${preview.row_count} rows (${preview.uncategorised_count} without a category).`
              : preview.missing_fields.length
                ? `Map a column to: ${preview.missing_fields.join(", ")}.`
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

      <div className="actions">
        <button className="button primary" onClick={confirm} disabled={!preview?.valid || busy}>
          {busy ? "Working…" : "Import"}
        </button>
      </div>
    </section>
  );
}
