#!/usr/bin/env python3
"""Convert Lloyds monthly statement PDFs into a SafeSpend transaction CSV.

Usage:
  python3 scripts/lloyds_pdf_to_csv.py ~/Downloads/lloyds/*.pdf
  python3 scripts/lloyds_pdf_to_csv.py --output imports/lloyds-history.csv statement1.pdf statement2.pdf
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path

import pdfplumber


DATE_RE = re.compile(r"\b(\d{1,2})[ /-]([A-Za-z]{3,9}|\d{1,2})[ /-](\d{2,4})\b")
AMOUNT_RE = re.compile(r"(?<!\w)-?\d{1,3}(?:,\d{3})*(?:\.\d{2})")
MONTHS = {
    "jan": "01",
    "january": "01",
    "feb": "02",
    "february": "02",
    "mar": "03",
    "march": "03",
    "apr": "04",
    "april": "04",
    "may": "05",
    "jun": "06",
    "june": "06",
    "jul": "07",
    "july": "07",
    "aug": "08",
    "august": "08",
    "sep": "09",
    "sept": "09",
    "september": "09",
    "oct": "10",
    "october": "10",
    "nov": "11",
    "november": "11",
    "dec": "12",
    "december": "12",
}


@dataclass(frozen=True)
class Transaction:
    date: str
    description: str
    money_out: str
    money_in: str
    balance: str
    source_file: str


def normalise_date(raw: str) -> str:
    match = DATE_RE.search(raw)
    if not match:
        return ""
    day, month, year = match.groups()
    if month.isdigit():
        month_number = month.zfill(2)
    else:
        month_number = MONTHS.get(month.lower()[:3], MONTHS.get(month.lower(), ""))
    if not month_number:
        return ""
    if len(year) == 2:
        year = f"20{year}"
    return f"{year}-{month_number}-{day.zfill(2)}"


def money(value: str) -> str:
    return value.replace(",", "").strip()


def clean_description(text: str) -> str:
    text = DATE_RE.sub("", text, count=1)
    text = AMOUNT_RE.sub("", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -")


def looks_like_noise(line: str) -> bool:
    lower = line.lower()
    return any(
        phrase in lower
        for phrase in [
            "statement sheet",
            "sort code",
            "account number",
            "balance brought forward",
            "balance carried forward",
            "date description",
            "paid out",
            "paid in",
            "lloyds bank",
        ]
    )


def transaction_from_line(line: str, source_file: str) -> Transaction | None:
    if looks_like_noise(line):
        return None
    date = normalise_date(line)
    if not date:
        return None

    amounts = [money(value) for value in AMOUNT_RE.findall(line)]
    if not amounts:
        return None

    description = clean_description(line)
    if not description:
        return None

    # Lloyds statements generally show transaction amount then running balance.
    # If only one amount is present, treat it as the transaction amount. If two or
    # more are present, use the last as balance and the previous as transaction.
    balance = amounts[-1] if len(amounts) > 1 else ""
    transaction_amount = amounts[-2] if len(amounts) > 1 else amounts[-1]
    signed = float(transaction_amount)
    if signed < 0:
        money_out = f"{abs(signed):.2f}"
        money_in = ""
    else:
        # Some Lloyds exports omit minus signs and rely on Paid out/Paid in
        # columns. In text extraction that distinction can be lost, so positive
        # one-amount lines are marked as outgoings for review.
        money_out = f"{signed:.2f}"
        money_in = ""

    return Transaction(date, description, money_out, money_in, balance, source_file)


def transactions_from_table(table: list[list[str | None]], source_file: str) -> list[Transaction]:
    transactions: list[Transaction] = []
    header: dict[str, int] = {}
    for row in table:
        cells = [(cell or "").strip() for cell in row]
        joined = " ".join(cell for cell in cells if cell)
        if not joined or looks_like_noise(joined):
            continue
        normalised = [re.sub(r"[^a-z0-9]+", "", cell.lower()) for cell in cells]
        if any("paidout" in cell or "moneyout" in cell for cell in normalised):
            for index, cell in enumerate(normalised):
                if cell in {"date", "transactiondate"}:
                    header["date"] = index
                elif "description" in cell or "details" in cell:
                    header["description"] = index
                elif "paidout" in cell or "moneyout" in cell or "debit" in cell:
                    header["out"] = index
                elif "paidin" in cell or "moneyin" in cell or "credit" in cell:
                    header["in"] = index
                elif "balance" in cell:
                    header["balance"] = index
            continue

        if {"date", "description"}.issubset(header):
            date = normalise_date(cells[header["date"]])
            description = cells[header["description"]].strip()
            money_out = money(cells[header["out"]]) if "out" in header and header["out"] < len(cells) else ""
            money_in = money(cells[header["in"]]) if "in" in header and header["in"] < len(cells) else ""
            balance = money(cells[header["balance"]]) if "balance" in header and header["balance"] < len(cells) else ""
            if date and description and (money_out or money_in):
                transactions.append(Transaction(date, description, money_out, money_in, balance, source_file))
                continue

        date = normalise_date(joined)
        if not date:
            continue
        amounts = [money(cell) for cell in cells if AMOUNT_RE.fullmatch(cell.replace(",", "").strip()) or AMOUNT_RE.fullmatch(cell.strip())]
        if not amounts:
            amounts = [money(value) for value in AMOUNT_RE.findall(joined)]
        description_cells = [cell for cell in cells if cell and not DATE_RE.search(cell) and not AMOUNT_RE.fullmatch(cell.replace(",", "").strip())]
        description = clean_description(" ".join(description_cells) or joined)
        if not description:
            continue
        balance = amounts[-1] if len(amounts) > 1 else ""
        transaction_amount = amounts[-2] if len(amounts) > 1 else amounts[-1]
        signed = float(transaction_amount)
        transactions.append(
            Transaction(
                date=date,
                description=description,
                money_out=f"{abs(signed):.2f}" if signed < 0 else f"{signed:.2f}",
                money_in="" if signed <= 0 else "",
                balance=balance,
                source_file=source_file,
            )
        )
    return transactions


def extract_transactions(pdf_path: Path) -> list[Transaction]:
    transactions: list[Transaction] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                transactions.extend(transactions_from_table(table, pdf_path.name))
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line in text.splitlines():
                tx = transaction_from_line(line, pdf_path.name)
                if tx:
                    transactions.append(tx)

    unique: dict[tuple[str, str, str, str], Transaction] = {}
    for tx in transactions:
        unique[(tx.date, tx.description.lower(), tx.money_out, tx.money_in)] = tx
    return sorted(unique.values(), key=lambda item: (item.date, item.description))


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Lloyds statement PDFs to SafeSpend CSV.")
    parser.add_argument("pdfs", nargs="+", type=Path, help="Statement PDF files")
    parser.add_argument("--output", "-o", type=Path, default=Path("imports/lloyds-history.csv"))
    args = parser.parse_args()

    rows: list[Transaction] = []
    for pdf_path in args.pdfs:
        rows.extend(extract_transactions(pdf_path.expanduser()))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=["Date", "Description", "Money Out", "Money In", "Balance", "Source File"])
        writer.writeheader()
        for tx in rows:
            writer.writerow(
                {
                    "Date": tx.date,
                    "Description": tx.description,
                    "Money Out": tx.money_out,
                    "Money In": tx.money_in,
                    "Balance": tx.balance,
                    "Source File": tx.source_file,
                }
            )

    print(f"Wrote {len(rows)} transactions to {args.output}")
    if rows:
        print("Review the CSV before importing. PDF statements can lose paid-in/paid-out column meaning during text extraction.")


if __name__ == "__main__":
    main()
