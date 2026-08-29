// POST /functions/v1/process-file
// Body: { attachmentId: string }
//
// The client uploads bytes directly to the private `hah-files` bucket (fast,
// standard Supabase practice — RLS on storage.objects already restricts the
// destination path to the caller's own user_id) and creates the matching
// `attachments` row itself via the normal RLS-governed insert. This function
// is the server-side gate the spec requires before a file is ever usable:
// it re-reads the bytes with the service role, sniffs the real content type
// from magic bytes (never trusting the client-declared mime_type), rejects
// anything disallowed or mismatched (deleting the object from storage), and
// for formats Gemini can't read natively (docx/xlsx/pptx/csv/txt) extracts
// text server-side so the chat function has something to send the model.
// Nothing is usable in chat until this sets status = 'ready'.

import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser, AuthError } from '../_shared/auth.ts';
import { enforceRateLimit, RateLimitError } from '../_shared/rateLimit.ts';
import { logUsage, logSystemError } from '../_shared/logging.ts';
import { Buffer } from 'node:buffer';
import mammoth from 'npm:mammoth@1.8.0';
import * as XLSX from 'npm:xlsx@0.18.5';
import JSZip from 'npm:jszip@3.10.1';

const MAX_BYTES = 25 * 1024 * 1024; // must match the bucket's file_size_limit

type Extractor = (bytes: Uint8Array) => Promise<string>;

interface TypeRule {
  mimes: string[];
  sniff: (bytes: Uint8Array) => boolean;
  extractor?: Extractor; // absent => sent to Gemini as a native file part
}

function bytesStartWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function isZip(bytes: Uint8Array): boolean {
  // docx/xlsx/pptx are all ZIP containers (Office Open XML).
  return bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
}

function isPlainText(bytes: Uint8Array): boolean {
  // Heuristic: decodes as UTF-8 without the replacement character showing up
  // constantly, and has no NUL bytes in the first 4KB.
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value as string;
}

async function extractXlsx(bytes: Uint8Array): Promise<string> {
  const wb = XLSX.read(bytes, { type: 'array' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    parts.push(`# ${sheetName}\n${csv}`);
  }
  return parts.join('\n\n');
}

async function extractPptx(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return na - nb;
    });

  const slides: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async('string');
    // Slide text lives in <a:t>...</a:t> runs — a light regex extraction is
    // enough here; we don't need full OOXML parsing for a text summary.
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    slides.push(`# Слайд ${i + 1}\n${texts.join(' ')}`);
  }
  return slides.join('\n\n');
}

async function extractPlainText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder('utf-8').decode(bytes);
}

const RULES: Record<string, TypeRule> = {
  'application/pdf': { mimes: ['application/pdf'], sniff: (b) => bytesStartWith(b, [0x25, 0x50, 0x44, 0x46]) },
  'image/jpeg': { mimes: ['image/jpeg', 'image/jpg'], sniff: (b) => bytesStartWith(b, [0xff, 0xd8, 0xff]) },
  'image/png': { mimes: ['image/png'], sniff: (b) => bytesStartWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  'image/webp': {
    mimes: ['image/webp'],
    sniff: (b) => bytesStartWith(b, [0x52, 0x49, 0x46, 0x46]) && bytesStartWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  },
  'audio/mpeg': {
    mimes: ['audio/mpeg', 'audio/mp3'],
    sniff: (b) => bytesStartWith(b, [0x49, 0x44, 0x33]) || bytesStartWith(b, [0xff, 0xfb]),
  },
  'audio/wav': {
    mimes: ['audio/wav', 'audio/x-wav'],
    sniff: (b) => bytesStartWith(b, [0x52, 0x49, 0x46, 0x46]) && bytesStartWith(b, [0x57, 0x41, 0x56, 0x45], 8),
  },
  'video/mp4': {
    mimes: ['video/mp4', 'video/quicktime'],
    sniff: (b) => b.length > 8 && new TextDecoder().decode(b.subarray(4, 8)) === 'ftyp',
  },
  'text/csv': { mimes: ['text/csv'], sniff: isPlainText, extractor: extractPlainText },
  'text/plain': { mimes: ['text/plain'], sniff: isPlainText, extractor: extractPlainText },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    sniff: isZip,
    extractor: extractDocx,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    sniff: isZip,
    extractor: extractXlsx,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    sniff: isZip,
    extractor: extractPptx,
  },
};

