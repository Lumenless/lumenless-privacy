begin;
alter table public.business_x_accounts add column if not exists payout_wallet text;
alter table public.business_x_accounts add column if not exists escrow_address text unique;
alter table public.business_x_accounts add column if not exists escrow_secret text;
alter table public.tweet_orders add column if not exists escrow_account_id text references public.business_x_accounts(x_user_id);
alter table public.tweet_orders add column if not exists accepted_at timestamptz;
alter table public.tweet_orders add column if not exists platform_fee_bps integer not null default 1000 check(platform_fee_bps = 1000);
alter table public.tweet_orders add column if not exists settlement_kind text check(settlement_kind in ('payout','refund'));
alter table public.tweet_orders add column if not exists settlement_message_hash text;
alter table public.tweet_orders add column if not exists settlement_last_valid_height bigint;
alter table public.tweet_orders add column if not exists settlement_signature text unique;
alter table public.tweet_orders add column if not exists settlement_raw text;
alter table public.tweet_orders add column if not exists settled_at timestamptz;
alter table public.tweet_orders add column if not exists settlement_recipient text;
commit;
-- The release clock starts only after the entire tweet/thread was successfully published.
alter table public.tweet_orders add column if not exists published_at timestamptz;
