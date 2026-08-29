import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { signInWithPassword, signInWithMagicLink } from '@/lib/auth';
import { Spinner } from '@/components/common/Spinner';

type Mode = 'password' | 'magic-link';

export default function Login() {
  const { session, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  if (!authLoading && session) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'password') {
        await signInWithPassword(email, password);
      } else {
        await signInWithMagicLink(email);
        setMagicLinkSent(true);
      }
    } catch (err) {
      // Deliberately generic — never surface Supabase's raw error strings,
      // which can hint at whether an email exists at all.
      setError('Неуспешен вход. Проверете имейла и паролата.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/logo.svg" alt="HAH" className="h-8" />
          <p className="text-sm text-gray-400">Вход в HAH</p>
        </div>

        {magicLinkSent ? (
          <div className="rounded-lg border border-surface-border bg-surface-raised p-4 text-center text-sm text-gray-300">
            Изпратихме линк за вход на <span className="text-white">{email}</span>. Проверете пощата си.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {mode === 'password' && (
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Парола"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary mt-1 w-full">
              {submitting ? <Spinner className="h-4 w-4" /> : mode === 'password' ? 'Вход' : 'Изпрати линк за вход'}
            </button>

            <button
              type="button"
              onClick={() => setMode(mode === 'password' ? 'magic-link' : 'password')}
              className="text-center text-xs text-gray-500 hover:text-gray-300"
            >
              {mode === 'password' ? 'Вход с линк по имейл вместо парола' : 'Вход с парола вместо линк'}
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-gray-600">
          Достъпът до HAH е само с покана. Ако нямате профил, свържете се с администратор.
        </p>
      </div>
    </div>
  );
}
