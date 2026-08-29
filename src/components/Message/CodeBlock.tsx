import { useState } from 'react';
import { cn } from '@/lib/utils';

export function CodeBlock({ className, children }: { className?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || '')?.[1];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API unavailable — silently ignore */
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-surface-border bg-black/40">
      <div className="flex items-center justify-between border-b border-surface-border px-3 py-1.5">
        <span className="text-xs text-gray-500">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className={cn(
            'rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-white/10 hover:text-white',
            copied && 'text-green-400',
          )}
        >
          {copied ? 'Копирано ✓' : 'Copy'}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-3 text-sm leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
