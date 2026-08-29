import { useEffect, useRef, useState } from 'react';
import type { Attachment, Message } from '@/types';
import { useMessages } from '@/hooks/useMessages';
import { insertUserMessage } from '@/lib/messages';
import { streamAssistantReply } from '@/lib/api';
import { uploadFile, waitForAttachmentReady, removeAttachment as removeAttachmentFile } from '@/lib/files';
import { MessageList } from '@/components/Message/MessageList';
import { Composer } from '@/components/Composer/Composer';

interface Props {
  conversationId: string | null;
  ensureConversationId: () => Promise<string>;
  onExchangeComplete: () => void;
}

export function ChatWindow({ conversationId, ensureConversationId, onExchangeComplete }: Props) {
  const { messages, setMessages } = useMessages(conversationId);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Switching conversations (or starting a fresh draft) clears in-flight UI
  // state — an in-progress stream for a different chat shouldn't leak in.
  useEffect(() => {
    setDraft('');
    setAttachments([]);
    setStreamError(null);
    abortRef.current?.abort();
  }, [conversationId]);

  async function addFile(file: File) {
    try {
      const convId = await ensureConversationId();
      const att = await uploadFile(convId, file);
      setAttachments((prev) => [...prev, att]);
      try {
        const ready = await waitForAttachmentReady(att.id);
        setAttachments((prev) => prev.map((a) => (a.id === ready.id ? ready : a)));
      } catch {
        setAttachments((prev) =>
          prev.map((a) => (a.id === att.id ? { ...a, status: 'error', error_message: 'Изтекло време за обработка.' } : a)),
        );
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Грешка при качване на файл.');
    }
  }

  function handleFilesSelected(files: File[]) {
    files.forEach((f) => void addFile(f));
  }

  async function handleRemoveAttachment(id: string) {
    const att = attachments.find((a) => a.id === id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    if (att) await removeAttachmentFile(att).catch(() => {});
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setStreamError(null);
    setDraft('');

    try {
      const convId = await ensureConversationId();
      const readyAttachmentIds = attachments.filter((a) => a.status === 'ready').map((a) => a.id);

      const userMessage = await insertUserMessage(convId, content);
      setMessages((prev) => [...prev, userMessage]);
      setAttachments([]);

      const pendingId = crypto.randomUUID();
      const pendingMessage: Message = {
        id: pendingId,
        conversation_id: convId,
        user_id: userMessage.user_id,
        role: 'assistant',
        content: '',
        sources: null,
        created_at: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, pendingMessage]);

      const controller = new AbortController();
      abortRef.current = controller;

      await streamAssistantReply(
        convId,
        readyAttachmentIds,
        {
          onDelta: (text) =>
            setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, content: m.content + text } : m))),
          onSources: (sources) =>
            setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, sources } : m))),
          onDone: ({ messageId }) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === pendingId ? { ...m, id: messageId ?? m.id, pending: false } : m)),
            ),
          onError: (message) => {
            setStreamError(message);
            setMessages((prev) => prev.filter((m) => m.id !== pendingId));
          },
        },
        controller.signal,
      );

      onExchangeComplete();
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Възникна грешка.');
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <MessageList messages={messages} errorText={streamError} />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onFilesSelected={handleFilesSelected}
        attachments={attachments}
        onRemoveAttachment={handleRemoveAttachment}
        disabled={sending}
        sending={sending}
      />
    </div>
  );
}
