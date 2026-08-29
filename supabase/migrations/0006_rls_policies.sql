-- ============================================================================
-- 0006_rls_policies.sql
-- Row Level Security for every table. Default-deny: RLS is enabled and only
-- the policies below grant anything. Service-role callers (edge functions)
-- bypass RLS entirely, by design — that's how the admin/rate-limit/logging
-- paths work without needing bespoke policies for every internal operation.
-- ============================================================================

alter table public.authorized_users enable row level security;
alter table public.profiles         enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;
alter table public.attachments      enable row level security;
alter table public.usage_logs       enable row level security;
alter table public.system_logs      enable row level security;

-- ---------------------------------------------------------------------------
-- authorized_users: no client policies at all. Only admins can even SELECT,
-- and only through the admin-users edge function (service role). This keeps
-- the allowlist itself invisible to regular users.
-- ---------------------------------------------------------------------------
create policy "admins can read authorized_users"
  on public.authorized_users for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "users can read own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "admins can read all profiles"
  on public.profiles for select
  using (public.is_admin());

-- Users may update their own display_name/avatar_url. role changes are
-- blocked regardless of this policy by the prevent_role_self_change trigger.
create policy "users can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- profiles rows are only ever inserted by handle_new_user() (security
-- definer, runs as postgres), so no insert policy is needed for clients.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create policy "users can read own conversations"
  on public.conversations for select
  using (user_id = auth.uid());

create policy "users can insert own conversations"
  on public.conversations for insert
  with check (user_id = auth.uid());

create policy "users can update own conversations"
  on public.conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can delete own conversations"
  on public.conversations for delete
  using (user_id = auth.uid());

create policy "admins can read all conversations"
  on public.conversations for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create policy "users can read own messages"
  on public.messages for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "users can insert own messages"
  on public.messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- Messages are immutable and only deletable by cascading a conversation
-- delete — no update/delete policy for individual messages.

create policy "admins can read all messages"
  on public.messages for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create policy "users can read own attachments"
  on public.attachments for select
  using (user_id = auth.uid());

create policy "users can insert own attachments"
  on public.attachments for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "users can delete own attachments"
  on public.attachments for delete
  using (user_id = auth.uid());

create policy "admins can read all attachments"
  on public.attachments for select
  using (public.is_admin());

-- attachments.status/extracted_text are updated by the process-file edge
-- function using the service role, which bypasses RLS — no client update
-- policy is granted, so a user can never fake "ready" status or inject text.

-- ---------------------------------------------------------------------------
-- usage_logs / system_logs: admin read-only. All writes are service-role
-- (edge functions), which bypass RLS, so no insert policy is defined here.
-- ---------------------------------------------------------------------------
create policy "admins can read usage_logs"
  on public.usage_logs for select
  using (public.is_admin());

create policy "admins can read system_logs"
  on public.system_logs for select
  using (public.is_admin());
