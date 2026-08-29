// Thin wrapper around the Gemini API. No SDK — it's a handful of REST calls,
// and a raw fetch keeps the edge function's cold start fast and its
// dependency surface small.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GroundingSource {
  title: string;
  url: string;
}

/** Parsed, normalized event emitted while consuming a Gemini SSE stream. */
export type GeminiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: GroundingSource[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

function apiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

export function defaultModel(): string {
  return Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
}

/**
 * Streams a chat completion from Gemini and yields normalized events. The
 * caller decides what to do with each event (forward as SSE, accumulate
 * text, etc). `enableSearch` turns on Gemini's built-in Google Search
 * grounding tool — the model itself decides per-turn whether to use it,
 * which is what acts as the "router" described in the spec: no query
 * classifier of our own is needed.
 */
export async function* streamChat(opts: {
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
  if (opts.enableSearch) {
    body.tools = [{ google_search: {} }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      // SSE events are separated by a blank line.
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

  if (seenSources.size > 0) {
    yield { type: 'sources', sources: [...seenSources.values()] };
  }
  yield { type: 'done' };
}

/** Small, non-streaming call used only for conversation title generation. */
export async function generateShortTitle(firstUserMessage: string): Promise<string> {
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
