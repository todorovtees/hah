// POST /functions/v1/chat
// Body: { conversationId: string, attachmentIds?: string[] }
//
// Expects the user's message to already be inserted into `messages` by the
// client (which is allowed directly under RLS — see src/lib/messages.ts).
// This function loads the conversation history, calls Gemini, streams the
// assistant's reply back to the browser as it's generated, and once
// complete persists the assistant message (+ sources) and, for a brand new
// conversation, a generated title — all with the service role, so none of
// that bookkeeping depends on the client staying connected correctly.
//
// This file is intentionally self-contained (no imports from ../_shared) so
// it can be deployed by pasting it directly into the Supabase Dashboard's
// Edge Functions editor, with no CLI required. The other 3 functions
// (search, process-file, admin-users) duplicate the same small CORS/auth/
// rate-limit/logging helpers for the same reason — see the comment block in
// each for what's shared vs endpoint-specific.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Shared: CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set([
  'https://hah.todorovtees.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://hah.todorovtees.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req.headers.get('origin')) });
  return null;
}

// ---------------------------------------------------------------------------
// Shared: auth
// ---------------------------------------------------------------------------
interface AuthedContext {
  admin: SupabaseClient;
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
  }
}

async function requireUser(req: Request): Promise<AuthedContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new AuthError('Missing Authorization header', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new AuthError('Server misconfigured', 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) throw new AuthError('Invalid or expired session', 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', userData.user.id)
    .single();
  if (profileError || !profile) throw new AuthError('Account is not authorized', 403);

  return { admin, userId: userData.user.id, email: profile.email, role: profile.role as 'admin' | 'user' };
}

// ---------------------------------------------------------------------------
// Shared: rate limiting (sliding window via the count_recent_usage() SQL fn)
// ---------------------------------------------------------------------------
const RATE_LIMITS: Record<string, { windowSeconds: number; max: number }> = {
  chat: { windowSeconds: 60, max: 20 },
};

class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Rate limit exceeded');
  }
}

async function enforceRateLimit(admin: SupabaseClient, userId: string, requestType: keyof typeof RATE_LIMITS) {
  const limit = RATE_LIMITS[requestType];
  if (!limit) return;

  const { data, error } = await admin.rpc('count_recent_usage', {
    p_user_id: userId,
    p_request_type: requestType,
    p_window_seconds: limit.windowSeconds,
  });

  if (error) {
    await admin.from('system_logs').insert({
      level: 'error',
      source: 'rateLimit',
      message: 'count_recent_usage failed',
      metadata: { error: error.message, userId, requestType },
    });
    return;
  }

  if ((data as number) >= limit.max) throw new RateLimitError(limit.windowSeconds);
}

// ---------------------------------------------------------------------------
// Shared: logging
// ---------------------------------------------------------------------------
async function logUsage(
  admin: SupabaseClient,
  entry: {
    userId: string | null;
    requestType: string;
    model?: string;
    inputSize?: number;
    outputSize?: number;
    durationMs?: number;
    status: 'success' | 'error' | 'rate_limited';
    errorCode?: string;
  },
) {
  const { error } = await admin.from('usage_logs').insert({
    user_id: entry.userId,
    request_type: entry.requestType,
    model: entry.model ?? null,
    input_size: entry.inputSize ?? null,
    output_size: entry.outputSize ?? null,
    duration_ms: entry.durationMs ?? null,
    status: entry.status,
    error_code: entry.errorCode ?? null,
  });
  if (error) console.error('logUsage failed', error.message);
}

async function logSystemError(admin: SupabaseClient, source: string, message: string, metadata?: Record<string, unknown>) {
  const { error } = await admin.from('system_logs').insert({ level: 'error', source, message, metadata: metadata ?? null });
  if (error) console.error('logSystemError failed', error.message);
}

