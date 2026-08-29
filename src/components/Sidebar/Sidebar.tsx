import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Conversation } from '@/types';
import { ConversationItem } from './ConversationItem';
import { archiveConversation, createConversation, deleteConversation, renameConversation } from '@/lib/conversations';
import { cn } from '@/lib/utils';

interface Props {
  conversations: Conversation[];
  onConversationsChange: () => void;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ conversations, onConversationsChange, open, onClose }: Props) {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(term));
  }, [conversations, search]);

  async function handleNewChat() {
    const conv = await createConversation();
    onConversationsChange();
    navigate(`/c/${conv.id}`);
    onClose();
  }

  return (
    <>
      {/* Mobile scrim */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-surface-border bg-surface-raised transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 p-3">
          <img src="/logo.svg" alt="HAH" className="h-7" />
        </div>

        <div className="px-3 pb-2">
          <button onClick={handleNewChat} className="btn-primary w-full justify-start">
            <span aria-hidden="true">+</span> Нов разговор
          </button>
        </div>

        <div className="px-3 pb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Търсене в разговорите…"
            aria-label="Търсене в разговорите"
            className="input"
          />
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3" aria-label="История на разговорите">
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-gray-500">Няма разговори</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  active={c.id === conversationId}
                  onRename={async (title) => {
                    await renameConversation(c.id, title);
                    onConversationsChange();
                  }}
                  onArchive={async () => {
                    await archiveConversation(c.id, true);
                    onConversationsChange();
                    if (c.id === conversationId) navigate('/');
                  }}
                  onDelete={async () => {
                    await deleteConversation(c.id);
                    onConversationsChange();
                    if (c.id === conversationId) navigate('/');
                  }}
                />
              ))}
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
