import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AuthedContext {
  /** Service-role client — bypasses RLS. Only ever used server-side. */
  admin: SupabaseClient;
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
  }
}

/**
 * Verifies the caller's JWT (passed through by the Supabase gateway when
 * verify_jwt = true, but we re-derive the user explicitly so we also get
 * their role from `profiles` in the same call), then confirms a profile row
 * exists for them. A missing profile means either they were never on the
 * allowlist or an admin has since deactivated them — either way, reject.
 */
export async function requireUser(req: Request): Promise<AuthedContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new AuthError('Missing Authorization header', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new AuthError('Server misconfigured', 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    throw new AuthError('Invalid or expired session', 401);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new AuthError('Account is not authorized', 403);
  }

  return {
    admin,
    userId: userData.user.id,
    email: profile.email,
    role: profile.role as 'admin' | 'user',
  };
}

export function requireAdmin(ctx: AuthedContext): void {
  if (ctx.role !== 'admin') {
    throw new AuthError('Admin access required', 403);
  }
}
