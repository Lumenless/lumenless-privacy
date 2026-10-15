begin;
alter table public.business_x_accounts add column if not exists paid_partnership boolean not null default true;
-- Snapshot once publication starts so retries/threads retain a consistent disclosure.
alter table public.tweet_orders add column if not exists paid_partnership boolean;
commit;
