import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { ChatWindow } from '@/components/Chat/ChatWindow';
import { UserMenu } from '@/components/UserMenu/UserMenu';
import { useConversations } from '@/hooks/useConversations';
import { createConversation } from '@/lib/conversations';

export default function Chat() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { conversations, reload } = useConversations();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pendingIdRef = useRef<string | null>(null);

  // A brand new browser tab at "/" is a draft: nothing to create until the
  // user actually sends something (or attaches a file).
  useEffect(() => {
    pendingIdRef.current = null;
  }, [conversationId]);

  async function ensureConversationId(): Promise<string> {
    if (conversationId) return conversationId;
    if (pendingIdRef.current) return pendingIdRef.current;
    const conv = await createConversation();
    pendingIdRef.current = conv.id;
    reload();
    navigate(`/c/${conv.id}`, { replace: true });
    return conv.id;
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-surface">
      <Sidebar
        conversations={conversations}
        onConversationsChange={reload}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-surface-border px-3 py-2 md:justify-end">
          <button
            className="btn-ghost !px-2 md:hidden"
            aria-label="Отвори менюто"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <UserMenu />
        </header>

        <ChatWindow
          key={conversationId ?? 'draft'}
          conversationId={conversationId ?? null}
          ensureConversationId={ensureConversationId}
          onExchangeComplete={reload}
        />
      </div>
    </div>
  );
}
