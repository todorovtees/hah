-- ============================================================================
-- 0004_usage_system_logs.sql
-- Append-only logs. Written exclusively by edge functions using the service
-- role key (see supabase/functions/_shared) — never directly by clients.
-- ============================================================================

create table if not exists public.usage_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles (id) on delete set null,
  request_type text not null,              -- 'chat' | 'search' | 'process-file'
  model        text,
  input_size   integer,
  output_size  integer,
  duration_ms  integer,
  status       text not null,              -- 'success' | 'error' | 'rate_limited'
  error_code   text,
  created_at   timestamptz not null default now()
);

create index if not exists usage_logs_user_id_created_at_idx
  on public.usage_logs (user_id, created_at desc);

create index if not exists usage_logs_created_at_idx
  on public.usage_logs (created_at desc);

create table if not exists public.system_logs (
  id         bigint generated always as identity primary key,
  level      text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  source     text not null,
  message    text not null,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_logs_created_at_idx
  on public.system_logs (created_at desc);

comment on table public.usage_logs is
  'One row per model/search/file-processing request. Used for the admin dashboard and rate limiting. Never store raw prompt/response content here.';
comment on table public.system_logs is
  'Structured server-side error/event log for admins. Never store secrets or full request bodies here.';
