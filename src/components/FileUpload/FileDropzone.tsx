import { useCallback, useRef, useState, type DragEvent } from 'react';
import { ACCEPTED_MIME_TYPES } from '@/lib/files';
import { cn } from '@/lib/utils';

interface Props {
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
}

/**
 * Wraps the composer so the whole input area (not just a button) accepts
 * drag & drop, per the spec's "Composer-ът трябва да поддържа drag & drop."
 */
export function FileDropzone({ onFiles, children }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {children}

      <input
        ref={inputRef}
        id="file-input"
        type="file"
        multiple
        accept={ACCEPTED_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />

      {dragging && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl',
            'border-2 border-dashed border-accent bg-accent/10 text-sm font-medium text-accent',
          )}
        >
          Пуснете файловете тук
        </div>
      )}
    </div>
  );
}
