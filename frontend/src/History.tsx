import { useEffect, useState } from "react";
import { api, countLabel, errorText, formatDate, formatMoney } from "./api";
import type { Transaction } from "./api";

interface Props {
  datasetId: number;
  name: string;
  categories: string[] | null;       // null = category list failed to load
  onChanged: () => void;             // tell App to refresh the summary
}

export default function History({ datasetId, name, categories, onChanged }: Props) {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [version, setVersion] = useState(0);  // bumped after a save to re-fetch
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let current = true;  // ignore a response that arrives after this dataset is replaced
    setLoading(true);
    setError("");
    api.transactions(datasetId)
      .then((all) => current && setRows(all))
      .catch((e) => {
        if (!current) return;
        setRows(null);
        setError(errorText(e));
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [datasetId, version]);

  function saved(t: Transaction, category: string) {
    setNotice(`${t.company} (${formatDate(t.date)}) is now categorised as ${category}.`);
    setVersion((v) => v + 1);
    onChanged();
  }

  const needsReview = rows?.filter((t) => t.category === null).length ?? 0;

  return (
    <section className="card history">
      <div className="history-head">
        <h2>Transaction review · {name}</h2>
        {rows && (
          <p className="muted">
            {countLabel(rows.length)} · <span className={needsReview ? "review-count" : ""}>{needsReview} need review</span>
          </p>
        )}
      </div>

      {categories === null && (
        <p className="banner error">Approved categories could not be loaded, so categories can't be changed. Reload to try again.</p>
      )}
      {notice && <p className="banner success">{notice}</p>}
      {error && <p className="banner error">{error}</p>}

      {rows === null ? (!error && <p className="muted">Loading transactions…</p>) : rows.length === 0 ? (
        <p className="muted empty">This dataset has no transactions.</p>
      ) : (
        <div className={loading ? "table-wrap stale" : "table-wrap"}>
          <table className="transactions">
            <thead>
              <tr><th>Date</th><th>Company</th><th>Category</th><th>Direction</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={`${t.transaction_id}:${t.category}`} t={t} categories={categories} onSaved={saved} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ t, categories, onSaved }: {
  t: Transaction; categories: string[] | null; onSaved: (t: Transaction, category: string) => void;
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
      setChoice(t.category ?? "");  // nothing changed on the server, so show the saved value again
      setError(`Not saved: ${errorText(e)}`);
      setSaving(false);
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
