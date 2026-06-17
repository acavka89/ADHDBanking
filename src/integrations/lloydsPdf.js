import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const amountPattern = /^-?\d{1,3}(?:,\d{3})*(?:\.\d{2})\.?$/;
const datePattern = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\.?$/;
const months = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function parseDate(value) {
  const match = value.match(datePattern);
  if (!match) return '';
  const [, day, month, year] = match;
  return `${year.length === 2 ? `20${year}` : year}-${months[month]}-${day.padStart(2, '0')}`;
}

function parseAmount(value) {
  return value.replace(/[,.]$/g, '').replace(/,/g, '');
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

function rowValue(items, y, left, right = null) {
  const match = items.find((item) => {
    if (Math.abs(item.y - y) >= 3) return false;
    if (item.x < left) return false;
    if (right !== null && item.x >= right) return false;
    return true;
  });
  return match?.str.replace(/\.$/, '') || '';
}

function rowAmount(items, y, left, right = null) {
  const value = rowValue(items, y, left, right);
  return amountPattern.test(value) ? parseAmount(value) : '';
}

async function pageTransactions(page, fileName, accountId) {
  const content = await page.getTextContent();
  const items = content.items
    .map((item) => ({
      str: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
    }))
    .filter((item) => item.str);

  const rows = [];
  for (const item of items) {
    const date = parseDate(item.str);
    if (!date || item.x > 90) continue;

    const description = rowValue(items, item.y, 110, 270);
    if (!description) continue;

    const transactionType = rowValue(items, item.y, 270, 320);
    const moneyIn = rowAmount(items, item.y, 320, 424);
    const moneyOut = rowAmount(items, item.y, 424, 500);
    const balance = rowAmount(items, item.y, 500);
    const signedAmount = moneyIn ? Number(moneyIn) : moneyOut ? -Number(moneyOut) : 0;
    if (!signedAmount) continue;

    const category = inferCategory(description, signedAmount);
    rows.push({
      id: `pdf-${fileName}-${date}-${description}-${Math.abs(signedAmount).toFixed(2)}-${balance}`,
      accountId,
      merchant: transactionType ? `${description} (${transactionType})` : description,
      category,
      classification: signedAmount > 0 ? 'Essential' : 'Planned',
      amount: signedAmount,
      date,
      type: typeFor(category, signedAmount),
      balance,
      sourceFile: fileName,
    });
  }
  return rows;
}

export async function parseLloydsStatementPdf(file, accountId) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes, disableWorker: true }).promise;
  const transactions = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    transactions.push(...await pageTransactions(page, file.name, accountId));
  }

  const unique = new Map();
  for (const tx of transactions) {
    unique.set([tx.accountId, tx.date, tx.merchant.toLowerCase(), tx.amount.toFixed(2), tx.balance].join('|'), tx);
  }

  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}
