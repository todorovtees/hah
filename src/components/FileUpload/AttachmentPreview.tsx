import type { Attachment } from '@/types';
import { formatBytes, isImageMime } from '@/lib/utils';
import { Spinner } from '@/components/common/Spinner';
import { cn } from '@/lib/utils';

export function AttachmentPreview({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const busy = attachment.status === 'uploaded' || attachment.status === 'processing';
  const failed = attachment.status === 'error';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        failed ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-surface-border bg-surface-raised text-gray-200',
      )}
      title={failed ? attachment.error_message ?? 'Грешка' : attachment.filename}
    >
      <span aria-hidden="true">{isImageMime(attachment.mime_type) ? '🖼️' : '📎'}</span>
      <span className="max-w-[10rem] truncate">{attachment.filename}</span>
      <span className="text-gray-500">{formatBytes(attachment.size)}</span>
      {busy && <Spinner className="h-3 w-3 text-gray-400" />}
      <button
        onClick={onRemove}
        aria-label={`Премахни ${attachment.filename}`}
        className="ml-1 rounded-full px-1 text-gray-500 hover:bg-white/10 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
