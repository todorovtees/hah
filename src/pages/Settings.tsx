import { Link } from 'react-router-dom';
import { SettingsPanel } from '@/components/Settings/SettingsPanel';

export default function Settings() {
  return (
    <div className="min-h-screen bg-surface text-gray-100">
      <header className="flex items-center gap-3 border-b border-surface-border px-4 py-3">
        <Link to="/" className="btn-ghost !px-2" aria-label="Обратно към чата">
          ←
        </Link>
        <h1 className="text-sm font-semibold">Настройки</h1>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <SettingsPanel />
      </main>
    </div>
  );
}
