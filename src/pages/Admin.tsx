import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthorizedUser, Profile } from '@/types';
import { listUsers, inviteUser, setUserActive, setUserRole, fetchStats, type AdminStats } from '@/lib/admin';
import { Spinner } from '@/components/common/Spinner';
import { formatRelativeTime } from '@/lib/utils';

export default function Admin() {
  const [authorized, setAuthorized] = useState<AuthorizedUser[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, statsRes] = await Promise.all([listUsers(), fetchStats()]);
      setAuthorized(usersRes.authorized);
      setProfiles(usersRes.profiles);
      setStats(statsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      await inviteUser(inviteEmail.trim().toLowerCase(), inviteName.trim(), inviteRole);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('user');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Неуспешна покана');
    } finally {
      setInviting(false);
    }
  }

  function profileFor(email: string): Profile | undefined {
    return profiles.find((p) => p.email.toLowerCase() === email.toLowerCase());
  }

  return (
    <div className="min-h-screen bg-surface text-gray-100">
      <header className="flex items-center gap-3 border-b border-surface-border px-4 py-3">
        <Link to="/" className="btn-ghost !px-2" aria-label="Обратно към чата">
          ←
        </Link>
        <h1 className="text-sm font-semibold">Администрация</h1>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {loading ? (
          <Spinner />
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <div className="flex flex-col gap-10">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Потребители" value={stats?.userCount ?? '—'} />
              <StatCard label="Разговори" value={stats?.conversationCount ?? '—'} />
              <StatCard label="Заявки (24ч)" value={stats?.last24hRequests ?? '—'} />
              <StatCard label="Грешки (скоро)" value={stats?.recentErrors.length ?? '—'} />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-300">Покани потребител</h2>
              <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
                <input
                  type="email"
                  required
                  placeholder="имейл"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="input max-w-xs"
                />
                <input
                  placeholder="име (незадължително)"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="input max-w-xs"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                  className="input max-w-[10rem]"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
                <button type="submit" disabled={inviting} className="btn-primary">
                  {inviting ? 'Изпращане…' : 'Покани'}
                </button>
              </form>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-300">Потребители</h2>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-surface-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-raised text-xs text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Имейл</th>
                      <th className="px-3 py-2">Име</th>
                      <th className="px-3 py-2">Роля</th>
                      <th className="px-3 py-2">Статус</th>
                      <th className="px-3 py-2">Регистриран</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {authorized.map((u) => {
                      const profile = profileFor(u.email);
                      return (
                        <tr key={u.id} className="border-t border-surface-border">
                          <td className="px-3 py-2">{u.email}</td>
                          <td className="px-3 py-2 text-gray-400">{u.display_name ?? profile?.display_name ?? '—'}</td>
                          <td className="px-3 py-2">
                            <select
                              value={profile?.role ?? u.role}
                              disabled={!profile}
                              title={!profile ? 'Ще е налично след първо влизане' : undefined}
                              onChange={async (e) => {
                                if (!profile) return;
                                await setUserRole(profile.id, e.target.value as 'admin' | 'user');
                                load();
                              }}
                              className="input !w-auto !py-1"
                            >
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <span className={u.is_active ? 'text-green-400' : 'text-gray-500'}>
                              {u.is_active ? 'активен' : 'деактивиран'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-500">{formatRelativeTime(u.created_at)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className="btn-ghost !px-2 !py-1 text-xs"
                              onClick={async () => {
                                await setUserActive(u.email, !u.is_active);
                                load();
                              }}
                            >
                              {u.is_active ? 'Деактивирай' : 'Активирай'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-300">Последни системни грешки</h2>
              {stats && stats.recentErrors.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {stats.recentErrors.map((e) => (
                    <li key={e.id} className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-xs">
                      <span className="text-gray-500">{formatRelativeTime(e.created_at)}</span>{' '}
                      <span className="font-medium text-gray-300">[{e.source}]</span>{' '}
                      <span className="text-gray-400">{e.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">Няма скорошни грешки.</p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
