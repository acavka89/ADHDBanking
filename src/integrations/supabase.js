import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithPassword(email, password) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function invokeFunction(name, body = {}) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadRemoteSnapshot() {
  if (!supabase) throw new Error('Supabase is not configured');
  const [profile, accounts, transactions, recurring, opportunities, investmentAccounts, positions] = await Promise.all([
    supabase.from('profiles').select('*').single(),
    supabase.from('accounts').select('*').order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').order('transaction_date', { ascending: true }),
    supabase.from('recurring_payments').select('*').order('next_expected_date', { ascending: true }),
    supabase.from('saving_opportunities').select('*').order('created_at', { ascending: false }),
    supabase.from('investment_accounts').select('*').order('last_synced_at', { ascending: false }),
    supabase.from('investment_positions').select('*').order('ticker', { ascending: true }),
  ]);

  for (const result of [profile, accounts, transactions, recurring, opportunities, investmentAccounts, positions]) {
    if (result.error) throw result.error;
  }

  return {
    profile: profile.data,
    accounts: accounts.data || [],
    transactions: transactions.data || [],
    recurring: recurring.data || [],
    opportunities: opportunities.data || [],
    investmentAccounts: investmentAccounts.data || [],
    positions: positions.data || [],
  };
}
