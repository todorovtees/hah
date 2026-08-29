import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  conversation: Conversation;
  active: boolean;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function ConversationItem({ conversation, active, onRename, onArchive, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [menuOpen, setMenuOpen] = useState(false);

  function commitRename() {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== conversation.title) onRename(trimmed);
    else setTitle(conversation.title);
  }

  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg px-2 py-2 text-sm',
        active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5',
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setTitle(conversation.title);
              setEditing(false);
            }
          }}
          className="w-full rounded bg-transparent outline-none"
        />
      ) : (
        <Link to={`/c/${conversation.id}`} className="min-w-0 flex-1 truncate" title={conversation.title}>
          {conversation.title}
        </Link>
      )}

      <div className="relative ml-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          aria-label="Опции за разговора"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-7 z-30 w-40 rounded-lg border border-surface-border bg-surface-raised p-1 shadow-xl"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-white/5"
              onClick={() => {
                setEditing(true);
                setMenuOpen(false);
              }}
            >
              Преименувай
            </button>
            <button
              className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-white/5"
              onClick={() => {
                onArchive();
                setMenuOpen(false);
              }}
            >
              Архивирай
            </button>
            <button
              className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-red-400 hover:bg-white/5"
              onClick={() => {
                if (confirm('Изтриване на разговора? Това действие е необратимо.')) onDelete();
                setMenuOpen(false);
              }}
            >
              Изтрий
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
