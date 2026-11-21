"""Deterministic financial summary from transaction rows. Integer cents only; no DB access."""
from collections import Counter


def money(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def breakdown(totals: Counter) -> list[dict]:
    """Largest first; ties by name. Uncategorised appears as category null."""
    ordered = sorted(totals.items(), key=lambda item: (-item[1], item[0] or ""))
    return [{"category": category, "amount_cents": cents} for category, cents in ordered]


def months_between(first: str, last: str) -> list[str]:
    """Every YYYY-MM from first to last inclusive, so gaps show as zero."""
    year, month = map(int, first.split("-"))
    months = []
    while (current := f"{year:04d}-{month:02d}") <= last:
        months.append(current)
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def build_summary(rows, filtered: bool) -> dict:
    """Every figure comes from the same rows, so all share one date range."""
    totals, counts, monthly = Counter(), Counter(), Counter()
    by_category = {"INCOMING": Counter(), "OUTGOING": Counter()}
    for row in rows:
        direction, cents = row["direction"], row["amount_cents"]
        totals[direction] += cents
        counts[direction] += 1
        by_category[direction][row["category"]] += cents
        monthly[row["date"][:7], direction] += cents

    months = sorted({month for month, _ in monthly})
    uncategorised = [row["amount_cents"] for row in rows if row["category"] is None]
    summary = {
        "total_income_cents": totals["INCOMING"],
        "total_expenses_cents": totals["OUTGOING"],
        "net_cents": totals["INCOMING"] - totals["OUTGOING"],
        "income_count": counts["INCOMING"],
        "expense_count": counts["OUTGOING"],
        "income_by_category": breakdown(by_category["INCOMING"]),
        "expenses_by_category": breakdown(by_category["OUTGOING"]),
        "monthly": [
            {"month": m, "income_cents": monthly[m, "INCOMING"], "expenses_cents": monthly[m, "OUTGOING"]}
            for m in (months_between(months[0], months[-1]) if months else [])
        ],
        "uncategorised_count": len(uncategorised),
        "uncategorised_cents": sum(uncategorised),
    }
    summary["summary_text"] = written_summary(summary, filtered)
    return summary


def written_summary(s: dict, filtered: bool) -> str:
    if s["income_count"] + s["expense_count"] == 0:
        return "No transactions in the selected period."

    net = s["net_cents"]
    if net > 0:
        outcome = f"positive net cash flow of {money(net)}"
    elif net < 0:
        outcome = f"negative net cash flow of {money(-net)}"
    else:
        outcome = "net cash flow of $0.00"
    period = "During the selected period" if filtered else "Across all transactions"
    sentences = [f"{period}, income was {money(s['total_income_cents'])} and expenses were "
                 f"{money(s['total_expenses_cents'])}, resulting in {outcome}."]

    named = [c for c in s["expenses_by_category"] if c["category"]]
    uncategorised = sum(c["amount_cents"] for c in s["expenses_by_category"] if c["category"] is None)
    if s["expense_count"] == 0:
        sentences.append("There were no expenses.")
    elif named and named[0]["amount_cents"] > uncategorised:
        sentences.append(f"{named[0]['category']} was the largest expense category.")
    else:  # never name a category as largest when uncategorised expenses are as large or larger
        sentences.append("Uncategorised expenses were at least as large as any single category.")

    n = s["uncategorised_count"]
    if n:
        sentences.append(f"{n} transaction{'s require' if n != 1 else ' requires'} review.")
    return " ".join(sentences)
