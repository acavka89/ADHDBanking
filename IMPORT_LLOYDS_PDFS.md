# Import bank PDF statements

Use this for a one-time history backfill when Lloyds or Halifax only gives monthly PDF statements.

## 1. Put statements somewhere local

For example:

```bash
mkdir -p ~/Downloads/lloyds-statements
```

Save the last 6 months of Lloyds PDF statements into that folder.

If you also have Halifax joint statements, put them in a separate folder, for example:

```bash
mkdir -p ~/Downloads/halifax-statements
```

## 2. Convert PDFs to SafeSpend CSV

From this repo:

```bash
/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/lloyds_pdf_to_csv.py ~/Downloads/lloyds-statements/*.pdf
```

The script writes:

```bash
imports/lloyds-history.csv
```

For Halifax joint statements:

```bash
/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/lloyds_pdf_to_csv.py --output imports/halifax-joint-history.csv ~/Downloads/halifax-statements/*.pdf
```

## 3. Review the CSV

PDF statements can lose column structure during extraction. Check especially:

- Salary and refunds are in `Money In`
- Card payments and bills are in `Money Out`
- Dates look right
- Descriptions are readable

## 4. Import into SafeSpend

Open the app, go to:

```text
Transactions -> Import CSV
```

Choose the matching statement account in SafeSpend first, then choose:

```bash
imports/lloyds-history.csv
```

or:

```bash
imports/halifax-joint-history.csv
```

SafeSpend skips duplicates using date, merchant and amount.

Generated import files are ignored by git so bank data is not committed.
