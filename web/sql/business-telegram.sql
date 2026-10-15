begin;
create table if not exists public.business_telegram (
  x_user_id text primary key references public.business_x_accounts(x_user_id) on delete cascade,
  chat_id text,
  telegram_username text,
  connected_at timestamptz,
  link_hash text unique,
  link_expires_at timestamptz
);
alter table public.business_telegram enable row level security;
revoke all on public.business_telegram from public, anon, authenticated;
grant select, insert, update, delete on public.business_telegram to service_role;
-- Do not send historical orders to newly connected Telegram accounts.
alter table public.tweet_orders add column if not exists owner_notification_done boolean not null default true;
alter table public.tweet_orders alter column owner_notification_done set default false;

create or replace function public.connect_business_telegram(p_hash text, p_chat text, p_username text)
returns table(x_user_id text) language sql security invoker set search_path = '' as $$
  update public.business_telegram set chat_id = p_chat, telegram_username = p_username,
    connected_at = clock_timestamp(), link_hash = null, link_expires_at = null
  where link_hash = p_hash and link_expires_at > clock_timestamp()
    and p_chat ~ '^[1-9][0-9]{0,15}$'
  returning business_telegram.x_user_id;
$$;
revoke all on function public.connect_business_telegram(text,text,text) from public, anon, authenticated;
grant execute on function public.connect_business_telegram(text,text,text) to service_role;
commit;
