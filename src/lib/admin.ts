import { supabase } from './supabase';
import type { AuthorizedUser, Profile } from '@/types';

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // supabase-js surfaces non-2xx as a generic FunctionsHttpError; the
    // actual message is on the response body, which the client already
    // parsed for us here.
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  return data as T;
}

export function listUsers() {
  return invokeAdmin<{ authorized: AuthorizedUser[]; profiles: Profile[] }>({ action: 'list' });
}

export function inviteUser(email: string, displayName: string, role: 'admin' | 'user') {
  return invokeAdmin<{ ok: true }>({ action: 'invite', email, displayName, role });
}

export function setUserActive(email: string, isActive: boolean) {
  return invokeAdmin<{ ok: true }>({ action: 'set_active', email, isActive });
}

export function setUserRole(userId: string, role: 'admin' | 'user') {
  return invokeAdmin<{ ok: true }>({ action: 'set_role', userId, role });
}

export interface AdminStats {
  userCount: number;
  conversationCount: number;
  last24hRequests: number;
  recentErrors: { id: number; level: string; source: string; message: string; created_at: string }[];
}

export function fetchStats() {
  return invokeAdmin<AdminStats>({ action: 'stats' });
}
