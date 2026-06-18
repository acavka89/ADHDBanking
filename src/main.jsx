import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BadgePoundSterling,
  Banknote,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  Cloud,
  CreditCard,
  Download,
  Gauge,
  HeartHandshake,
  Home,
  Landmark,
  ListChecks,
  LockKeyhole,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  WalletCards,
  Zap,
} from 'lucide-react';
import {
  getSession,
  hasSupabaseConfig,
  invokeFunction,
  loadRemoteSnapshot,
  signInWithPassword,
  signUpWithPassword,
  signOut,
  supabase,
} from './integrations/supabase.js';
import { mergeRemoteSnapshot } from './integrations/sync.js';
import './styles.css';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const todayIso = new Date().toISOString().slice(0, 10);
const dayMs = 86400000;

const categories = [
  'Income',
  'Housing',
  'Bills',
  'Food shopping',
  'Takeaways',
  'Transport',
  'Shopping',
  'Entertainment',
  'Subscriptions',
  'Debt',
  'Savings',
  'Transfers',
  'Health',
  'Other',
];

const classifications = [
  'Essential',
  'Planned',
  'Enjoyed it',
  'Impulsive',
  'Regret',
  'Work expense',
  'Reimbursable',
  'Ignore',
];

const seed = {
  version: 3,
  profile: {
    displayName: '',
    payday: '',
    monthlyIncome: 0,
    expectedFoodTravel: 0,
    debtMinimums: 0,
    savingsGoal: 0,
    currentSavings: 0,
    emergencyBuffer: 0,
    forgottenCostBuffer: 0,
    reviewStreak: 0,
    bankConnected: false,
    trading212Connected: false,
    notifications: true,
    recoveryRoute: '',
  },
  accounts: [
    { id: 'lloyds-personal', name: 'Lloyds personal', institution: 'Lloyds', purpose: 'personal', balance: 0, includeInSafeSpend: true },
    { id: 'halifax-joint', name: 'Halifax joint', institution: 'Halifax', purpose: 'household', balance: 0, includeInSafeSpend: true },
  ],
  transactions: [],
  recurring: [],
  pauses: [],
  opportunities: [],
  goals: [],
  scoreHistory: [],
};

// Anything that is not the current empty-state version is replaced with a fresh
// blank slate. This clears the old demo data so every screen reflects real
// imported/entered figures rather than seeded examples.
function migrateData(raw) {
  if (raw && raw.version === 3) return raw;
  return seed;
}

function useStoredState() {
  const [data, setData] = useState(() => {
    try {
      return migrateData(JSON.parse(localStorage.getItem('safespend:data')));
    } catch {
      return seed;
    }
  });
  const save = (updater) => {
    setData((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      localStorage.setItem('safespend:data', JSON.stringify(next));
      return next;
    });
  };
  return [data, save, () => save(seed)];
}

function accountsFor(data) {
  return data.accounts?.length ? data.accounts : seed.accounts;
}

function accountName(data, accountId) {
  return accountsFor(data).find((account) => account.id === accountId)?.name || 'Unassigned';
}

function accountPurpose(data, accountId) {
  return accountsFor(data).find((account) => account.id === accountId)?.purpose || 'personal';
}

function daysBetween(date) {
  const start = new Date(todayIso + 'T00:00:00');
  const end = new Date(date + 'T00:00:00');
  return Math.max(0, Math.ceil((end - start) / dayMs));
}

function isBeforePayday(date, payday) {
  return date <= payday;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function derive(data) {
  const includedAccountIds = new Set(accountsFor(data).filter((account) => account.includeInSafeSpend !== false).map((account) => account.id));
  const includedTransactions = data.transactions.filter((tx) => !tx.accountId || includedAccountIds.has(tx.accountId));
  const debits = includedTransactions.filter((tx) => tx.amount < 0);
  const balance = data.profile.monthlyIncome + debits.reduce((sum, tx) => sum + tx.amount, 0);
  const daysUntilPayday = data.profile.payday ? Math.max(1, daysBetween(data.profile.payday)) : 30;
  const protectedBills = data.recurring
    .filter((item) => item.active && item.status === 'Essential' && isBeforePayday(item.nextDate, data.profile.payday))
    .reduce((sum, item) => sum + item.amount, 0);
  const expectedEssentials = data.profile.expectedFoodTravel + data.profile.debtMinimums;
  const buffers = data.profile.emergencyBuffer + data.profile.forgottenCostBuffer;
  const savingsStillNeeded = Math.max(0, data.profile.savingsGoal - data.profile.currentSavings);
  const protectedTotal = protectedBills + expectedEssentials + buffers + savingsStillNeeded;
  const flexible = Math.max(0, balance - protectedTotal);
  const safeToday = flexible / daysUntilPayday;
  const spentThisCycle = Math.abs(debits.filter((tx) => tx.type !== 'invest').reduce((sum, tx) => sum + tx.amount, 0));
  const householdSpent = Math.abs(debits.filter((tx) => accountPurpose(data, tx.accountId) === 'household').reduce((sum, tx) => sum + tx.amount, 0));
  const personalSpent = Math.abs(debits.filter((tx) => accountPurpose(data, tx.accountId) !== 'household').reduce((sum, tx) => sum + tx.amount, 0));
  const reviewedRecurring = data.recurring.filter((item) => item.status !== 'Not sure').length / Math.max(1, data.recurring.length);
  const impulseSpend = Math.abs(debits.filter((tx) => ['Impulsive', 'Regret'].includes(tx.classification)).reduce((sum, tx) => sum + tx.amount, 0));
  const savingsProgress = clamp(data.profile.currentSavings / Math.max(1, data.profile.savingsGoal), 0, 1);
  const paceTarget = Math.max(1, data.profile.monthlyIncome - protectedTotal);
  const pace = clamp(1 - spentThisCycle / Math.max(1, paceTarget), 0, 1);
  const score = {
    bills: protectedBills <= balance ? 250 : clamp(Math.round((balance / Math.max(1, protectedBills)) * 250), 0, 250),
    pace: Math.round(pace * 200),
    payday: data.profile.payday ? 135 : 40,
    buffer: Math.round(savingsProgress * 150),
    recurring: Math.round(reviewedRecurring * 100),
    habit: Math.round(clamp(1 - impulseSpend / 180, 0.2, 1) * 100),
    engagement: Math.min(50, data.profile.reviewStreak * 10 + (data.profile.recoveryRoute ? 10 : 0)),
  };
  const totalScore = Object.values(score).reduce((sum, value) => sum + value, 0);
  const nextPayments = data.recurring
    .filter((item) => item.active)
    .slice()
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 3);
  const plan = [
    { type: 'Bills', planned: protectedBills, spent: spentThisCycle, protected: true },
    { type: 'Food and transport', planned: data.profile.expectedFoodTravel, spent: spentBy(data, ['Food shopping', 'Transport', 'Takeaways']), protected: true },
    { type: 'Debt payments', planned: data.profile.debtMinimums, spent: spentBy(data, ['Debt']), protected: true },
    { type: 'Savings', planned: savingsStillNeeded, spent: Math.abs(debits.filter((tx) => tx.type === 'invest' || tx.category === 'Savings').reduce((sum, tx) => sum + tx.amount, 0)), protected: true },
    { type: 'Emergency buffer', planned: data.profile.emergencyBuffer, spent: 0, protected: true },
    { type: 'Forgotten-cost buffer', planned: data.profile.forgottenCostBuffer, spent: 0, protected: true },
    { type: 'Guilt-free spending', planned: flexible, spent: spentBy(data, ['Shopping', 'Entertainment']), protected: false },
  ];
  const oneAction = chooseAction({ data, safeToday, protectedBills, balance, totalScore });
  const scoreBand = totalScore >= 850 ? 'Strong' : totalScore >= 700 ? 'Steady' : totalScore >= 550 ? 'Building' : totalScore >= 400 ? 'Needs attention' : "Let's make a plan";
  return { balance, daysUntilPayday, protectedBills, expectedEssentials, buffers, protectedTotal, flexible, safeToday, spentThisCycle, householdSpent, personalSpent, score, totalScore, scoreBand, nextPayments, plan, oneAction };
}

