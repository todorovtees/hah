import { useEffect, useRef } from 'react';
import type { Message } from '@/types';
import { MessageBubble } from './MessageBubble';

export function MessageList({ messages, errorText }: { messages: Message[]; errorText?: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage?.content;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, lastMessageContent]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <img src="/logo.svg" alt="" className="mb-2 h-9 opacity-80" />
        <h2 className="text-xl font-semibold text-white">Как мога да помогна?</h2>
        <p className="max-w-sm text-sm text-gray-500">
          Пишете съобщение, прикачете файл или задайте въпрос — HAH ще Ви отговори.
        </p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto" role="log" aria-live="polite">
      <div className="mx-auto flex max-w-3xl flex-col py-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {errorText && (
          <div className="mx-4 my-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errorText}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