// ---------------------------------------------------------------------------
// Shared: Gemini
// ---------------------------------------------------------------------------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
interface GroundingSource {
  title: string;
  url: string;
}
type GeminiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: GroundingSource[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

function apiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

function defaultModel(): string {
  return Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
}

async function* streamChat(opts: {
  model: string;
  systemInstruction: string;
  contents: GeminiContent[];
  enableSearch: boolean;
}): AsyncGenerator<GeminiStreamEvent> {
  const url = `${GEMINI_BASE}/models/${opts.model}:streamGenerateContent?alt=sse&key=${apiKey()}`;
  const body: Record<string, unknown> = {
    contents: opts.contents,
    systemInstruction: { role: 'system', parts: [{ text: opts.systemInstruction }] },
    generationConfig: { temperature: 0.7 },
    safetySettings: [],
  };
  if (opts.enableSearch) body.tools = [{ google_search: {} }];

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { type: 'error', message: `Gemini API error ${res.status}: ${text.slice(0, 500)}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const seenSources = new Map<string, GroundingSource>();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = rawEvent.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const jsonStr = line.slice('data: '.length).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const candidate = parsed?.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const text = parts.map((p: GeminiPart) => p.text ?? '').join('');
        if (text) yield { type: 'delta', text };

        const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
        for (const c of chunks) {
          const web = c?.web;
          if (web?.uri && !seenSources.has(web.uri)) {
            seenSources.set(web.uri, { title: web.title || web.uri, url: web.uri });
          }
        }
      }
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (seenSources.size > 0) yield { type: 'sources', sources: [...seenSources.values()] };
  yield { type: 'done' };
}

async function generateShortTitle(firstUserMessage: string): Promise<string> {
  try {
    const url = `${GEMINI_BASE}/models/${defaultModel()}:generateContent?key=${apiKey()}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Дай кратко заглавие (максимум 5 думи, без кавички, без точка накрая) ' +
                  'за разговор, който започва с това съобщение:\n\n' +
                  firstUserMessage.slice(0, 2000),
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 20 },
      }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const title: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleaned = title?.trim().replace(/^["'\n]+|["'\n]+$/g, '');
    return cleaned && cleaned.length > 0 ? cleaned.slice(0, 80) : firstUserMessage.slice(0, 60);
  } catch {
    return firstUserMessage.slice(0, 60);
  }
}

// ---------------------------------------------------------------------------
// /chat — endpoint-specific logic
// ---------------------------------------------------------------------------
const SYSTEM_INSTRUCTION = `Ти си HAH — разговорен AI асистент на Todorov Tees.
Представяй се само като HAH. Не споменавай доброволно името на компанията,
която създава основния AI модел зад теб, нито техническата инфраструктура —
това не е важно за потребителя и не е част от продуктовата идентичност на HAH.
Ако потребителят директно и сериозно попита кой доставчик/модел стои зад HAH,
отговори честно и накратко — никога не лъжи по този въпрос.
Отговаряй на езика, на който потребителят пише. Форматирай отговорите си с
Markdown, когато е подходящо (код блокове, таблици, списъци).`;

const NATIVE_PREFIXES = ['image/', 'audio/', 'video/'];
const NATIVE_EXACT = new Set(['application/pdf']);

function isNativelyReadable(mime: string): boolean {
  return NATIVE_EXACT.has(mime) || NATIVE_PREFIXES.some((p) => mime.startsWith(p));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'text/event-stream' };
  const started = Date.now();

  let ctx: AuthedContext;
  try {
    ctx = await requireUser(req);
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status,
      headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }

  let payload: { conversationId?: string; attachmentIds?: string[] };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }

  const { conversationId, attachmentIds = [] } = payload;
  if (!conversationId) {
    return new Response(JSON.stringify({ error: 'conversationId is required' }), {
      status: 400,
      headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }

  try {
    await enforceRateLimit(ctx.admin, ctx.userId, 'chat');
  } catch (err) {
    if (err instanceof RateLimitError) {
      await logUsage(ctx.admin, { userId: ctx.userId, requestType: 'chat', status: 'rate_limited' });
      return new Response(JSON.stringify({ error: 'Твърде много заявки. Опитайте отново след малко.' }), {
        status: 429,
        headers: {
          ...corsHeaders(req.headers.get('origin')),
          'Content-Type': 'application/json',
          'Retry-After': String(err.retryAfterSeconds),
        },
      });
    }
    throw err;
  }

  const { data: conversation, error: convError } = await ctx.admin
    .from('conversations')
    .select('id, user_id, title')
    .eq('id', conversationId)
    .single();

  if (convError || !conversation || conversation.user_id !== ctx.userId) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), {
      status: 404,
      headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }

  const { data: history, error: historyError } = await ctx.admin
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(60);

  if (historyError || !history || history.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages found for this conversation' }), {
      status: 400,
      headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }

  const isFirstMessage = history.length === 1;

  let attachmentParts: GeminiPart[] = [];
  if (attachmentIds.length > 0) {
    const { data: attachments } = await ctx.admin
      .from('attachments')
      .select('id, filename, mime_type, storage_path, extracted_text, status, user_id')
      .in('id', attachmentIds);

    for (const att of attachments ?? []) {
      if (att.user_id !== ctx.userId || att.status !== 'ready') continue;

      if (att.extracted_text) {
        attachmentParts.push({ text: `\n\n[Съдържание на прикачен файл "${att.filename}"]\n${att.extracted_text}` });
      } else if (isNativelyReadable(att.mime_type)) {
        const { data: blob, error: dlError } = await ctx.admin.storage.from('hah-files').download(att.storage_path);
        if (!dlError && blob) {
          const buf = await blob.arrayBuffer();
          attachmentParts.push({ inline_data: { mime_type: att.mime_type, data: arrayBufferToBase64(buf) } });
        }
      }
    }
  }

  const contents: GeminiContent[] = history.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [{ text: m.content }];
    if (idx === history.length - 1 && role === 'user') parts.push(...attachmentParts);
    return { role, parts } as GeminiContent;
  });

  const encoder = new TextEncoder();
  let fullText = '';
  let sources: { title: string; url: string }[] = [];
  let streamError: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      for await (const event of streamChat({
        model: defaultModel(),
        systemInstruction: SYSTEM_INSTRUCTION,
        contents,
        enableSearch: true,
      })) {
        if (event.type === 'delta') {
          fullText += event.text;
          send({ type: 'delta', text: event.text });
        } else if (event.type === 'sources') {
          sources = event.sources;
          send({ type: 'sources', sources });
        } else if (event.type === 'error') {
          streamError = event.message;
          send({ type: 'error', message: 'Възникна грешка при генериране на отговор.' });
        }
      }

      const durationMs = Date.now() - started;

      if (streamError) {
        await logSystemError(ctx.admin, 'chat', streamError, { userId: ctx.userId, conversationId });
        await logUsage(ctx.admin, {
          userId: ctx.userId,
          requestType: 'chat',
          model: defaultModel(),
          durationMs,
          status: 'error',
          errorCode: 'gemini_error',
        });
        send({ type: 'done' });
        controller.close();
        return;
      }

      const { data: assistantMessage } = await ctx.admin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: ctx.userId,
          role: 'assistant',
          content: fullText,
          sources: sources.length > 0 ? sources : null,
        })
        .select('id')
        .single();

      let title: string | null = null;
      if (isFirstMessage) {
        title = await generateShortTitle(history[0].content);
        await ctx.admin.from('conversations').update({ title }).eq('id', conversationId);
      }

      await logUsage(ctx.admin, {
        userId: ctx.userId,
        requestType: 'chat',
        model: defaultModel(),
        inputSize: contents.reduce((n, c) => n + c.parts.reduce((m, p) => m + (p.text?.length ?? 0), 0), 0),
        outputSize: fullText.length,
        durationMs,
        status: 'success',
      });

      send({ type: 'done', messageId: assistantMessage?.id, title });
      controller.close();
    },
  });

  return new Response(stream, { headers });
});
