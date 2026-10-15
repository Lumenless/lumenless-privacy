begin;
alter table public.tweet_orders add column if not exists paid_at timestamptz;
alter table public.tweet_orders add column if not exists refund_reason text check (refund_reason in ('review_timeout'));
alter table public.tweet_orders add column if not exists refund_requested_at timestamptz;
-- Historical review queues have no trustworthy payment-confirmation timestamp.
-- Give them a full 72-hour window from this upgrade, never from order creation.
update public.tweet_orders set paid_at = clock_timestamp()
where status = 'pending_review' and payment_signature is not null and escrow_account_id is not null and paid_at is null;

create or replace function public.claim_review_timeout_refund(p_order_id uuid, p_wallet text)
returns setof public.tweet_orders language sql security invoker set search_path = '' as $$
  update public.tweet_orders set status = 'refund_pending', refund_reason = 'review_timeout',
    refund_requested_at = clock_timestamp(), updated_at = clock_timestamp(),
    review_note = 'Buyer requested a full refund after 72 hours without a moderation decision.'
  where id = p_order_id and wallet = p_wallet and status = 'pending_review'
    and payment_signature is not null and escrow_account_id is not null
    and paid_at <= clock_timestamp() - interval '72 hours'
    and accepted_at is null and published_ids = '[]'::jsonb
    and settlement_signature is null and settled_at is null
  returning *;
$$;
revoke all on function public.claim_review_timeout_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_review_timeout_refund(uuid, text) to service_role;
commit;