function spentBy(data, cats) {
  return Math.abs(data.transactions.filter((tx) => tx.amount < 0 && cats.includes(tx.category)).reduce((sum, tx) => sum + tx.amount, 0));
}

function detectPlanFromTransactions(transactions) {
  const result = { profile: {}, recurring: [] };
  if (!transactions.length) return result;

  // ── Income / payday ──────────────────────────────────────────────────────
  const incomeTxs = transactions.filter((tx) => tx.amount > 0);
  if (incomeTxs.length) {
    const groups = {};
    for (const tx of incomeTxs) {
      const key = tx.merchant.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      (groups[key] ||= []).push(tx);
    }
    // Highest-total group = salary
    const salaryGroup = Object.values(groups).sort(
      (a, b) => b.reduce((s, t) => s + t.amount, 0) - a.reduce((s, t) => s + t.amount, 0)
    )[0];
    const avgIncome = salaryGroup.reduce((s, t) => s + t.amount, 0) / salaryGroup.length;
    result.profile.monthlyIncome = Math.round(avgIncome * 100) / 100;

    const dayCounts = {};
    for (const tx of salaryGroup) {
      const d = new Date(tx.date + 'T12:00:00').getDate();
      dayCounts[d] = (dayCounts[d] || 0) + 1;
    }
    const paydayDay = Number(Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0]);
    const today = new Date(todayIso + 'T12:00:00');
    let payday = new Date(today.getFullYear(), today.getMonth(), paydayDay);
    if (payday <= today) payday = new Date(today.getFullYear(), today.getMonth() + 1, paydayDay);
    result.profile.payday = payday.toISOString().slice(0, 10);
  }

  // ── Recurring payments ───────────────────────────────────────────────────
  const outgoing = transactions.filter((tx) => tx.amount < 0);
  const byMerchant = {};
  for (const tx of outgoing) {
    const key = tx.merchant.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40);
    (byMerchant[key] ||= []).push(tx);
  }

  const addedKeys = new Set();

  // Strategy A: same merchant, 2+ times, consistent amount and ~monthly/weekly interval
  for (const [key, txs] of Object.entries(byMerchant)) {
    if (txs.length < 2) continue;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((tx) => Math.abs(tx.amount));
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - avgAmount) / Math.max(avgAmount, 0.01) > 0.2)) continue;

    const dates = sorted.map((tx) => new Date(tx.date + 'T12:00:00').getTime());
    const intervals = dates.slice(1).map((d, i) => (d - dates[i]) / dayMs);
    const avgInterval = intervals.reduce((s, i) => s + i, 0) / intervals.length;
    const isMonthly = avgInterval >= 25 && avgInterval <= 35;
    const isWeekly = avgInterval >= 5 && avgInterval <= 10;
    if (!isMonthly && !isWeekly) continue;
    if (intervals.some((i) => Math.abs(i - avgInterval) > 6)) continue;

    const intervalDays = isWeekly ? 7 : 30;
    const lastMs = new Date(sorted.at(-1).date + 'T12:00:00').getTime();
    const nextDate = new Date(lastMs + intervalDays * dayMs);
    const todayMs = new Date(todayIso + 'T12:00:00').getTime();
    while (nextDate.getTime() < todayMs) nextDate.setDate(nextDate.getDate() + intervalDays);

    addedKeys.add(key);
    result.recurring.push({
      id: `auto-${key}`,
      merchant: sorted.at(-1).merchant,
      amount: -(Math.round(avgAmount * 100) / 100),
      nextDate: nextDate.toISOString().slice(0, 10),
      active: true,
      status: 'Essential',
    });
  }

  // Strategy B: Bills / Subscriptions / Housing / Debt seen even once
  const billCats = new Set(['Bills', 'Housing', 'Subscriptions', 'Debt']);
  for (const [key, txs] of Object.entries(byMerchant)) {
    if (addedKeys.has(key)) continue;
    const billTxs = txs.filter((tx) => billCats.has(tx.category));
    if (!billTxs.length) continue;
    const sorted = [...billTxs].sort((a, b) => a.date.localeCompare(b.date));
    const avgAmount = sorted.reduce((s, tx) => s + Math.abs(tx.amount), 0) / sorted.length;
    const lastMs = new Date(sorted.at(-1).date + 'T12:00:00').getTime();
    const nextDate = new Date(lastMs + 30 * dayMs);
    const todayMs = new Date(todayIso + 'T12:00:00').getTime();
    while (nextDate.getTime() < todayMs) nextDate.setDate(nextDate.getDate() + 30);

    result.recurring.push({
      id: `auto-${key}`,
      merchant: sorted.at(-1).merchant,
      amount: -(Math.round(avgAmount * 100) / 100),
      nextDate: nextDate.toISOString().slice(0, 10),
      active: true,
      status: 'Essential',
    });
  }

  // ── Category spend averages ──────────────────────────────────────────────
  const sortedDates = [...transactions.map((tx) => tx.date)].sort();
  const spanMs = new Date(sortedDates.at(-1) + 'T12:00:00') - new Date(sortedDates[0] + 'T12:00:00');
  const months = Math.max(1, Math.round(spanMs / (dayMs * 30)) || 1);

  const catSum = (cats) =>
    transactions.filter((tx) => tx.amount < 0 && cats.includes(tx.category))
      .reduce((s, tx) => s + Math.abs(tx.amount), 0);

  const foodTravel = catSum(['Food shopping', 'Transport', 'Takeaways']);
  const debt = catSum(['Debt']);
  if (foodTravel > 0) result.profile.expectedFoodTravel = Math.round(foodTravel / months);
  if (debt > 0) result.profile.debtMinimums = Math.round(debt / months);

  return result;
}

