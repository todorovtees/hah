import type { Message } from '@/types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { cn } from '@/lib/utils';

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex w-full animate-fade-in gap-3 px-4 py-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
          H
        </div>
      )}

      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[70%]',
          isUser ? 'bg-accent text-white' : 'bg-surface-raised text-gray-100',
        )}
      >
        {message.pending && message.content === '' ? (
          <div className="flex items-center gap-1 py-1 text-gray-400">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
          </div>
        ) : isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        ) : (
          <>
            <MarkdownRenderer content={message.content} />
            {message.pending && <span className="ml-0.5 inline-block h-4 w-1.5 animate-blink bg-current align-middle" />}
          </>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 border-t border-white/10 pt-2">
            <p className="mb-1 text-xs font-medium text-gray-400">Източници</p>
            <ul className="flex flex-col gap-1">
              {message.sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-xs text-accent hover:underline"
                    title={s.url}
                  >
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
