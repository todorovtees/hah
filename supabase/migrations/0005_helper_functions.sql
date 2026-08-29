-- ============================================================================
-- 0005_helper_functions.sql
-- Security-definer helpers used by RLS policies, plus the trigger that stops
-- anyone from promoting themselves to admin through a normal client update.
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True if the currently authenticated user has role = admin. security definer so it can read profiles even under a caller whose own RLS select policy would otherwise not (self-)recurse safely.';

-- Blocks any change to profiles.role that does not come from the service
-- role (i.e. from an edge function). This applies even to admins acting
-- through the normal client — role changes go through the admin-users edge
-- function, which uses the service role key and is itself gated on the
-- caller already being an admin. See section 10 of the spec: "Административните
-- операции трябва да се изпълняват server-side."
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.role() <> 'service_role' then
    raise exception 'role can only be changed by a server-side admin operation';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_role_self_change on public.profiles;
create trigger prevent_role_self_change
  before update on public.profiles
  for each row execute function public.prevent_role_self_change();

-- Same protection on authorized_users.role and .is_active, plus it blocks
-- ALL client writes to that table (RLS below has no insert/update/delete
-- policy for it at all — this trigger is belt-and-braces in case a future
-- migration adds one carelessly).
create or replace function public.prevent_authorized_users_client_write()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'authorized_users can only be modified by a server-side admin operation';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_authorized_users_client_write on public.authorized_users;
create trigger prevent_authorized_users_client_write
  before insert or update or delete on public.authorized_users
  for each row execute function public.prevent_authorized_users_client_write();
