import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerContent from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';

// pdfjs creates the worker with {type:"module"}. WKWebView in Capacitor blocks
// module workers loaded from the capacitor:// scheme, so we inline the worker
// source at build time and serve it via a blob: URL, which always works.
const _workerBlob = new Blob([pdfWorkerContent], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(_workerBlob);

// No lookbehind assertion here — WebKit/Safari added lookbehind support only in
// iOS 16.4. Instead we match broadly and reject fragment matches by checking the
// preceding character in parseAmounts() below.
const rawAmountRe = /-?\d[\d,]*\.\d{2}(?!\d)/g;

// Lloyds statement transaction type codes that appear in the Type column.
// We strip these from the description so merchant names stay clean.
const txTypeRe = /\b(BGC|BP|CHG|CHQ|COR|CPT|DD|DEB|DEP|FEE|FPI|FPO|MPI|MPO|PAY|SO|TFR)\b/g;

// Flexible date matcher: "12 Jun 25", "12 June 2025", "12/06/25", "12-06-2025".
const datePattern = /\b(\d{1,2})[ /-]([A-Za-z]{3,9}|\d{1,2})[ /-](\d{2,4})\b/;

const months = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const noisePhrases = [
  'statement sheet',
  'sort code',
  'account number',
  'date description',
  'paid out',
  'paid in',
  'money in',
  'money out',
  'lloyds bank',
  'halifax',
  'your transactions',
  'balance carried forward',
  'balance on ',
  'transaction types',
  'blank.',
];

function looksLikeNoise(line) {
  const lower = line.toLowerCase();
  return noisePhrases.some((phrase) => lower.includes(phrase));
}

function parseDate(value) {
  const match = value.match(datePattern);
  if (!match) return '';
  const [, day, rawMonth, rawYear] = match;
  const month = /^\d+$/.test(rawMonth) ? rawMonth.padStart(2, '0') : months[rawMonth.toLowerCase().slice(0, 3)];
  if (!month) return '';
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function parseAmounts(line) {
  // Manually reject fragment matches instead of using a lookbehind assertion
  // (lookbehind requires iOS 16.4+; this approach works on any iOS version).
  rawAmountRe.lastIndex = 0;
  const results = [];
  let m;
  while ((m = rawAmountRe.exec(line)) !== null) {
    const charBefore = m.index > 0 ? line[m.index - 1] : '';
    if (!/[\d.,]/.test(charBefore)) {
      results.push(Number(m[0].replace(/,/g, '')));
    }
  }
  return results;
}

function cleanDescription(line) {
  return line
    .replace(datePattern, ' ')
    .replace(/-?\d[\d,]*\.\d{2}/g, ' ')
    // Strip Lloyds type codes (DEB, FPI, SO, etc.) that appear in the Type column
    .replace(txTypeRe, ' ')
    // Dots used as PDF column-separator leaders always appear flanked by spaces;
    // replace " . " and trim any leading/trailing standalone dots.
    .replace(/ \. /g, ' ')
    .replace(/^\. */, '')
    .replace(/ *\.$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim();
}

function inferCategory(description, amount) {
  const lower = description.toLowerCase();
  if (amount > 0) return 'Income';
  if (lower.includes('rent') || lower.includes('mortgage')) return 'Housing';
  if (lower.includes('council') || lower.includes('energy') || lower.includes('water') || lower.includes('mobile')) return 'Bills';
  if (lower.includes('aldi') || lower.includes('tesco') || lower.includes('morrisons') || lower.includes('asda') || lower.includes('sainsbury')) return 'Food shopping';
  if (lower.includes('uber') || lower.includes('train') || lower.includes('rail') || lower.includes('fuel') || lower.includes('petrol')) return 'Transport';
  if (lower.includes('apple.com') || lower.includes('amazon prime') || lower.includes('adobe') || lower.includes('spotify')) return 'Subscriptions';
  if (lower.includes('trading 212') || lower.includes('sipp') || lower.includes('savings')) return 'Savings';
  return 'Other';
}

function typeFor(category, amount) {
  if (amount > 0) return 'income';
  if (category === 'Savings') return 'invest';
  if (category === 'Bills' || category === 'Housing' || category === 'Debt') return 'bill';
  return 'spend';
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Group raw text items that share a baseline into one logical line, ordered
// left-to-right, so a row split across many PDF text items reads as one string.
function rowsFromItems(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let current = null;
  for (const item of sorted) {
    if (!current || Math.abs(item.y - current.y) > 3) {
      current = { y: item.y, parts: [] };
      rows.push(current);
    }
    current.parts.push(item);
  }
  return rows.map((row) => ({
    y: row.y,
    text: row.parts.map((part) => part.str).join(' ').replace(/\s+/g, ' ').trim(),
  }));
}

async function pageRows(page) {
  const content = await page.getTextContent();
  const items = content.items
    // pdfjs can return TextMarkedContent objects (no .str / .transform) mixed in
    // with real TextItem objects — filter to only items we can actually use.
    .filter((item) => typeof item.str === 'string' && Array.isArray(item.transform))
    .map((item) => ({ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .filter((item) => item.str);
  return rowsFromItems(items);
}

export async function parseLloydsStatementPdf(file, accountId) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // isEvalSupported: false makes pdfjs use compatible code paths in WebView
  // environments that restrict eval (e.g. Capacitor WKWebView).
  const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;

  const transactions = [];
  const diagnostics = { fileName: file.name, pages: pdf.numPages, rows: 0, datedRows: 0, matched: 0 };
  let previousBalance = null;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const rows = await pageRows(page);
    diagnostics.rows += rows.length;

    for (const { text } of rows) {
      const amounts = parseAmounts(text);

      // Capture the opening figure so the first real transaction can be signed
      // from the balance movement.
      if (looksLikeNoise(text)) {
        // "Balance brought forward" (older statements) or "Balance on 01 Feb 26"
        // (newer Club Lloyds format) both give us the opening balance.
        if (/balance (brought forward|on \d)/i.test(text) && amounts.length) {
          previousBalance = amounts[amounts.length - 1];
        }
        continue;
      }

      const date = parseDate(text);
      if (!date) continue;
      diagnostics.datedRows += 1;
      if (!amounts.length) continue;

      const description = cleanDescription(text);
      if (!description) continue;

      const balance = amounts.length > 1 ? amounts[amounts.length - 1] : null;
      const txAmount = amounts.length > 1 ? amounts[amounts.length - 2] : amounts[0];

      // Preferred: derive direction from how the running balance moved. This is
      // independent of the statement's column layout, which varies by template.
      let signed;
      if (balance !== null && previousBalance !== null) {
        const delta = round2(balance - previousBalance);
        signed = Math.abs(Math.abs(delta) - Math.abs(txAmount)) < 0.02 ? delta : -Math.abs(txAmount);
      } else if (txAmount < 0) {
        signed = txAmount;
      } else {
        // No balance reference yet and no explicit sign: default to an outgoing,
        // which is the common case and easy for the user to correct.
        signed = -Math.abs(txAmount);
      }
      signed = round2(signed);
      if (balance !== null) previousBalance = balance;
      if (!signed) continue;

      const category = inferCategory(description, signed);
      transactions.push({
        id: `pdf-${file.name}-${date}-${description}-${Math.abs(signed).toFixed(2)}-${balance ?? ''}`,
        accountId,
        merchant: description,
        category,
        classification: signed > 0 ? 'Essential' : 'Planned',
        amount: signed,
        date,
        type: typeFor(category, signed),
        balance: balance ?? '',
        sourceFile: file.name,
      });
    }
  }

  const unique = new Map();
  for (const tx of transactions) {
    unique.set([tx.accountId, tx.date, tx.merchant.toLowerCase(), tx.amount.toFixed(2), tx.balance].join('|'), tx);
  }
  const deduped = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
  diagnostics.matched = deduped.length;

  return { transactions: deduped, diagnostics };
}
