// POST /functions/v1/search
// Body: { query: string }
//
// Standalone web-search utility (separate from the in-chat search that
// Gemini's google_search tool triggers automatically inside /chat). Useful
// for a dedicated "search the web" action in the UI that isn't tied to a
// conversation. Returns a synthesized answer plus the source list so the UI
// can render citations per section 18 of the spec.
//
// Self-contained on purpose — see the comment at the top of ../chat/index.ts
// for why (pasteable directly into the Supabase Dashboard Edge Functions
// editor, no CLI required).

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
// Shared: rate limiting
// ---------------------------------------------------------------------------
const RATE_LIMITS: Record<string, { windowSeconds: number; max: number }> = {
  search: { windowSeconds: 60, max: 20 },
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
// Shared: Gemini (streaming call only — no title generation needed here)
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

// ---------------------------------------------------------------------------
// /search — endpoint-specific logic
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' };
  const started = Date.now();

  let ctx: AuthedContext;
  try {
    ctx = await requireUser(req);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: err instanceof AuthError ? err.status : 401,
      headers,
    });
  }

  try {
    await enforceRateLimit(ctx.admin, ctx.userId, 'search');
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: 'Твърде много заявки. Опитайте отново след малко.' }), {
        status: 429,
        headers,
      });
    }
    throw err;
  }

  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'query is required' }), { status: 400, headers });
  }

  let answer = '';
  let sources: { title: string; url: string }[] = [];
  let errorMessage: string | null = null;

  for await (const event of streamChat({
    model: defaultModel(),
    systemInstruction:
      'Отговори кратко и точно на въпроса на потребителя, използвайки актуална информация от интернет. ' +
      'Цитирай факти само въз основа на намерените резултати.',
    contents: [{ role: 'user', parts: [{ text: query }] }],
    enableSearch: true,
  })) {
    if (event.type === 'delta') answer += event.text;
    if (event.type === 'sources') sources = event.sources;
    if (event.type === 'error') errorMessage = event.message;
  }

  const durationMs = Date.now() - started;

  if (errorMessage) {
    await logSystemError(ctx.admin, 'search', errorMessage, { userId: ctx.userId, query });
    await logUsage(ctx.admin, {
      userId: ctx.userId,
      requestType: 'search',
      durationMs,
      status: 'error',
      errorCode: 'gemini_error',
    });
    return new Response(JSON.stringify({ error: 'Грешка при търсене.' }), { status: 502, headers });
  }

  await logUsage(ctx.admin, {
    userId: ctx.userId,
    requestType: 'search',
    model: defaultModel(),
    inputSize: query.length,
    outputSize: answer.length,
    durationMs,
    status: 'success',
  });

  return new Response(JSON.stringify({ answer, sources }), { headers });
});
