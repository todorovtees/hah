import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FullScreenSpinner } from './Spinner';

export function ProtectedRoute() {
  const { session, profile, loading, unauthorized } = useAuth();

  if (loading) return <FullScreenSpinner label="Зареждане…" />;
  if (!session) return <Navigate to="/login" replace />;

  if (unauthorized || !profile) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-gray-300">
        <h1 className="text-lg font-semibold text-white">Нямате достъп</h1>
        <p className="max-w-sm text-sm text-gray-400">
          Профилът Ви не е активиран за HAH, или достъпът Ви е деактивиран. Свържете се с администратор.
        </p>
      </div>
    );
  }

  return <Outlet />;
}
