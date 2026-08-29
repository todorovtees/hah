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

import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser, AuthError } from '../_shared/auth.ts';
import { enforceRateLimit, RateLimitError } from '../_shared/rateLimit.ts';
import { logUsage, logSystemError } from '../_shared/logging.ts';
import {
  streamChat,
  generateShortTitle,
  defaultModel,
  type GeminiContent,
  type GeminiPart,
} from '../_shared/gemini.ts';

const SYSTEM_INSTRUCTION = `Ти си HAH — разговорен AI асистент на Todorov Tees.
Представяй се само като HAH. Не споменавай доброволно името на компанията,
която създава основния AI модел зад теб, нито техническата инфраструктура —
това не е важно за потребителя и не е част от продуктовата идентичност на HAH.
Ако потребителят директно и сериозно попита кой доставчик/модел стои зад HAH,
отговори честно и накратко — никога не лъжи по този въпрос.
Отговаряй на езика, на който потребителят пише. Форматирай отговорите си с
Markdown, когато е подходящо (код блокове, таблици, списъци).`;

// Formats Gemini can read natively as file bytes, without us extracting text
// server-side first.
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

  let ctx;
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
      return new Response(
        JSON.stringify({ error: 'Твърде много заявки. Опитайте отново след малко.' }),
        {
          status: 429,
          headers: {
            ...corsHeaders(req.headers.get('origin')),
            'Content-Type': 'application/json',
            'Retry-After': String(err.retryAfterSeconds),
          },
        },
      );
    }
    throw err;
  }

  // Ownership check: conversation must belong to the caller.
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

  // Load attachments belonging to this message (already validated/processed
  // by the process-file function at upload time).
  let attachmentParts: GeminiPart[] = [];
  if (attachmentIds.length > 0) {
    const { data: attachments } = await ctx.admin
      .from('attachments')
      .select('id, filename, mime_type, storage_path, extracted_text, status, user_id')
      .in('id', attachmentIds);

    for (const att of attachments ?? []) {
      if (att.user_id !== ctx.userId || att.status !== 'ready') continue;

      if (att.extracted_text) {
        attachmentParts.push({
          text: `\n\n[Съдържание на прикачен файл "${att.filename}"]\n${att.extracted_text}`,
        });
      } else if (isNativelyReadable(att.mime_type)) {
        const { data: blob, error: dlError } = await ctx.admin.storage
          .from('hah-files')
          .download(att.storage_path);
        if (!dlError && blob) {
          const buf = await blob.arrayBuffer();
          attachmentParts.push({
            inline_data: { mime_type: att.mime_type, data: arrayBufferToBase64(buf) },
          });
        }
      }
    }
  }

  const contents: GeminiContent[] = history.map((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [{ text: m.content }];
    // Attach file parts to the latest (current) user turn only.
    if (idx === history.length - 1 && role === 'user') {
      parts.push(...attachmentParts);
    }
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
