import * as pdfjsLib from 'pdfjs-dist/build/pdf.js';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js';

// pdfjs v3 checks globalThis.pdfjsWorker.WorkerMessageHandler before spawning
// a web worker. Setting it here makes all PDF parsing run on the main thread,
// which eliminates every web worker / URL-scheme issue (module workers blocked
// by WKWebView's capacitor:// scheme, iOS version gaps, etc.).
globalThis.pdfjsWorker = pdfjsWorker;

// No lookbehind assertion — WebKit/Safari only added lookbehind support in
// iOS 16.4. We match broadly and check the preceding character manually.
const rawAmountRe = /-?\d[\d,]*\.\d{2}(?!\d)/g;

// Flexible date matcher: "12 Jun 25", "12 June 2025", "12/06/25", "12-06-2025".
const datePattern = /\b(\d{1,2})[ /-]([A-Za-z]{3,9}|\d{1,2})[ /-](\d{2,4})\b/;

// Lloyds transaction type codes that appear in the Type column.
const txTypeRe = /\b(BGC|BP|CHG|CHQ|COR|CPT|DD|DEB|DEP|FEE|FPI|FPO|MPI|MPO|PAY|SO|TFR)\b/g;

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
    .replace(txTypeRe, ' ')
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
    .filter((item) => typeof item.str === 'string' && Array.isArray(item.transform))
    .map((item) => ({ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .filter((item) => item.str);
  return rowsFromItems(items);
}

export async function parseLloydsStatementPdf(file, accountId) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const transactions = [];
  const diagnostics = { fileName: file.name, pages: pdf.numPages, rows: 0, datedRows: 0, matched: 0 };
  let previousBalance = null;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const rows = await pageRows(page);
    diagnostics.rows += rows.length;

    for (const { text } of rows) {
      const amounts = parseAmounts(text);

      if (looksLikeNoise(text)) {
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

      let signed;
      if (balance !== null && previousBalance !== null) {
        const delta = round2(balance - previousBalance);
        signed = Math.abs(Math.abs(delta) - Math.abs(txAmount)) < 0.02 ? delta : -Math.abs(txAmount);
      } else if (txAmount < 0) {
        signed = txAmount;
      } else {
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
