import { supabase } from './supabase';
import type { Source } from '@/types';

export interface ChatStreamHandlers {
  onDelta: (text: string) => void;
  onSources: (sources: Source[]) => void;
  onDone: (info: { messageId?: string; title?: string | null }) => void;
  onError: (message: string) => void;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

/**
 * Calls the chat edge function and streams the assistant's reply. The user
 * message must already be inserted (see lib/messages.ts) before calling
 * this — the server reads history from the DB rather than trusting a copy
 * from the client.
 */
export async function streamAssistantReply(
  conversationId: string,
  attachmentIds: string[],
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await authHeaders();

  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversationId, attachmentIds }),
      signal,
    });
  } catch {
    handlers.onError('Неуспешна връзка със сървъра. Проверете интернет връзката си.');
    return;
  }

  if (!res.ok || !res.body) {
    let message = 'Неуспешна заявка. Опитайте отново.';
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* keep default message */
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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

      let parsed: { type: string; text?: string; sources?: Source[]; message?: string; messageId?: string; title?: string | null };
      try {
        parsed = JSON.parse(line.slice('data: '.length));
      } catch {
        continue;
      }

      switch (parsed.type) {
        case 'delta':
          handlers.onDelta(parsed.text ?? '');
          break;
        case 'sources':
          handlers.onSources(parsed.sources ?? []);
          break;
        case 'error':
          handlers.onError(parsed.message ?? 'Възникна грешка.');
          break;
        case 'done':
          handlers.onDone({ messageId: parsed.messageId, title: parsed.title });
          break;
      }
    }
  }
}

export async function webSearch(query: string): Promise<{ answer: string; sources: Source[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Search failed');
  return data;
}
