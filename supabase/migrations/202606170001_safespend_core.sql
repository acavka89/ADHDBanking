create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  timezone text not null default 'Europe/London',
  currency text not null default 'GBP',
  onboarding_complete boolean not null default false,
  monthly_income numeric(12, 2) not null default 0,
  next_payday date,
  expected_food_travel numeric(12, 2) not null default 0,
  debt_minimums numeric(12, 2) not null default 0,
  emergency_buffer numeric(12, 2) not null default 0,
  forgotten_cost_buffer numeric(12, 2) not null default 0,
  savings_goal numeric(12, 2) not null default 0,
  current_savings numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  institution_id text,
  requisition_id text,
  connection_status text not null default 'created',
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider, requisition_id)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_connection_id uuid references public.bank_connections(id) on delete set null,
  external_account_id text,
  account_name text not null,
  account_type text,
  current_balance numeric(12, 2) not null default 0,
  available_balance numeric(12, 2) not null default 0,
  currency text not null default 'GBP',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, external_account_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  external_transaction_id text,
  merchant_name text not null,
  merchant_group text,
  amount numeric(12, 2) not null,
  transaction_date date not null,
  category text not null default 'Other',
  user_classification text not null default 'Planned',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, account_id, external_transaction_id)
);

create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  merchant_name text not null,
  average_amount numeric(12, 2) not null,
  frequency text not null default 'monthly',
  next_expected_date date,
  essential_status text not null default 'Not sure',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pay_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  income_received numeric(12, 2) not null default 0,
  protected_amount numeric(12, 2) not null default 0,
  flexible_amount numeric(12, 2) not null default 0,
  daily_allowance numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_allocations (
  id uuid primary key default gen_random_uuid(),
  pay_cycle_id uuid not null references public.pay_cycles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  allocation_type text not null,
  planned_amount numeric(12, 2) not null default 0,
  spent_amount numeric(12, 2) not null default 0,
  protected boolean not null default false
);

create table if not exists public.saving_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_type text not null,
  merchant_name text not null,
  estimated_monthly_saving numeric(12, 2) not null default 0,
  confidence_score integer not null default 50,
  user_response text not null default 'Not reviewed',
  created_at timestamptz not null default now()
);

create table if not exists public.safespend_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  score_date date not null,
  total_score integer not null,
  components jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, score_date)
);

create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  score_change integer not null,
  reason text not null,
  related_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'trading212',
  account_name text not null default 'Trading 212',
  currency text not null default 'GBP',
  cash_balance numeric(12, 2) not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider, account_name)
);

create table if not exists public.investment_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  investment_account_id uuid references public.investment_accounts(id) on delete cascade,
  ticker text not null,
  quantity numeric(18, 6) not null default 0,
  average_price numeric(18, 6),
  current_price numeric(18, 6),
  pnl numeric(12, 2),
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, investment_account_id, ticker)
);

alter table public.profiles enable row level security;
alter table public.bank_connections enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.pay_cycles enable row level security;
alter table public.plan_allocations enable row level security;
alter table public.saving_opportunities enable row level security;
alter table public.safespend_scores enable row level security;
alter table public.score_events enable row level security;
alter table public.investment_accounts enable row level security;
alter table public.investment_positions enable row level security;

create policy "profiles are owned by user" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "bank connections are owned by user" on public.bank_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "accounts are owned by user" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions are owned by user" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recurring payments are owned by user" on public.recurring_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "pay cycles are owned by user" on public.pay_cycles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plan allocations are owned by user" on public.plan_allocations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saving opportunities are owned by user" on public.saving_opportunities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "safespend scores are owned by user" on public.safespend_scores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "score events are owned by user" on public.score_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "investment accounts are owned by user" on public.investment_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "investment positions are owned by user" on public.investment_positions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
