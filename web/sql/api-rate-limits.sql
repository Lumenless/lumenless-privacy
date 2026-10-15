begin;
create table if not exists public.api_rate_limits (
  bucket_key text primary key check (length(bucket_key) = 64),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  hits integer not null
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;
create index if not exists api_rate_limits_expiry on public.api_rate_limits(expires_at);
create or replace function public.consume_api_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t timestamptz := clock_timestamp(); r public.api_rate_limits%rowtype;
begin
  if length(p_key) <> 64 or p_limit < 1 or p_limit > 10000 or p_seconds < 1 or p_seconds > 86400 then
    raise exception 'Invalid limiter configuration';
  end if;
  insert into public.api_rate_limits as b(bucket_key, window_started_at, expires_at, hits)
  values(p_key, t, t + make_interval(secs => p_seconds), 1)
  on conflict(bucket_key) do update set
    hits = case when b.expires_at <= t then 1 else least(b.hits + 1, p_limit + 1) end,
    window_started_at = case when b.expires_at <= t then t else b.window_started_at end,
    expires_at = case when b.expires_at <= t then t + make_interval(secs => p_seconds) else b.expires_at end
  returning * into r;
  return jsonb_build_object('allowed', r.hits <= p_limit, 'retryAfter', greatest(1, ceil(extract(epoch from r.expires_at - t))::integer));
end;
$$;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
create or replace function public.prune_api_rate_limits()
returns void language sql security invoker set search_path = '' as $$
  delete from public.api_rate_limits where bucket_key in
  (select bucket_key from public.api_rate_limits where expires_at < now() - interval '1 hour' order by expires_at limit 10000);
$$;
revoke all on function public.prune_api_rate_limits() from public, anon, authenticated;
grant execute on function public.prune_api_rate_limits() to service_role;
commit;