function findRule(declaredMime: string, bytes: Uint8Array): TypeRule | null {
  // Prefer the rule matching the declared mime AND whose sniff passes —
  // this is what stops someone renaming a .exe to report as image/png from
  // sailing through, since the sniff check on that specific rule will fail.
  const declared = RULES[declaredMime];
  if (declared && declared.sniff(bytes)) return declared;

  // Fall back to sniffing across all rules, in case the browser sent a
  // slightly different (but equivalent) mime string than we keyed on.
  for (const rule of Object.values(RULES)) {
    if (rule.sniff(bytes)) return rule;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const jsonHeaders = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' };
  const started = Date.now();

  let ctx;
  try {
    ctx = await requireUser(req);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: err instanceof AuthError ? err.status : 401,
      headers: jsonHeaders,
    });
  }

  try {
    await enforceRateLimit(ctx.admin, ctx.userId, 'process-file');
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: 'Твърде много качени файлове. Опитайте по-късно.' }), {
        status: 429,
        headers: jsonHeaders,
      });
    }
    throw err;
  }

  const { attachmentId } = await req.json().catch(() => ({}));
  if (!attachmentId) {
    return new Response(JSON.stringify({ error: 'attachmentId is required' }), { status: 400, headers: jsonHeaders });
  }

  const { data: attachment, error: fetchError } = await ctx.admin
    .from('attachments')
    .select('*')
    .eq('id', attachmentId)
    .single();

  if (fetchError || !attachment || attachment.user_id !== ctx.userId) {
    return new Response(JSON.stringify({ error: 'Attachment not found' }), { status: 404, headers: jsonHeaders });
  }

  await ctx.admin.from('attachments').update({ status: 'processing' }).eq('id', attachmentId);

  const fail = async (message: string) => {
    await ctx.admin
      .from('attachments')
      .update({ status: 'error', error_message: message })
      .eq('id', attachmentId);
    // Remove the rejected file — nothing should keep bytes we've decided
    // not to trust.
    await ctx.admin.storage.from('hah-files').remove([attachment.storage_path]);
    await logUsage(ctx.admin, {
      userId: ctx.userId,
      requestType: 'process-file',
      durationMs: Date.now() - started,
      status: 'error',
      errorCode: 'validation_failed',
    });
    return new Response(JSON.stringify({ error: message }), { status: 422, headers: jsonHeaders });
  };

  if (attachment.size > MAX_BYTES) {
    return await fail(`Файлът е твърде голям (максимум ${MAX_BYTES / 1024 / 1024}MB).`);
  }

  const { data: blob, error: dlError } = await ctx.admin.storage.from('hah-files').download(attachment.storage_path);
  if (dlError || !blob) {
    return await fail('Файлът не беше намерен в storage.');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rule = findRule(attachment.mime_type, bytes);

  if (!rule) {
    return await fail('Неподдържан или невалиден тип файл.');
  }

  try {
    let extractedText: string | null = null;
    if (rule.extractor) {
      extractedText = await rule.extractor(bytes);
      // Cap what we send to the model per attachment so one huge spreadsheet
      // can't blow the whole context window.
      if (extractedText.length > 200_000) {
        extractedText = extractedText.slice(0, 200_000) + '\n\n[...съкратено...]';
      }
    }

    await ctx.admin
      .from('attachments')
      .update({ status: 'ready', extracted_text: extractedText, mime_type: rule.mimes[0] })
      .eq('id', attachmentId);

    await logUsage(ctx.admin, {
      userId: ctx.userId,
      requestType: 'process-file',
      inputSize: bytes.length,
      outputSize: extractedText?.length,
      durationMs: Date.now() - started,
      status: 'success',
    });

    return new Response(JSON.stringify({ status: 'ready' }), { headers: jsonHeaders });
  } catch (err) {
    await logSystemError(ctx.admin, 'process-file', err instanceof Error ? err.message : String(err), {
      attachmentId,
    });
    return await fail('Грешка при обработка на файла.');
  }
});
