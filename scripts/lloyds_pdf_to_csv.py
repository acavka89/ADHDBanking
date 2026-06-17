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
LLOYDS_DATE_TOKEN_RE = re.compile(r"^D(?P<tens>\d)ate$")
DESCRIPTION_MARKER_RE = re.compile(r"^D(?P<prefix>.)(?:escription)$", re.IGNORECASE)
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
    match = AMOUNT_RE.search(value)
    return match.group(0).replace(",", "").strip() if match else ""


def money_from_words(words: list[dict], left: float, right: float | None = None) -> str:
    for word in words:
        if word["x0"] < left:
            continue
        if right is not None and word["x0"] >= right:
            continue
        amount = money(word["text"])
        if amount:
            return amount
    return ""


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


def description_from_words(words: list[dict]) -> str:
    desc_words = [word["text"] for word in words if 110 <= word["x0"] < 270]
    if not desc_words:
        return ""

    marker = DESCRIPTION_MARKER_RE.match(desc_words[0])
    if marker:
        prefix = marker.group("prefix")
        rest = desc_words[1:]
        if rest:
            desc_words = [f"{prefix}{rest[0]}", *rest[1:]]
        else:
            desc_words = [prefix]

    return clean_description(" ".join(desc_words))


def type_from_words(words: list[dict]) -> str:
    type_words = [word["text"] for word in words if 270 <= word["x0"] < 320]
    cleaned = [word for word in type_words if not word.lower().startswith("t")]
    return cleaned[-1] if cleaned else ""


def transactions_from_positioned_words(page, source_file: str) -> list[Transaction]:
    words = page.extract_words(x_tolerance=1, y_tolerance=3, keep_blank_chars=False)
    transactions: list[Transaction] = []

    for word in words:
        match = LLOYDS_DATE_TOKEN_RE.match(word["text"])
        if not match:
            continue

        row = sorted(
            [candidate for candidate in words if abs(candidate["top"] - word["top"]) < 3],
            key=lambda candidate: candidate["x0"],
        )
        date_index = row.index(word)
        if date_index + 3 >= len(row):
            continue

        date = normalise_date(
            f"{match.group('tens')}{row[date_index + 1]['text']} {row[date_index + 2]['text']} {row[date_index + 3]['text']}"
        )
        description = description_from_words(row)
        if not date or not description:
            continue

        money_in = money_from_words(row, 320, 424)
        money_out = money_from_words(row, 424, 500)
        balance = money_from_words(row, 500)
        tx_type = type_from_words(row)

        # The statement sometimes places incoming Faster Payments in the Money In
        # column with the text "Money In" after the amount; outgoing rows have
        # the amount much further right, so coordinates are the least fragile cue.
        if money_in and not money_out:
            transactions.append(Transaction(date, f"{description} ({tx_type})".strip(), "", money_in, balance, source_file))
        elif money_out:
            transactions.append(Transaction(date, f"{description} ({tx_type})".strip(), money_out, "", balance, source_file))

    return transactions


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
            positioned = transactions_from_positioned_words(page, pdf_path.name)
            if positioned:
                transactions.extend(positioned)
                continue

            tables = page.extract_tables() or []
            for table in tables:
                transactions.extend(transactions_from_table(table, pdf_path.name))
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line in text.splitlines():
                tx = transaction_from_line(line, pdf_path.name)
                if tx:
                    transactions.append(tx)

    unique: dict[tuple[str, str, str, str, str], Transaction] = {}
    for tx in transactions:
        unique[(tx.date, tx.description.lower(), tx.money_out, tx.money_in, tx.balance)] = tx
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
