begin;
alter table public.business_x_accounts add column if not exists tweet_price text not null default '1000000';
alter table public.business_x_accounts add column if not exists thread_price text not null default '3000000';
alter table public.business_x_accounts add column if not exists payment_asset text not null default 'SPL';
alter table public.business_x_accounts add column if not exists payment_mint text default '6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM';
alter table public.business_x_accounts add column if not exists payment_symbol text not null default 'LUMEN';
alter table public.business_x_accounts add column if not exists payment_decimals integer not null default 6;
alter table public.business_x_accounts add column if not exists payment_recipient text not null default 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb';
-- Remove the original fixed-price checks, keeping thread-length validation separately.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.tweet_orders'::regclass and contype='c' and pg_get_constraintdef(oid) like '%amount_tokens%'
 loop execute format('alter table public.tweet_orders drop constraint %I',c.conname); end loop;
end $$;
alter table public.tweet_orders alter column amount_tokens type numeric using amount_tokens::numeric;
alter table public.tweet_orders add column if not exists payment_asset text;
alter table public.tweet_orders add column if not exists payment_mint text;
alter table public.tweet_orders add column if not exists payment_symbol text;
alter table public.tweet_orders add column if not exists payment_decimals integer;
alter table public.tweet_orders add column if not exists payment_recipient text;
alter table public.tweet_orders add column if not exists payment_amount text;
alter table public.tweet_orders add column if not exists payment_amount_atomic text;
-- Old rows remain legacy LUMEN orders and retain their original terms.
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.tweet_orders'::regclass and conname='tweet_orders_positive_amount') then
 alter table public.tweet_orders add constraint tweet_orders_positive_amount check(amount_tokens > 0);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.tweet_orders'::regclass and conname='tweet_orders_thread_length') then
 alter table public.tweet_orders add constraint tweet_orders_thread_length check((kind='tweet' and jsonb_array_length(tweets)=1) or (kind='thread' and jsonb_array_length(tweets) between 2 and 5));
 end if;
end $$;
commit;
