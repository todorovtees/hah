// POST /functions/v1/search
// Body: { query: string }
//
// Standalone web-search utility (separate from the in-chat search that
// Gemini's google_search tool triggers automatically inside /chat). Useful
// for a dedicated "search the web" action in the UI that isn't tied to a
// conversation. Returns a synthesized answer plus the source list so the UI
// can render citations per section 18 of the spec.

import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser, AuthError } from '../_shared/auth.ts';
import { enforceRateLimit, RateLimitError } from '../_shared/rateLimit.ts';
import { logUsage, logSystemError } from '../_shared/logging.ts';
import { streamChat, defaultModel } from '../_shared/gemini.ts';

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' };
  const started = Date.now();

  let ctx;
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
