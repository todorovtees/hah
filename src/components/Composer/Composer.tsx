import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Attachment } from '@/types';
import { FileDropzone } from '@/components/FileUpload/FileDropzone';
import { AttachmentPreview } from '@/components/FileUpload/AttachmentPreview';
import { Spinner } from '@/components/common/Spinner';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onFilesSelected: (files: File[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  disabled?: boolean;
  sending?: boolean;
}

export function Composer({
  value,
  onChange,
  onSend,
  onFilesSelected,
  attachments,
  onRemoveAttachment,
  disabled,
  sending,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  }

  const filesUploading = attachments.some((a) => a.status === 'uploaded' || a.status === 'processing');

  return (
    <div className="border-t border-surface-border bg-surface p-3 sm:p-4">
      <FileDropzone onFiles={onFilesSelected}>
        <div className="mx-auto flex max-w-3xl flex-col rounded-2xl border border-surface-border bg-surface-raised focus-within:border-accent">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <AttachmentPreview key={a.id} attachment={a} onRemove={() => onRemoveAttachment(a.id)} />
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 px-2 py-2">
            <button
              type="button"
              aria-label="Прикачи файл"
              title="Прикачи файл"
              onClick={() => document.getElementById('file-input')?.click()}
              className="btn-ghost shrink-0 !px-2.5"
            >
              📎
            </button>

            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Напишете съобщение…"
              rows={1}
              aria-label="Съобщение"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
            />

            <button
              type="button"
              onClick={onSend}
              disabled={disabled || !value.trim() || filesUploading}
              aria-label="Изпрати"
              className="btn-primary shrink-0 !rounded-full !p-2.5"
            >
              {sending ? <Spinner className="h-4 w-4" /> : '↑'}
            </button>
          </div>
        </div>
      </FileDropzone>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-gray-600">
        HAH може да допуска грешки. Проверявайте важна информация.
      </p>
    </div>
  );
}
