-- ============================================================
-- LuBisMe — Supabase schema
-- Run this in the Supabase SQL editor on a fresh project.
-- Assumes Supabase Auth is used for login (auth.users table
-- already exists and is managed by Supabase).
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles
--    One row per user. Extends auth.users with app-specific data.
--    is_premium / plan mirrors subscription status for fast reads
--    (source of truth for billing itself lives in `subscriptions`).
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  bio text,
  avatar_url text,
  slug text unique not null,               -- e.g. 'tobi-8f3k' or 'tobi' (premium)
  is_premium_slug boolean not null default false,
  plan text not null default 'free' check (plan in ('free','regular','premium')),
  plan_status text not null default 'inactive' check (plan_status in ('inactive','active','past_due','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_slug_idx on public.profiles (slug);

alter table public.profiles enable row level security;

-- Anyone (including anonymous fans) can view a profile — this is
-- what makes the public gift page work without login.
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

-- Users can only edit their own profile row.
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- No delete policy on purpose — deletion should go through a
-- server-side/admin path, not be exposed directly to clients.


-- ------------------------------------------------------------
-- 2. wallet_addresses
--    One row per chain per user. Publicly readable (that's the
--    whole point — fans need to see them) but only the owner
--    can write.
-- ------------------------------------------------------------
create table public.wallet_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chain text not null check (chain in ('BTC','ETH','SOL','USDT')),
  network text,                              -- e.g. 'TRC-20' / 'ERC-20', mainly for USDT
  address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, chain)                    -- one address per chain per user
);

alter table public.wallet_addresses enable row level security;

create policy "wallets are publicly readable"
  on public.wallet_addresses for select
  using (true);

create policy "users can insert own wallets"
  on public.wallet_addresses for insert
  with check (auth.uid() = user_id);

create policy "users can update own wallets"
  on public.wallet_addresses for update
  using (auth.uid() = user_id);

create policy "users can delete own wallets"
  on public.wallet_addresses for delete
  using (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 3. subscriptions
--    Source of truth for billing. Written only by the backend
--    (via Paystack webhook handler using the service role key),
--    never directly by the client — hence no insert/update
--    policy for regular users at all.
-- ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('regular','premium')),
  paystack_customer_code text,
  paystack_subscription_code text,
  paystack_reference text,
  status text not null default 'active' check (status in ('active','past_due','cancelled')),
  amount_kobo integer not null,              -- 350000 = ₦3,500 ; 850000 = ₦8,500
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Users can see their own billing history, nothing else.
create policy "users can view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Deliberately no insert/update/delete policy for the anon/authenticated
-- role. All writes happen server-side with the service role key from
-- the Paystack webhook handler — this is what stops a user from
-- forging their own "active premium" row.


-- ------------------------------------------------------------
-- 4. slug reservation helper
--    Prevents two users racing to grab the same premium slug.
--    Enforced at the DB level via the unique constraint on
--    profiles.slug above; this function just gives the frontend
--    a clean way to check availability before attempting a write.
-- ------------------------------------------------------------
create or replace function public.is_slug_available(check_slug text)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from public.profiles where slug = check_slug
  );
$$;

-- Let anyone call this (it's read-only and just returns a boolean).
grant execute on function public.is_slug_available(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 5. updated_at trigger (keeps updated_at fresh on every UPDATE)
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.wallet_addresses
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
