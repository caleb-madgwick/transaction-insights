import { useEffect, useState } from "react";
import { api, countLabel, errorText, formatDate, formatMoney, isRejection, UNCATEGORISED } from "./api";
import type { Transaction, TransactionFilters } from "./api";

const NO_FILTERS: TransactionFilters = { category: "", direction: "" };
const DIRECTIONS = [["", "All"], ["INCOMING", "Incoming"], ["OUTGOING", "Outgoing"]] as const;

interface Props {
  datasetId: number;
  name: string;
  total: number | null;              // all transactions in the dataset
  categories: string[] | null;       // null = category list failed to load
  onChanged: () => void;             // tell App to refresh the summary
}

export default function History({ datasetId, name, total, categories, onChanged }: Props) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [version, setVersion] = useState(0);  // bumped after a save to re-fetch
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unconfirmed, setUnconfirmed] = useState("");  // a save whose outcome is unknown

  useEffect(() => {
    let current = true;  // ignore responses for filters or a dataset that are no longer selected
    setLoading(true);
    setError("");
    Promise.all([
      api.transactions(datasetId, filters),                      // filtering is done by the backend
      api.transactions(datasetId, { category: UNCATEGORISED }),  // whole-dataset review count
    ])
      .then(([matching, needsReview]) => {
        if (!current) return;
        setRows(matching);
        setReviewCount(needsReview.length);
      })
      .catch((e) => {
        if (!current) return;
        setRows(null);
        setError(errorText(e));
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [datasetId, filters, version]);

  function setFilter(key: keyof TransactionFilters, value: string) {
    setNotice("");
    setUnconfirmed("");
    setFilters({ ...filters, [key]: value });
  }

  function saved(t: Transaction, category: string) {
    setUnconfirmed("");
    setNotice(`${t.company} (${formatDate(t.date)}) is now categorised as ${category}.`);
    setVersion((v) => v + 1);
    onChanged();
  }

  // No answer from the server: the change may or may not be saved, so reload what the server has.
  function notConfirmed(t: Transaction, category: string) {
    setNotice("");
    setUnconfirmed(`Could not confirm whether ${t.company} (${formatDate(t.date)}) was saved as ${category}. ` +
      "The list has been reloaded from the server; check its category and save again if needed. " +
      "Saving the same category twice is safe.");
    setVersion((v) => v + 1);
    onChanged();
  }

  const activeCount = Number(filters.category !== "") + Number(filters.direction !== "");
  const filtered = activeCount > 0;
  const reviewing = filters.category === UNCATEGORISED;

  return (
    <section className="card history">
      <div className="history-head">
        <h2>Transaction review · {name}</h2>
        {rows && (
          <p className="muted">
            {total !== null ? `Showing ${rows.length} of ${countLabel(total)}` : `Showing ${countLabel(rows.length)}`}
            {reviewCount !== null && (
              <> · <span className={reviewCount ? "review-count" : ""}>{reviewCount} need review</span></>
            )}
          </p>
        )}
      </div>

      <div className="filter-panel" role="group" aria-label="Filter transactions">
        <div className="filter-head">
          <span className="filter-title">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" /></svg>
            Filters
            {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </span>
          <button className="filter-clear" onClick={() => { setNotice(""); setUnconfirmed(""); setFilters(NO_FILTERS); }}
                  disabled={!filtered}>
            Clear all
          </button>
        </div>
        <div className="filter-controls">
          <div className="filter-group">
            <span className="filter-label">Direction</span>
            <div className="segmented">
              {DIRECTIONS.map(([value, label]) => (
                <button key={label} className={filters.direction === value ? "active" : ""} aria-pressed={filters.direction === value}
                        onClick={() => setFilter("direction", value)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="filter-group">
            <span className="filter-label">Category</span>
            <select className="filter-select" value={reviewing ? "" : filters.category}
                    onChange={(e) => setFilter("category", e.target.value)} disabled={reviewing}>
              <option value="">All categories</option>
              {categories?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <button className={reviewing ? "chip active" : "chip"} aria-pressed={reviewing}
                    onClick={() => setFilter("category", reviewing ? "" : UNCATEGORISED)}>
              Needs review{reviewCount !== null && <span className="chip-count">{reviewCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {categories === null && (
        <p className="banner error">Approved categories could not be loaded, so categories can't be changed. Reload to try again.</p>
      )}
      {notice && <p className="banner success">{notice}</p>}
      {unconfirmed && <p className="banner error">{unconfirmed}</p>}
      {error && <p className="banner error">{error}</p>}

      {rows === null ? (!error && <p className="muted">Loading transactions…</p>) : rows.length === 0 ? (
        <p className="muted empty">
          {reviewing ? "Nothing needs review for these filters." : filtered
            ? "No transactions match these filters." : "This dataset has no transactions."}
        </p>
      ) : (
        <div className={loading ? "table-wrap stale" : "table-wrap"}>
          <table className="transactions">
            <thead>
              <tr><th>Date</th><th>Company</th><th>Category</th><th>Direction</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={`${t.transaction_id}:${t.category}`} t={t} categories={categories}
                     onSaved={saved} onUnknown={notConfirmed} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ t, categories, onSaved, onUnknown }: {
  t: Transaction; categories: string[] | null;
  onSaved: (t: Transaction, category: string) => void; onUnknown: (t: Transaction, category: string) => void;
}) {
  const [choice, setChoice] = useState(t.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changed = choice !== "" && choice !== t.category;
  const income = t.direction === "INCOMING";

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.setCategory(t.dataset_id, t.transaction_id, choice);
      onSaved(t, choice);  // the list re-fetches; this row then remounts with the saved category
    } catch (e) {
      setSaving(false);
      if (isRejection(e)) {  // 4xx: the server refused the change, so show the saved value again
        setChoice(t.category ?? "");
        setError(`Not saved: ${errorText(e)}`);
      } else {  // network failure or 5xx: the outcome is unknown, so reload rather than assume
        setError(`Save not confirmed: ${errorText(e)}`);
        onUnknown(t, choice);
      }
    }
  }

  return (
    <tr className={t.category === null ? "needs-review" : ""}>
      <td className="nowrap">{formatDate(t.date)}</td>
      <td>{t.company}</td>
      <td>
        <div className="category-cell">
          {t.category === null && <span className="pill review">Needs review</span>}
          {categories ? (
            <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={saving}
                    aria-label={`Category for ${t.company}`}>
              {t.category === null && <option value="">Choose…</option>}
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            t.category ?? "—"
          )}
          {changed && (
            <button className="button primary small" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
        {error && <p className="row-error">{error}</p>}
      </td>
      <td><span className={income ? "pill income" : "pill expense"}>{income ? "Income" : "Expense"}</span></td>
      <td className={income ? "num amount income" : "num amount"}>
        {income ? "+" : "−"}{formatMoney(t.amount_cents)}
      </td>
    </tr>
  );
}
