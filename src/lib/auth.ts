import { supabase } from './supabase';
import type { Profile } from '@/types';

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Loads the caller's own profile row. Returns null (rather than throwing) if
 * no profile exists — that's the expected state for an authenticated
 * Supabase user whose email was never on the allowlist, or who was
 * deactivated after their profile was created but before authorized_users
 * was re-synced; see handle_new_user() in the migrations.
 */
export async function fetchOwnProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}
