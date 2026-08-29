import { supabase } from './supabase';
import type { Attachment } from '@/types';

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/quicktime', // .mov
];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Uploads a file to the private bucket and creates its attachments row, then
 * kicks off server-side validation/extraction. The returned attachment's
 * `status` will be 'uploaded' — callers should watch for it to become
 * 'ready' (or 'error') before letting the user send the message, since only
 * a 'ready' attachment is ever included in a chat request.
 */
export async function uploadFile(
  conversationId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Attachment> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Файлът е твърде голям (максимум ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
  }

  const attachmentId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${user.id}/${conversationId}/${attachmentId}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from('hah-files').upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) throw uploadError;
  onProgress?.(60);

  const { data: attachment, error: insertError } = await supabase
    .from('attachments')
    .insert({
      id: attachmentId,
      conversation_id: conversationId,
      user_id: user.id,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      storage_path: storagePath,
      size: file.size,
      status: 'uploaded',
    })
    .select('*')
    .single();
  if (insertError) throw insertError;
  onProgress?.(80);

  // Server-side validation + text extraction. This call's result is best
  // used to update local state, but the authoritative status lives on the
  // row — see waitForAttachmentReady below.
  const { error: fnError } = await supabase.functions.invoke('process-file', {
    body: { attachmentId },
  });
  onProgress?.(100);
  if (fnError) {
    // Not fatal here — the attachment row will carry status: 'error' and
    // the UI shows that; we don't need to throw and lose the attachment.
    console.error('process-file invoke error', fnError);
  }

  return attachment;
}

export async function waitForAttachmentReady(attachmentId: string, timeoutMs = 30_000): Promise<Attachment> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase.from('attachments').select('*').eq('id', attachmentId).single();
    if (error) throw error;
    if (data.status === 'ready' || data.status === 'error') return data;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error('Изтекло време за обработка на файла.');
}

export async function removeAttachment(attachment: Attachment): Promise<void> {
  await supabase.storage.from('hah-files').remove([attachment.storage_path]);
  await supabase.from('attachments').delete().eq('id', attachment.id);
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('hah-files').createSignedUrl(storagePath, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
