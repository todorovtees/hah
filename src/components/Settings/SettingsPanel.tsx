import { useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export function SettingsPanel() {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!profile) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', profile!.id);
      if (error) throw error;
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Профил</h2>
        <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
          <label className="text-xs text-gray-400">
            Име
            <input className="input mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="text-xs text-gray-400">
            Имейл
            <input className="input mt-1 opacity-60" value={profile.email} disabled />
          </label>
          <button type="submit" disabled={saving} className="btn-primary mt-1 w-fit">
            {saving ? 'Запазване…' : saved ? 'Запазено ✓' : 'Запази'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Роля</h2>
        <p className="text-sm text-gray-400">
          {profile.role === 'admin' ? 'Администратор' : 'Потребител'} — ролята се управлява от администратор.
        </p>
      </section>
    </div>
  );
}
