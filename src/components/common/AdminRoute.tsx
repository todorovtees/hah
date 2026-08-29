import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FullScreenSpinner } from './Spinner';

export function AdminRoute() {
  const { profile, loading } = useAuth();

  if (loading) return <FullScreenSpinner label="Зареждане…" />;
  if (!profile || profile.role !== 'admin') return <Navigate to="/" replace />;

  return <Outlet />;
}
