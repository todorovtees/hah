-- ============================================================================
-- 0008_rate_limit_function.sql
-- Called by edge functions (service role) before doing any real work, so the
-- limit is enforced centrally in the DB rather than duplicated/guessable in
-- each function's inlined rate-limit helper (see supabase/functions/*/index.ts).
-- ============================================================================

create or replace function public.count_recent_usage(
  p_user_id uuid,
  p_request_type text,
  p_window_seconds integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.usage_logs
  where user_id = p_user_id
    and request_type = p_request_type
    and created_at > now() - make_interval(secs => p_window_seconds)
    and status <> 'rate_limited';
$$;

comment on function public.count_recent_usage is
  'Requests by this user for this request_type in the last N seconds. Used for sliding-window rate limiting.';
