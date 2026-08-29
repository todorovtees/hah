export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'току-що';
  if (diffMin < 60) return `преди ${diffMin} мин`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `преди ${diffH} ч`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `преди ${diffD} дни`;
  return date.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}
