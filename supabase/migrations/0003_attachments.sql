-- ============================================================================
-- 0003_attachments.sql
-- ============================================================================

create table if not exists public.attachments (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      uuid references public.messages (id) on delete set null,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  filename        text not null,
  mime_type       text not null,
  storage_path    text not null unique,
  size            bigint not null check (size >= 0),
  extracted_text  text,
  status          text not null default 'uploaded'
                    check (status in ('uploaded', 'processing', 'ready', 'error')),
  error_message   text,
  created_at      timestamptz not null default now()
);

create index if not exists attachments_conversation_id_idx
  on public.attachments (conversation_id);

create index if not exists attachments_user_id_idx
  on public.attachments (user_id);

comment on column public.attachments.storage_path is
  'Path inside the private hah-files bucket: {user_id}/{conversation_id}/{attachment_id}-{filename}';

comment on column public.attachments.extracted_text is
  'Server-extracted text for formats Gemini cannot read natively (docx/xlsx/pptx/csv/txt). Null for images/pdf/audio/video, which are sent to the model as native file parts instead.';
