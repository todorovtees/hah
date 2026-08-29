import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!profile) return null;
  const initial = (profile.display_name || profile.email)[0]?.toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white hover:brightness-110"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-20 mt-2 w-56 origin-top-right animate-fade-in rounded-lg border border-surface-border bg-surface-raised p-1 shadow-xl',
          )}
        >
          <div className="px-3 py-2 text-xs text-gray-400">
            <p className="truncate font-medium text-gray-200">{profile.display_name || profile.email}</p>
            <p className="truncate">{profile.email}</p>
          </div>
          <div className="my-1 h-px bg-surface-border" />
          <Link to="/settings" role="menuitem" className="block rounded-md px-3 py-2 text-sm text-gray-200 hover:bg-white/5">
            Настройки
          </Link>
          {profile.role === 'admin' && (
            <Link to="/admin" role="menuitem" className="block rounded-md px-3 py-2 text-sm text-gray-200 hover:bg-white/5">
              Администрация
            </Link>
          )}
          <button
            role="menuitem"
            onClick={() => signOut()}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5"
          >
            Изход
          </button>
        </div>
      )}
    </div>
  );
}
