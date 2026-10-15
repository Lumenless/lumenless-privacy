-- Run once in the intended Supabase project's SQL editor. No public order/media access.
create table if not exists public.tweet_orders (
  id uuid primary key,
  wallet text not null,
  kind text not null check (kind in ('tweet', 'thread')),
  tweets jsonb not null,
  email text,
  telegram text,
  amount_tokens integer not null check (amount_tokens in (1000000, 3000000)),
  token_hash text not null,
  request_nonce uuid not null unique,
  status text not null default 'awaiting_payment' check (status in
    ('awaiting_payment', 'pending_review', 'approved', 'publishing', 'publish_failed', 'publish_uncertain', 'published', 'rejected', 'refund_pending', 'refunded')),
  payment_signature text unique,
  refund_signature text unique,
  review_note text,
  published_url text,
  notification_sent_at timestamptz,
  published_ids jsonb not null default '[]',
  x_media jsonb not null default '{}',
  publish_attempt integer,
  publish_error text,
  payment_message_hash text,
  refund_message_hash text,
  payment_signed_signature text,
  refund_signed_signature text,
  payment_last_valid_height bigint,
  refund_last_valid_height bigint,
  swap_request_id text,
  swap_message_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'tweet' and amount_tokens = 1000000 and jsonb_array_length(tweets) = 1)
    or (kind = 'thread' and amount_tokens = 3000000 and jsonb_array_length(tweets) between 2 and 5))
);
alter table public.tweet_orders enable row level security;
revoke all on public.tweet_orders from anon, authenticated;
grant select, insert, update, delete on public.tweet_orders to service_role;
create index if not exists tweet_orders_queue on public.tweet_orders (status, created_at);
create index if not exists tweet_orders_wallet on public.tweet_orders (wallet, created_at);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tweet-order-media', 'tweet-order-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;
-- No storage policies: only the server and short-lived signed URLs can access files.
create table if not exists public.tweet_x_credentials (
  id integer primary key check (id = 1),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  lock_until timestamptz not null default '1970-01-01'
);
alter table public.tweet_x_credentials enable row level security;
revoke all on public.tweet_x_credentials from anon, authenticated;
grant select, insert, update on public.tweet_x_credentials to service_role;
