-- Additive upgrade: preserves existing @lumenless orders and credentials.
begin;
create table if not exists public.business_x_accounts (
  x_user_id text primary key check (x_user_id ~ '^[0-9]+$'),
  username text not null unique check (username ~ '^[a-z0-9_]{1,15}$'),
  name text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  lock_until timestamptz not null default '1970-01-01',
  updated_at timestamptz not null default now()
);
alter table public.business_x_accounts enable row level security;
revoke all on public.business_x_accounts from public, anon, authenticated;
grant select, insert, update on public.business_x_accounts to service_role;
alter table public.tweet_orders add column if not exists target_x_user_id text references public.business_x_accounts(x_user_id);
alter table public.tweet_orders add column if not exists target_username text not null default 'lumenless';
create index if not exists tweet_orders_account_queue on public.tweet_orders(target_x_user_id, status, created_at);
-- Existing orders without a target ID are legacy @lumenless orders. New orders use immutable X IDs.
commit;
