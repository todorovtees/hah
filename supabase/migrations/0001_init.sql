-- ============================================================================
-- 0001_init.sql
-- Extensions, the allowlist table, the public profile table, and the
-- trigger that wires Supabase Auth signups to both of them.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- authorized_users: the allowlist. An email must have an active row here
-- before that person is allowed to use HAH at all. This table is managed by
-- admins only (see RLS in 0005 and the admin-users edge function).
-- ----------------------------------------------------------------------------
create table if not exists public.authorized_users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  display_name text,
  role         text not null default 'user' check (role in ('admin', 'user')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.authorized_users is
  'Allowlist of emails permitted to sign in to HAH. Managed by admins server-side only.';

-- ----------------------------------------------------------------------------
-- profiles: one row per Supabase Auth user, created automatically on signup.
-- role is duplicated here (denormalized from authorized_users at signup time)
-- so RLS policies and the app can check it without an extra join, and so a
-- later change to authorized_users.role doesn't retroactively change a
-- profile until an admin explicitly re-syncs it via the admin function.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'user' check (role in ('admin', 'user')),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile mirroring auth.users, created by handle_new_user(). role is authoritative for app authorization.';

-- ----------------------------------------------------------------------------
-- updated_at helper, reused by every table below that has the column.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.authorized_users;
create trigger set_updated_at
  before update on public.authorized_users
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- handle_new_user: fires after Supabase Auth creates a row in auth.users
-- (i.e. after an admin invites someone, or after a direct sign-up if that is
-- ever re-enabled). Public self-signup is disabled in Auth settings — see
-- README — so in normal operation the only path here is an admin invite.
--
-- Enforces the allowlist as defense in depth: if the email is not present in
-- authorized_users, or is present but inactive, the profile is NOT created,
-- which leaves the account unable to use the app (every RLS policy keys off
-- a row existing in profiles). We intentionally do NOT raise an exception
-- here, because that would abort the auth.users insert transaction itself
-- and could leave Supabase Auth in a confusing state for an admin operating
-- from the dashboard; "no profile row" is a clean, checkable rejection.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allow record;
begin
  select role, is_active, display_name
    into allow
    from public.authorized_users
    where lower(email) = lower(new.email)
    limit 1;

  if allow is null or allow.is_active is not true then
    insert into public.system_logs (level, source, message, metadata)
    values (
      'warn',
      'handle_new_user',
      'Rejected signup for non-allowlisted or inactive email',
      jsonb_build_object('email', new.email, 'user_id', new.id)
    );
    return new;
  end if;

  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(allow.display_name, split_part(new.email, '@', 1)),
    allow.role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- system_logs is created in 0004, but the function above references it and
-- migrations run in order, so table creation must happen before this trigger
-- can ever fire (not before it's defined). We still create the trigger here
-- and rely on 0004 running immediately after, before any real signups occur.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
