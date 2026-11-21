"""Canonical transaction model and approved categories."""
import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CATEGORIES = (
    # Income
    "Sales", "Services", "Interest", "Refunds",
    # Expenses
    "Rent", "Wages", "Inventory", "Supplies", "Utilities",
    "Marketing", "Software", "Insurance", "Travel", "Fees",
)


class Transaction(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    transaction_id: str = Field(min_length=1)
    dataset_id: int
    date: datetime.date
    company: str = Field(min_length=1)
    category: str | None = None
    direction: Literal["INCOMING", "OUTGOING"]
    amount_cents: int = Field(gt=0, strict=True)
    currency: Literal["AUD"] = "AUD"

    @field_validator("date", mode="before")
    @classmethod
    def iso_date_only(cls, value: object) -> object:
        # Pydantic would otherwise accept Unix timestamps and datetimes as dates.
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("must be a YYYY-MM-DD string")
        return value

    @field_validator("category")
    @classmethod
    def approved_category(cls, value: str | None) -> str | None:
        if value is not None and value not in CATEGORIES:
            raise ValueError(f"must be one of: {', '.join(CATEGORIES)}")
        return value
