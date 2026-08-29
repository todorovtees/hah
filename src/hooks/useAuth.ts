import { createContext, useContext } from 'react';
import type { Profile } from '@/types';
import type { Session } from '@supabase/supabase-js';

export interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True once we've checked and the signed-in user has no profile row, i.e. is not on the allowlist / is deactivated. */
  unauthorized: boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