function chooseAction({ data, safeToday, protectedBills, balance, totalScore }) {
  if (protectedBills > balance) return 'Protect essentials only and rebuild the plan from today.';
  if (safeToday < 5) return 'Use Recovery Mode to make the next few days easier.';
  if (data.opportunities.some((item) => item.response === 'Not reviewed')) return 'Review one possible saving, then stop.';
  if (totalScore < 700) return 'Classify one recent transaction to improve the plan.';
  return 'Keep today simple: stay near the safe-to-spend amount.';
}

function scoreDelta(data, totalScore) {
  const previous = data.scoreHistory.at(-2)?.score || totalScore;
  return totalScore - previous;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normaliseHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function firstValue(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseMoney(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = String(value).replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return todayIso;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const ukMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (ukMatch) {
    const year = ukMatch[3].length === 2 ? `20${ukMatch[3]}` : ukMatch[3];
    return `${year}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? todayIso : date.toISOString().slice(0, 10);
}

function inferCategory(merchant, amount) {
  const lower = merchant.toLowerCase();
  if (amount > 0) return 'Income';
  if (lower.includes('rent') || lower.includes('mortgage')) return 'Housing';
  if (lower.includes('council') || lower.includes('energy') || lower.includes('water') || lower.includes('phone')) return 'Bills';
  if (lower.includes('aldi') || lower.includes('tesco') || lower.includes('sainsbury') || lower.includes('morrisons') || lower.includes('asda')) return 'Food shopping';
  if (lower.includes('uber') || lower.includes('train') || lower.includes('rail') || lower.includes('fuel') || lower.includes('petrol')) return 'Transport';
  if (lower.includes('netflix') || lower.includes('spotify') || lower.includes('apple.com') || lower.includes('subscription')) return 'Subscriptions';
  if (lower.includes('trading 212') || lower.includes('savings')) return 'Savings';
  return 'Other';
}

function typeFor(category, amount) {
  if (amount > 0) return 'income';
  if (category === 'Savings') return 'invest';
  if (category === 'Bills' || category === 'Housing' || category === 'Debt') return 'bill';
  return 'spend';
}

function transactionKey(tx) {
  return [tx.accountId || 'unassigned', tx.date, tx.merchant.toLowerCase(), Number(tx.amount).toFixed(2), tx.balance || ''].join('|');
}

function parseTransactionsCsv(text, accountId = 'lloyds-personal') {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex] || '']));
    const merchant = firstValue(record, ['description', 'transactiondescription', 'transactiondetails', 'details', 'merchant', 'name', 'memo', 'reference']) || 'Lloyds transaction';
    const date = parseDate(firstValue(record, ['date', 'transactiondate', 'postingdate']));
    const debit = parseMoney(firstValue(record, ['debit', 'debitamount', 'moneyout', 'paidout', 'out']));
    const credit = parseMoney(firstValue(record, ['credit', 'creditamount', 'moneyin', 'paidin', 'in']));
    const signedAmount = parseMoney(firstValue(record, ['amount', 'transactionamount', 'value']));
    const amount = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : signedAmount;
    const category = inferCategory(merchant, amount);
    return {
      id: `csv-${date}-${index}-${Math.abs(amount).toFixed(2)}-${merchant.slice(0, 18)}`,
      accountId,
      merchant,
      category,
      classification: amount > 0 ? 'Essential' : 'Planned',
      amount,
      date,
      type: typeFor(category, amount),
    };
  }).filter((tx) => tx.amount && tx.date && tx.merchant);
}

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'plan', label: 'Plan', icon: ListChecks },
  { id: 'buy', label: 'Buy?', icon: ShoppingBag },
  { id: 'score', label: 'Score', icon: Gauge },
  { id: 'opportunities', label: 'Savings', icon: Sparkles },
  { id: 'settings', label: 'More', icon: Settings },
];

function Header({ setActive, integrationStatus }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => setActive('home')}>
        <WalletCards size={28} /> SafeSpend
      </button>
      <span className="sync-pill"><Cloud size={16} /> {integrationStatus}</span>
    </header>
  );
}

function BottomNav({ active, setActive }) {
  return (
    <nav className="nav" aria-label="Main navigation">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomePage({ data, stats, setActive }) {
  const delta = scoreDelta(data, stats.totalScore);
  return (
    <main className="stack">
      <section className="hero">
        <p className="eyebrow">Safe to spend today</p>
        <p className="money">{currency.format(stats.safeToday)}</p>
        <p className="hero-detail">{currency.format(stats.flexible)} flexible until payday in {stats.daysUntilPayday} days</p>
        <p className="pill safe"><CheckCircle2 size={16} /> Bills and buffers checked first</p>
      </section>

      <section className="grid-2">
        <Metric icon={ShieldCheck} label="Protected money" value={currency.format(stats.protectedTotal)} tone="primary" />
        <Metric icon={Gauge} label="SafeSpend Score" value={`${stats.totalScore}`} detail={`${stats.scoreBand} ${delta >= 0 ? '+' : ''}${delta}`} tone="secondary" />
      </section>

      <section className="action-band">
        <div>
          <p className="pill safe"><Sparkles size={15} /> One useful action</p>
          <h2>{stats.oneAction}</h2>
        </div>
        <button className="primary-btn" onClick={() => setActive(stats.safeToday < 5 ? 'recovery' : 'opportunities')}>
          <ChevronRight size={18} /> Start
        </button>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Next expected payments</h2>
          <button className="text-btn" onClick={() => setActive('plan')}>Plan <ChevronRight size={16} /></button>
        </div>
        {stats.nextPayments.length
          ? stats.nextPayments.map((item) => <RecurringRow key={item.id} item={item} compact />)
          : <p className="subtle">No upcoming payments yet. Add them in Plan.</p>}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Recent activity</h2>
          <button className="text-btn" onClick={() => setActive('transactions')}>All <ChevronRight size={16} /></button>
        </div>
        {data.transactions.length
          ? data.transactions.slice(-4).reverse().map((tx) => <TransactionRow key={tx.id} tx={tx} data={data} />)
          : <p className="subtle">No transactions yet. Import a statement or add one in Transactions.</p>}
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value, detail, tone }) {
  return (
    <div className="card kpi">
      <Icon className={tone === 'secondary' ? 'icon-secondary' : 'icon-primary'} />
      <span className="subtle">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="meta">{detail}</span>}
    </div>
  );
}

function PlanPage({ data, save, stats, setActive }) {
  const setProfile = (patch) => save((current) => ({ ...current, profile: { ...current.profile, ...patch } }));
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Current pay-cycle plan</h1>
        <p className="subtle">Your account balance gets jobs before any guilt-free spending is shown.</p>
      </section>
      <AutoFillCard data={data} save={save} />
      <section className="card form">
        <div className="inline-fields">
          <label>Next payday<input type="date" value={data.profile.payday} onChange={(event) => setProfile({ payday: event.target.value })} /></label>
          <label>Income<input type="number" value={data.profile.monthlyIncome} onChange={(event) => setProfile({ monthlyIncome: Number(event.target.value) })} /></label>
        </div>
        <div className="inline-fields">
          <label>Food and travel<input type="number" value={data.profile.expectedFoodTravel} onChange={(event) => setProfile({ expectedFoodTravel: Number(event.target.value) })} /></label>
          <label>Debt minimums<input type="number" value={data.profile.debtMinimums} onChange={(event) => setProfile({ debtMinimums: Number(event.target.value) })} /></label>
        </div>
        <div className="inline-fields">
          <label>Emergency buffer<input type="number" value={data.profile.emergencyBuffer} onChange={(event) => setProfile({ emergencyBuffer: Number(event.target.value) })} /></label>
          <label>Forgotten-cost buffer<input type="number" value={data.profile.forgottenCostBuffer} onChange={(event) => setProfile({ forgottenCostBuffer: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Accounts</h2>
          <span className="pill safe">{currency.format(stats.balance)} planned balance</span>
        </div>
        {accountsFor(data).map((account) => (
          <div className="row" key={account.id}>
            <div className="left">
              <div className="avatar"><Landmark size={20} /></div>
              <div><p className="title">{account.name}</p><p className="meta">{account.purpose === 'household' ? 'Household and joint costs' : 'Personal money'} · {account.includeInSafeSpend === false ? 'Excluded' : 'Included'}</p></div>
            </div>
            <strong>{currency.format(account.balance || 0)}</strong>
          </div>
        ))}
      </section>
      <section className="grid-2">
        <Metric icon={Home} label="Household spend" value={currency.format(stats.householdSpent)} tone="primary" />
        <Metric icon={WalletCards} label="Personal spend" value={currency.format(stats.personalSpent)} tone="secondary" />
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Allocation</h2>
          <span className="pill safe">{currency.format(stats.flexible)} flexible</span>
        </div>
        {stats.plan.map((row) => <AllocationRow key={row.type} row={row} />)}
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Recurring payments</h2>
          <button className="text-btn" onClick={() => setActive('settings')}>Edit <ChevronRight size={16} /></button>
        </div>
        {data.recurring.map((item) => <RecurringRow key={item.id} item={item} />)}
      </section>
    </main>
  );
}

function AutoFillCard({ data, save }) {
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState(false);

  if (!data.transactions.length) return null;

  const detect = () => {
    setPreview(detectPlanFromTransactions(data.transactions));
    setApplied(false);
  };

  const apply = () => {
    save((current) => ({
      ...current,
      profile: { ...current.profile, ...preview.profile },
      recurring: [
        ...current.recurring.filter((r) => !r.id.startsWith('auto-')),
        ...preview.recurring,
      ],
    }));
    setApplied(true);
    setPreview(null);
  };

  if (applied) {
    return (
      <section className="card">
        <p className="pill safe"><CheckCircle2 size={16} /> Plan filled — review the fields below and adjust if needed.</p>
      </section>
    );
  }

  if (preview) {
    const { profile, recurring } = preview;
    return (
      <section className="card form">
        <div className="section-title">
          <h2>Detected from your transactions</h2>
          <p className="pill safe"><Zap size={15} /> Preview</p>
        </div>
        <div className="stack">
          {profile.monthlyIncome > 0 && (
            <div className="row"><div className="left"><div className="avatar"><Banknote size={20} /></div><div><p className="title">Monthly income</p><p className="meta">Next payday {profile.payday}</p></div></div><strong>{currency.format(profile.monthlyIncome)}</strong></div>
          )}
          {profile.expectedFoodTravel > 0 && (
            <div className="row"><div className="left"><div className="avatar"><ShoppingBag size={20} /></div><div><p className="title">Food and travel avg.</p><p className="meta">Per month from history</p></div></div><strong>{currency.format(profile.expectedFoodTravel)}</strong></div>
          )}
          {profile.debtMinimums > 0 && (
            <div className="row"><div className="left"><div className="avatar"><CreditCard size={20} /></div><div><p className="title">Debt minimums avg.</p><p className="meta">Per month from history</p></div></div><strong>{currency.format(profile.debtMinimums)}</strong></div>
          )}
          {recurring.length > 0 && (
            <div>
              <p className="meta" style={{ marginBottom: 8 }}>{recurring.length} recurring payments detected</p>
              {recurring.slice(0, 5).map((item) => (
                <div className="row compact-row" key={item.id}>
                  <div className="left"><div className="avatar"><ReceiptText size={18} /></div><div><p className="title">{item.merchant}</p><p className="meta">Next {item.nextDate}</p></div></div>
                  <strong>{currency.format(item.amount)}</strong>
                </div>
              ))}
              {recurring.length > 5 && <p className="meta">…and {recurring.length - 5} more</p>}
            </div>
          )}
        </div>
        <button className="primary-btn" onClick={apply}><CheckCircle2 size={18} /> Apply to plan</button>
        <button className="secondary-btn" onClick={() => setPreview(null)}>Cancel</button>
      </section>
    );
  }

  const planEmpty = !data.profile.monthlyIncome && !data.recurring.length;
  return (
    <section className="card">
      {planEmpty && <p className="pill warn"><BellRing size={15} /> Plan not filled yet</p>}
      <h2>Auto-fill from transactions</h2>
      <p className="subtle">Detect income, payday, recurring bills, and spending averages from your {data.transactions.length} imported transactions.</p>
      <button className="primary-btn" onClick={detect}><Zap size={18} /> Detect now</button>
    </section>
  );
}

function AllocationRow({ row }) {
  const width = clamp(Math.round((row.spent / Math.max(1, row.planned)) * 100), 0, 100);
  return (
    <div className="allocation">
      <div className="section-title">
        <div>
          <p className="title">{row.type}</p>
          <p className="meta">{row.protected ? 'Protected' : 'Flexible'}</p>
        </div>
        <strong>{currency.format(row.planned)}</strong>
      </div>
      <div className={row.protected ? 'progress' : 'progress warn'}><span style={{ width: `${width}%` }} /></div>
    </div>
  );
}

function BuyCheck({ data, save, stats }) {
  const [form, setForm] = useState({ item: '', amount: '', link: '', reason: '', delay: '1440' });
  const amount = Number(form.amount || 0);
  const decision = amount <= 0 ? null : amount <= stats.safeToday ? 'yes' : amount <= stats.safeToday * 2 ? 'careful' : 'pause';
  const addPause = () => {
    if (!form.item || amount <= 0) return;
    const minutes = Number(form.delay);
    const now = Date.now();
    save((current) => ({
      ...current,
      pauses: [{ id: now, item: form.item, amount, link: form.link, reason: form.reason || 'Impulse check', createdAt: now, reviewAt: now + minutes * 60000 }, ...current.pauses],
    }));
    setForm({ item: '', amount: '', link: '', reason: '', delay: '1440' });
  };
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Can I buy this?</h1>
        <p className="subtle">A pause button for the want-it-now moment. No judgement, just a clearer next step.</p>
      </section>
      <section className="card form">
        <label>Item<input value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} placeholder="e.g. New trainers" /></label>
        <div className="inline-fields">
          <label>Price<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="49.99" /></label>
          <label>Pause<select value={form.delay} onChange={(event) => setForm({ ...form, delay: event.target.value })}>
            <option value="10">10 minutes</option>
            <option value="30">30 minutes</option>
            <option value="120">2 hours</option>
            <option value="1440">24 hours</option>
          </select></label>
        </div>
        <label>Link<input value={form.link} onChange={(event) => setForm({ ...form, link: event.target.value })} placeholder="Optional product link" /></label>
        <label>Reason<textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Useful, urgent, boredom, reward..." /></label>
      </section>
      {decision && (
        <section className="card decision">
          {decision === 'yes' && <><p className="pill safe"><CheckCircle2 size={16} /> Looks safe</p><h2>You can buy it and stay inside today&apos;s SafeSpend.</h2><p className="subtle">After buying, today&apos;s remaining safe spend would be {currency.format(stats.safeToday - amount)}.</p></>}
          {decision === 'careful' && <><p className="pill warn"><BellRing size={16} /> Careful</p><h2>This borrows from tomorrow.</h2><p className="subtle">It may still be okay. A short pause can make the decision easier.</p></>}
          {decision === 'pause' && <><p className="pill wait"><CirclePause size={16} /> Pause suggested</p><h2>Add it to the wishlist before buying.</h2><p className="subtle">This protects future-you without saying current-you did anything wrong.</p></>}
          <button className={decision === 'yes' ? 'secondary-btn' : 'primary-btn'} onClick={addPause}><Clock3 size={18} /> Add to purchase pause</button>
        </section>
      )}
      <PauseList pauses={data.pauses} save={save} />
    </main>
  );
}

function PauseList({ pauses, save }) {
  const remove = (id) => save((current) => ({ ...current, pauses: current.pauses.filter((item) => item.id !== id) }));
  return (
    <section className="card">
      <h2>Wishlist and pause list</h2>
      {pauses.map((item) => {
        const remainingMs = item.reviewAt - Date.now();
        const done = remainingMs <= 0;
        const total = item.reviewAt - item.createdAt;
        const width = done ? 100 : clamp(Math.round(((Date.now() - item.createdAt) / Math.max(1, total)) * 100), 0, 100);
        return (
          <div className="pause-item" key={item.id}>
            <div className="section-title">
              <div>
                <p className="title">{item.item}</p>
                <p className="meta">{item.reason}</p>
              </div>
              <strong>{currency.format(item.amount)}</strong>
            </div>
            <p className={`pill ${done ? 'safe' : 'warn'}`}>{done ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}{done ? 'Ready to review' : `${Math.ceil(remainingMs / 3600000)}h remaining`}</p>
            <div className={done ? 'progress' : 'progress warn'}><span style={{ width: `${width}%` }} /></div>
            <button className="secondary-btn" onClick={() => remove(item.id)}>{done ? 'Decision made' : 'Keep waiting'}</button>
          </div>
        );
      })}
    </section>
  );
}

function OpportunitiesPage({ data, save }) {
  const responses = ['Help me reduce this', 'Keep it', 'Important to me', 'Remind me later', 'Hide suggestions like this', 'I already cancelled it'];
  const setResponse = (id, response) => save((current) => ({
    ...current,
    opportunities: current.opportunities.map((item) => item.id === id ? { ...item, response } : item),
  }));
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Possible savings</h1>
        <p className="subtle">The app asks and learns. It does not decide that a purchase was wrong.</p>
      </section>
      {data.opportunities.length === 0 && (
        <section className="card">
          <p className="subtle">No savings suggestions yet. They appear as the app learns from your transactions.</p>
        </section>
      )}
      {data.opportunities.map((item) => (
        <section className="card opportunity" key={item.id}>
          <div className="section-title">
            <p className="pill warn"><Sparkles size={15} /> {item.type}</p>
            <strong>{currency.format(item.saving)}/mo</strong>
          </div>
          <h2>{item.merchant}</h2>
          <p className="subtle">{item.prompt}</p>
          <p className="meta">Confidence {item.confidence}% · Response: {item.response}</p>
          <div className="chips">
            {responses.map((response) => (
              <button key={response} className={item.response === response ? 'chip active' : 'chip'} onClick={() => setResponse(item.id, response)}>{response}</button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function ScorePage({ data, stats, setActive }) {
  const parts = [
    ['Bills protected', stats.score.bills, 250],
    ['Spending pace', stats.score.pace, 200],
    ['Payday planning', stats.score.payday, 150],
    ['Buffer and savings', stats.score.buffer, 150],
    ['Recurring-cost awareness', stats.score.recurring, 100],
    ['Habit progress', stats.score.habit, 100],
    ['Engagement and recovery', stats.score.engagement, 50],
  ];
  return (
    <main className="stack">
      <section className="hero compact">
        <p className="eyebrow">SafeSpend Score</p>
        <p className="money">{stats.totalScore}</p>
        <p className="hero-detail">{stats.scoreBand}</p>
        <p className="subtle">Measures habits and protection, not income, creditworthiness or personal worth.</p>
      </section>
      <section className="card">
        <h2>Breakdown</h2>
        {parts.map(([label, value, max]) => (
          <div className="score-row" key={label}>
            <div className="section-title"><p className="title">{label}</p><strong>{value}/{max}</strong></div>
            <div className="progress"><span style={{ width: `${Math.round((value / max) * 100)}%` }} /></div>
          </div>
        ))}
      </section>
      <section className="action-band">
        <div>
          <p className="pill safe"><HeartHandshake size={15} /> Recovery is allowed</p>
          <h2>{stats.oneAction}</h2>
        </div>
        <button className="primary-btn" onClick={() => setActive('recovery')}><RefreshCw size={18} /> Recovery</button>
      </section>
    </main>
  );
}

function RecoveryPage({ data, save, stats }) {
  const routes = [
    { id: 'gentle', title: 'Gentle adjustment', body: `Reduce the remaining daily amount to ${currency.format(stats.safeToday * 0.9)} and keep goals active.` },
    { id: 'essentials', title: 'Protect essentials only', body: 'Temporarily pause optional goals while preserving critical payments.' },
    { id: 'reset', title: 'Reset from today', body: 'Rebuild the plan from the current balance and today onward.' },
  ];
  const choose = (route) => save((current) => ({ ...current, profile: { ...current.profile, recoveryRoute: route, reviewStreak: current.profile.reviewStreak + 1 } }));
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Recovery mode</h1>
        <p className="subtle">Your original plan no longer matches reality. Let&apos;s build one that does.</p>
      </section>
      {routes.map((route) => (
        <section className={data.profile.recoveryRoute === route.id ? 'card selected-card' : 'card'} key={route.id}>
          <div className="section-title">
            <h2>{route.title}</h2>
            {data.profile.recoveryRoute === route.id && <p className="pill safe"><CheckCircle2 size={15} /> Active</p>}
          </div>
          <p className="subtle">{route.body}</p>
          <button className="primary-btn" onClick={() => choose(route.id)}>Use this route</button>
        </section>
      ))}
    </main>
  );
}

function TransactionsPage({ data, save }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedImportAccount, setSelectedImportAccount] = useState('lloyds-personal');
  const [draft, setDraft] = useState({ merchant: '', amount: '', direction: 'out', accountId: 'lloyds-personal', category: 'Shopping', classification: 'Planned', date: todayIso });
  const [importSummary, setImportSummary] = useState('');
  const list = data.transactions
    .filter((tx) => filter === 'all' || tx.category === filter || tx.type === filter)
    .filter((tx) => tx.merchant.toLowerCase().includes(query.toLowerCase()));
  const updateTx = (id, patch) => save((current) => ({
    ...current,
    transactions: current.transactions.map((tx) => tx.id === id ? { ...tx, ...patch } : tx),
  }));
  const addTx = () => {
    const amount = Number(draft.amount);
    if (!draft.merchant || !amount) return;
    const signedAmount = draft.direction === 'in' ? Math.abs(amount) : -Math.abs(amount);
    const category = draft.direction === 'in' ? 'Income' : draft.category;
    save((current) => ({
      ...current,
      transactions: [...current.transactions, { id: Date.now(), accountId: draft.accountId, merchant: draft.merchant, amount: signedAmount, category, classification: draft.classification, date: draft.date, type: typeFor(category, signedAmount) }],
    }));
    setDraft({ merchant: '', amount: '', direction: 'out', accountId: draft.accountId, category: 'Shopping', classification: 'Planned', date: todayIso });
  };
  const importCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseTransactionsCsv(await file.text(), selectedImportAccount);
      save((current) => {
        const existing = new Set(current.transactions.map(transactionKey));
        const fresh = imported.filter((tx) => !existing.has(transactionKey(tx)));
        setImportSummary(`Imported ${fresh.length} new transactions. Skipped ${imported.length - fresh.length} duplicates.`);
        return { ...current, transactions: [...current.transactions, ...fresh].sort((a, b) => a.date.localeCompare(b.date)) };
      });
    } catch (error) {
      setImportSummary(error instanceof Error ? error.message : 'CSV import failed');
    }
    event.target.value = '';
  };
  const importPdfs = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    try {
      setImportSummary(`Reading ${files.length} statement file${files.length === 1 ? '' : 's'}...`);
      const { parseLloydsStatementPdf } = await import('./integrations/lloydsPdf.js');
      const results = await Promise.all(files.map((file) => parseLloydsStatementPdf(file, selectedImportAccount)));
      const imported = results.flatMap((result) => result.transactions);
      if (!imported.length) {
        const diag = results.map((result) => result.diagnostics);
        const totalRows = diag.reduce((sum, d) => sum + d.rows, 0);
        const totalDated = diag.reduce((sum, d) => sum + d.datedRows, 0);
        setImportSummary(
          totalRows === 0
            ? 'No readable text found in these PDFs. They may be scanned images rather than text statements.'
            : `Read ${totalRows} lines (${totalDated} with a date) but matched 0 transactions. The statement layout may differ — use the converted CSV backup below.`
        );
        event.target.value = '';
        return;
      }
      save((current) => {
        const existing = new Set(current.transactions.map(transactionKey));
        const fresh = imported.filter((tx) => !existing.has(transactionKey(tx)));
        const moneyIn = fresh.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
        const moneyOut = Math.abs(fresh.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));
        setImportSummary(`Imported ${fresh.length} PDF transactions. In ${currency.format(moneyIn)}, out ${currency.format(moneyOut)}. Skipped ${imported.length - fresh.length} duplicates.`);
        return { ...current, transactions: [...current.transactions, ...fresh].sort((a, b) => a.date.localeCompare(b.date)) };
      });
    } catch (error) {
      setImportSummary(error instanceof Error ? `Statement import failed: ${error.message}` : 'Statement import failed');
    }
    event.target.value = '';
  };
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Transactions</h1>
        <p className="subtle">Correct categories and classifications so the plan learns from reality.</p>
      </section>
      <section className="card form">
        <label><span className="field-icon"><Search size={16} /> Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Merchant name" /></label>
        <div className="tabs">{['all', 'spend', 'bill', 'income', 'invest', ...categories.slice(1, 6)].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
      </section>
      <section className="card form">
        <h2>Import Lloyds history</h2>
        <p className="subtle">Choose the statement account, then import one or more monthly PDF statements. Converted CSV import is still available as a backup.</p>
        <label>Statement account<select value={selectedImportAccount} onChange={(event) => setSelectedImportAccount(event.target.value)}>
          {accountsFor(data).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>
        <label>PDF statements
          <input className="file-input" type="file" multiple accept=".pdf,application/pdf" onChange={importPdfs} />
        </label>
        <label>Converted CSV backup
          <input className="file-input" type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={importCsv} />
        </label>
        {importSummary && <p className="pill safe"><CheckCircle2 size={16} /> {importSummary}</p>}
      </section>
      <section className="card form">
        <h2>Add manual transaction</h2>
        <label>Merchant<input value={draft.merchant} onChange={(event) => setDraft({ ...draft, merchant: event.target.value })} placeholder="Merchant" /></label>
        <label>Account<select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
          {accountsFor(data).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>
        <div className="inline-fields">
          <label>Amount<input type="number" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
          <label>Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        </div>
        <div className="tabs segmented">
          <button className={draft.direction === 'out' ? 'active' : ''} onClick={() => setDraft({ ...draft, direction: 'out', category: draft.category === 'Income' ? 'Shopping' : draft.category })}>Money out</button>
          <button className={draft.direction === 'in' ? 'active' : ''} onClick={() => setDraft({ ...draft, direction: 'in', category: 'Income', classification: 'Essential' })}>Money in</button>
        </div>
        <div className="inline-fields">
          <label>Category<select value={draft.direction === 'in' ? 'Income' : draft.category} disabled={draft.direction === 'in'} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Classification<select value={draft.classification} onChange={(event) => setDraft({ ...draft, classification: event.target.value })}>{classifications.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <button className="primary-btn" onClick={addTx}><Plus size={18} /> Add transaction</button>
      </section>
      <section className="card">
        {list.slice().reverse().map((tx) => <TransactionEditor key={tx.id} tx={tx} data={data} updateTx={updateTx} />)}
      </section>
    </main>
  );
}

function TransactionEditor({ tx, data, updateTx }) {
  return (
    <div className="transaction-editor">
      <TransactionRow tx={tx} data={data} />
      {tx.amount < 0 && (
        <div className="inline-fields compact-fields">
          <select value={tx.category} onChange={(event) => updateTx(tx.id, { category: event.target.value })}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={tx.classification} onChange={(event) => updateTx(tx.id, { classification: event.target.value })}>{classifications.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
      )}
    </div>
  );
}

function SettingsPage({ data, save, reset, setActive, session, integrationStatus, setIntegrationStatus }) {
  const fileRef = useRef(null);
  const setProfile = (patch) => save((current) => ({ ...current, profile: { ...current.profile, ...patch } }));
  const updateAccount = (id, patch) => save((current) => ({
    ...current,
    accounts: accountsFor(current).map((account) => account.id === id ? { ...account, ...patch } : account),
  }));
  const updateRecurring = (id, patch) => save((current) => ({
    ...current,
    recurring: current.recurring.map((item) => item.id === id ? { ...item, ...patch } : item),
  }));
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `safespend-export-${todayIso}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    save(migrateData(JSON.parse(text)));
    event.target.value = '';
  };
  const runRemoteAction = async (action, successMessage) => {
    try {
      setIntegrationStatus('Syncing');
      const result = await action();
      setIntegrationStatus(successMessage);
      return result;
    } catch (error) {
      setIntegrationStatus(error instanceof Error ? error.message : 'Sync failed');
      return null;
    }
  };
  const startBankConnection = async () => {
    const result = await runRemoteAction(
      () => invokeFunction('gocardless-start', { redirect: window.location.origin }),
      'Bank consent ready'
    );
    if (result?.link) window.location.href = result.link;
  };
  const syncBanking = async () => {
    await runRemoteAction(async () => {
      await invokeFunction('gocardless-sync');
      const snapshot = await loadRemoteSnapshot();
      save((current) => mergeRemoteSnapshot(current, snapshot));
    }, 'Bank synced');
  };
  const syncTrading212 = async () => {
    await runRemoteAction(async () => {
      await invokeFunction('trading212-sync');
      const snapshot = await loadRemoteSnapshot();
      save((current) => mergeRemoteSnapshot(current, snapshot));
    }, 'Trading 212 synced');
  };
  return (
    <main className="stack">
      <section>
        <h1 className="h1">Settings and data</h1>
        <p className="subtle">Open Banking and Trading 212 calls run through Supabase Edge Functions so provider secrets stay out of the PWA.</p>
      </section>
      <AuthPanel session={session} integrationStatus={integrationStatus} setIntegrationStatus={setIntegrationStatus} />
      <section className="card">
        <Connection name="Lloyds / GoCardless Bank Account Data" connected={data.profile.bankConnected} onClick={session ? startBankConnection : () => setIntegrationStatus('Sign in first')} icon={Landmark} actionLabel="Connect" />
        <Connection name="Sync bank transactions" connected={data.profile.bankConnected} onClick={session ? syncBanking : () => setIntegrationStatus('Sign in first')} icon={RefreshCw} actionLabel="Sync" />
        <Connection name="Trading 212" connected={data.profile.trading212Connected} onClick={session ? syncTrading212 : () => setIntegrationStatus('Sign in first')} icon={TrendingUp} actionLabel="Sync" />
      </section>
      <section className="card form">
        <h2>Score and notification preferences</h2>
        <label className="toggle"><span>Calm notifications</span><input type="checkbox" checked={data.profile.notifications} onChange={(event) => setProfile({ notifications: event.target.checked })} /></label>
        <label>Savings target<input type="number" value={data.profile.savingsGoal} onChange={(event) => setProfile({ savingsGoal: Number(event.target.value) })} /></label>
        <label>Current savings<input type="number" value={data.profile.currentSavings} onChange={(event) => setProfile({ currentSavings: Number(event.target.value) })} /></label>
      </section>
      <section className="card form">
        <h2>Bank accounts</h2>
        {accountsFor(data).map((account) => (
          <div className="account-edit" key={account.id}>
            <label>Name<input value={account.name} onChange={(event) => updateAccount(account.id, { name: event.target.value })} /></label>
            <div className="inline-fields">
              <label>Purpose<select value={account.purpose} onChange={(event) => updateAccount(account.id, { purpose: event.target.value })}>
                <option value="personal">Personal</option>
                <option value="household">Household</option>
              </select></label>
              <label>Balance<input type="number" value={account.balance || 0} onChange={(event) => updateAccount(account.id, { balance: Number(event.target.value) })} /></label>
            </div>
            <label className="toggle"><span>Include in SafeSpend</span><input type="checkbox" checked={account.includeInSafeSpend !== false} onChange={(event) => updateAccount(account.id, { includeInSafeSpend: event.target.checked })} /></label>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="section-title"><h2>Recurring classifications</h2><SlidersHorizontal size={20} /></div>
        {data.recurring.map((item) => (
          <div className="recurring-edit" key={item.id}>
            <RecurringRow item={item} compact />
            <select value={item.status} onChange={(event) => updateRecurring(item.id, { status: event.target.value })}>
              {['Essential', 'Important to me', 'Could reduce', 'Want to cancel', 'Not sure', 'Ignore future suggestions'].map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>
        ))}
      </section>
      <section className="card form">
        <h2>Local data</h2>
        <input ref={fileRef} className="hidden-file" type="file" accept="application/json" onChange={importData} />
        <button className="secondary-btn" onClick={exportData}><Download size={18} /> Export data</button>
        <button className="secondary-btn" onClick={() => fileRef.current?.click()}><Upload size={18} /> Import data</button>
        <button className="secondary-btn" onClick={() => setActive('transactions')}><CreditCard size={18} /> Manual corrections</button>
        <button className="danger-btn" onClick={() => { if (window.confirm('Clear all local data and start from a blank slate?')) reset(); }}><RefreshCw size={18} /> Reset all data</button>
      </section>
      <p className="legal">Information and budgeting support only. This is not financial advice.</p>
    </main>
  );
}

function AuthPanel({ session, integrationStatus, setIntegrationStatus }) {
  const endSession = async () => {
    await signOut();
    setIntegrationStatus('Signed out');
  };
  if (!hasSupabaseConfig) {
    return (
      <section className="card">
        <h2>Supabase not configured</h2>
        <p className="subtle">Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your local `.env.local` or your Vercel project environment variables, then redeploy.</p>
      </section>
    );
  }
  return (
    <section className="card form">
      <div className="section-title">
        <h2>Supabase account</h2>
        <p className={session ? 'pill safe' : 'pill warn'}>{session ? 'Signed in' : 'Not signed in'}</p>
      </div>
      <p className="subtle">{session?.user?.email || 'Sign in from the login screen.'}</p>
      {session && <button className="secondary-btn" onClick={endSession}>Sign out</button>}
      <p className="meta">Status: {integrationStatus}</p>
    </section>
  );
}

function Connection({ name, connected, onClick, icon: Icon, actionLabel = 'Plan' }) {
  return (
    <div className="row">
      <div className="left">
        <div className="avatar"><Icon size={20} /></div>
        <div><p className="title">{name}</p><p className="meta">{connected ? 'Connected or synced' : 'Requires Supabase session'}</p></div>
      </div>
      <button className={connected ? 'secondary-btn small' : 'primary-btn small'} onClick={onClick}>{connected ? actionLabel : actionLabel}</button>
    </div>
  );
}

function RecurringRow({ item, compact }) {
  return (
    <div className={compact ? 'row compact-row' : 'row'}>
      <div className="left">
        <div className="avatar"><ReceiptText size={20} /></div>
        <div><p className="title">{item.merchant}</p><p className="meta">Next {item.nextDate} · {item.status}</p></div>
      </div>
      <strong>{currency.format(item.amount)}</strong>
    </div>
  );
}

function TransactionRow({ tx, data }) {
  const Icon = tx.type === 'income' ? Banknote : tx.type === 'invest' ? TrendingUp : CreditCard;
  return (
    <div className="row">
      <div className="left">
        <div className="avatar"><Icon size={20} /></div>
        <div><p className="title">{tx.merchant}</p><p className="meta">{accountName(data, tx.accountId)} · {tx.category} · {tx.classification} · {tx.date}</p></div>
      </div>
      <div className={`amount ${tx.amount < 0 ? 'negative' : 'positive'}`}>{currency.format(tx.amount)}</div>
    </div>
  );
}

function LoginScreen({ integrationStatus, setIntegrationStatus }) {
  const [email, setEmail] = useState('adamjcarr@proton.me');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const submit = async (event) => {
    event.preventDefault();
    if (!email || !password) {
      setIntegrationStatus('Enter email and password');
      return;
    }
    try {
      setIntegrationStatus(mode === 'signin' ? 'Signing in' : 'Creating account');
      if (mode === 'signin') {
        const result = await signInWithPassword(email, password);
        setIntegrationStatus(result.session ? 'Signed in' : 'Sign in needs confirmation');
      } else {
        const result = await signUpWithPassword(email, password);
        if (result.session) {
          setIntegrationStatus('Signed in');
        } else {
          setMode('signin');
          setIntegrationStatus('Account created. Confirm the user in Supabase, then sign in.');
        }
      }
    } catch (error) {
      setIntegrationStatus(error instanceof Error ? error.message : 'Authentication failed');
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand login-brand"><WalletCards size={30} /> SafeSpend</div>
        <h1>Sign in</h1>
        <p className="subtle">Your money plan stays private behind your Supabase account.</p>
        {!hasSupabaseConfig && (
          <p className="pill wait"><AlertTriangle size={16} /> Supabase is not configured for this build</p>
        )}
        <form className="form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
          <button className="primary-btn" type="submit" disabled={!hasSupabaseConfig}>{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="text-btn login-switch" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create this account instead' : 'I already have this account'}
        </button>
        {mode === 'signup' && <p className="meta">If Supabase email confirmations are enabled, confirm this user in the Supabase dashboard before signing in.</p>}
        <p className="meta">Status: {integrationStatus}</p>
      </section>
    </main>
  );
}

function App() {
  const [active, setActive] = useState('home');
  const [data, save, reset] = useStoredState();
  const [session, setSession] = useState(null);
  const [integrationStatus, setIntegrationStatus] = useState(hasSupabaseConfig ? 'Supabase ready' : 'Local PWA');
  const stats = useMemo(() => derive(data), [data]);
  useEffect(() => {
    let mounted = true;
    getSession().then((currentSession) => {
      if (mounted) {
        setSession(currentSession);
        setIntegrationStatus(currentSession ? 'Signed in' : hasSupabaseConfig ? 'Supabase ready' : 'Local PWA');
      }
    }).catch((error) => setIntegrationStatus(error instanceof Error ? error.message : 'Auth check failed'));

    const { data: subscription } = supabase?.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setIntegrationStatus(currentSession ? 'Signed in' : hasSupabaseConfig ? 'Supabase ready' : 'Local PWA');
    }) || { data: null };

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [active]);

  if (!session) {
    return <LoginScreen integrationStatus={integrationStatus} setIntegrationStatus={setIntegrationStatus} />;
  }

  return (
    <div className="app-shell">
      <Header setActive={setActive} integrationStatus={integrationStatus} />
      {active === 'home' && <HomePage data={data} stats={stats} setActive={setActive} />}
      {active === 'plan' && <PlanPage data={data} save={save} stats={stats} setActive={setActive} />}
      {active === 'buy' && <BuyCheck data={data} save={save} stats={stats} />}
      {active === 'score' && <ScorePage data={data} stats={stats} setActive={setActive} />}
      {active === 'opportunities' && <OpportunitiesPage data={data} save={save} />}
      {active === 'transactions' && <TransactionsPage data={data} save={save} />}
      {active === 'recovery' && <RecoveryPage data={data} save={save} stats={stats} />}
      {active === 'settings' && <SettingsPage data={data} save={save} reset={reset} setActive={setActive} session={session} integrationStatus={integrationStatus} setIntegrationStatus={setIntegrationStatus} />}
      <BottomNav active={active} setActive={setActive} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => ('caches' in window ? caches.keys() : []))
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => {});
  });
}
