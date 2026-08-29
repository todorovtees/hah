-- ============================================================================
-- 0007_storage.sql
-- Private bucket for uploaded files + RLS on storage.objects. Files are
-- stored at {user_id}/{conversation_id}/{attachment_id}-{filename}, so a
-- user's own uid must be the first path segment for these policies to grant
-- access, and download always goes through a short-lived signed URL rather
-- than a public one (see src/lib/files.ts).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('hah-files', 'hah-files', false, 26214400) -- 25 MB default cap
on conflict (id) do update set public = false, file_size_limit = 26214400;

create policy "users can read own files"
  on storage.objects for select
  using (
    bucket_id = 'hah-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can upload own files"
  on storage.objects for insert
  with check (
    bucket_id = 'hah-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'hah-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins can read all files"
  on storage.objects for select
  using (
    bucket_id = 'hah-files'
    and public.is_admin()
  );
