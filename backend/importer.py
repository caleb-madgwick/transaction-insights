"""CSV parsing, column mapping and validation. Never touches the database."""
import csv
import io
import json
import re
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError

from models import CATEGORIES, MAX_AMOUNT_CENTS, Transaction

MAX_BYTES = 1_000_000
MAX_ROWS = 5_000
MAX_ERRORS = 50

REQUIRED = ("date", "company", "amount")
ALIASES = {
    "date": ("date", "transaction date", "trans date"),
    "company": ("company", "merchant", "description", "counterparty"),
    "category": ("category", "type"),
    "amount": ("amount", "value", "transaction amount"),
    "direction": ("direction", "transaction direction"),
    "currency": ("currency",),
    "transaction_id": ("transaction id", "id"),
}
ALIAS_TO_FIELD = {alias: field for field, aliases in ALIASES.items() for alias in aliases}
AMOUNT_RE = re.compile(r"[+-]?[0-9]+(\.[0-9]{1,2})?")
MAX_WHOLE_DIGITS = len(str(MAX_AMOUNT_CENTS // 100))
TOO_LARGE = f"Amount must not exceed ${MAX_AMOUNT_CENTS // 100:,}.00."
CATEGORY_BY_LOWER = {c.lower(): c for c in CATEGORIES}


def api_error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def normalise(header: str) -> str:
    return " ".join(header.replace("_", " ").split()).lower()


def parse_mapping(text: str | None) -> dict[str, str] | None:
    """Parse the optional `mapping` form field: {"CSV column": "canonical field"}."""
    if not text:
        return None
    try:
        mapping = json.loads(text)
    except json.JSONDecodeError:
        mapping = None
    if not isinstance(mapping, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()
    ):
        raise api_error(400, "invalid_mapping",
                        'Mapping must be a JSON object like {"CSV column": "date"}.')
    return mapping


def read_rows(content: bytes) -> list[list[str]]:
    try:
        text = content.decode("utf-8-sig")
        rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    except UnicodeDecodeError:
        raise api_error(400, "invalid_encoding", "File must be UTF-8 encoded text.")
    except csv.Error as exc:
        raise api_error(400, "malformed_csv", f"File could not be read as CSV: {exc}.")
    if len(rows) < 2:
        raise api_error(400, "empty_file", "CSV must contain a header row and at least one data row.")
    if len(rows) - 1 > MAX_ROWS:
        raise api_error(400, "too_many_rows", f"CSV has more than {MAX_ROWS} data rows.")
    return rows


def suggest_mapping(columns: list[str]) -> tuple[dict[str, str], list[dict]]:
    """Map columns to fields by known alias; a field matched by several columns is left unmapped."""
    matches: dict[str, list[str]] = {}
    for column in columns:
        if field := ALIAS_TO_FIELD.get(normalise(column)):
            matches.setdefault(field, []).append(column)
    mapping = {cols[0]: field for field, cols in matches.items() if len(cols) == 1}
    errors = [
        error(None, field, f"Columns {', '.join(cols)} all match '{field}'. Map one manually.")
        for field, cols in matches.items() if len(cols) > 1
    ]
    return mapping, errors


def check_mapping(mapping: dict[str, str], columns: list[str]) -> None:
    targets = list(mapping.values())
    for column, field in mapping.items():
        if column not in columns:
            raise api_error(400, "invalid_mapping", f"Column '{column}' is not in the file.")
        if field not in ALIASES:
            raise api_error(400, "invalid_mapping",
                            f"'{field}' is not a supported field. Use: {', '.join(ALIASES)}.")
        if targets.count(field) > 1:
            raise api_error(400, "invalid_mapping", f"Field '{field}' is mapped from more than one column.")


def error(row: int | None, field: str | None, message: str) -> dict:
    return {"row": row, "field": field, "message": message}


def parse_cents(text: str) -> int:
    """Exact signed cents from '125.50' or '-125.50'. Raises ValueError with a readable message.
    Over-long numbers are rejected before any Decimal conversion."""
    if not AMOUNT_RE.fullmatch(text):
        raise ValueError(f"'{text}' is not a valid amount (e.g. 125.50 or -125.50).")
    if len(text.lstrip("+-").split(".")[0].lstrip("0")) > MAX_WHOLE_DIGITS:
        raise ValueError(TOO_LARGE)
    cents = int(Decimal(text) * 100)
    if abs(cents) > MAX_AMOUNT_CENTS:
        raise ValueError(TOO_LARGE)
    if cents == 0:
        raise ValueError("Amount must not be zero.")
    return cents


def parse_row(values: dict[str, str], row_id: str) -> tuple[Transaction | None, dict[str, str]]:
    """Validate one row. Returns (transaction, {}) or (None, {field: message})."""
    errors: dict[str, str] = {}
    amount_text = values["amount"]
    signed = amount_text.startswith(("+", "-"))
    cents = direction = None

    try:
        cents = parse_cents(amount_text)
    except ValueError as exc:
        errors["amount"] = str(exc)

    if "direction" in values:
        direction = values["direction"].upper()
        if direction not in ("INCOMING", "OUTGOING"):
            errors["direction"] = f"'{values['direction']}' is ambiguous. Use INCOMING or OUTGOING."
        elif signed:
            errors["direction"] = "Amount must be unsigned when a direction column is used."
    else:  # from the sign, so an invalid amount reports one amount error, not a direction error too
        direction = "OUTGOING" if amount_text.startswith("-") else "INCOMING"

    category = values.get("category") or None
    try:
        transaction = Transaction(
            transaction_id=values.get("transaction_id", row_id),
            dataset_id=0,  # placeholder; the real id is assigned on insert
            date=values["date"],
            company=values["company"],
            category=CATEGORY_BY_LOWER.get(category.lower(), category) if category else None,
            direction=direction,
            amount_cents=abs(cents) if cents else None,
            currency=(values.get("currency") or "AUD").upper(),
        )
    except ValidationError as exc:
        for e in exc.errors():
            field = "amount" if e["loc"][0] == "amount_cents" else str(e["loc"][0])
            errors.setdefault(field, e["msg"].removeprefix("Value error, "))
        return None, errors
    return (None, errors) if errors else (transaction, errors)


def parse_csv(content: bytes, mapping: dict[str, str] | None = None) -> tuple[dict, list[Transaction]]:
    """Parse and validate a whole CSV. Returns (report, transactions); transactions is
    empty unless the report is valid."""
    rows = read_rows(content)
    columns = [c.strip() for c in rows[0]]
    if "" in columns or len(set(columns)) != len(columns):
        raise api_error(400, "malformed_csv", "Header row has blank or duplicate column names.")

    if mapping is None:
        mapping, errors = suggest_mapping(columns)
    else:
        check_mapping(mapping, columns)
        errors = []
    missing = [f for f in REQUIRED if f not in mapping.values()]
    errors += [error(None, f, f"Required field '{f}' is not mapped to a column.") for f in missing]

    transactions: list[Transaction] = []
    if not errors:
        index = {field: columns.index(column) for column, field in mapping.items()}
        first_seen: dict[str, int] = {}
        for row_number, cells in enumerate(rows[1:], start=2):
            if len(cells) != len(columns):
                errors.append(error(row_number, None,
                                    f"Expected {len(columns)} values, found {len(cells)}."))
                continue
            values = {field: cells[i].strip() for field, i in index.items()}
            transaction, row_errors = parse_row(values, f"row-{row_number}")
            errors += [error(row_number, f, m) for f, m in row_errors.items()]
            if transaction:
                tid = transaction.transaction_id
                if tid in first_seen:
                    errors.append(error(row_number, "transaction_id",
                                        f"Duplicate transaction_id '{tid}' (first on row {first_seen[tid]})."))
                else:
                    first_seen[tid] = row_number
                    transactions.append(transaction)

        if "direction" not in index and not any(
            cells[index["amount"]].strip().startswith(("+", "-"))
            for cells in rows[1:] if len(cells) == len(columns)
        ):
            errors.append(error(None, "direction",
                                "No direction column and no signed amounts, so direction is ambiguous. "
                                "Map a direction column or use signed amounts (negative = OUTGOING)."))

    report = {
        "columns": columns,
        "mapping": mapping,
        "unmapped_columns": [c for c in columns if c not in mapping],
        "missing_fields": missing,
        "row_count": len(rows) - 1,
        "uncategorised_count": sum(t.category is None for t in transactions),
        "valid": not errors,
        "error_count": len(errors),
        "errors": errors[:MAX_ERRORS],
    }
    return report, transactions if not errors else []
