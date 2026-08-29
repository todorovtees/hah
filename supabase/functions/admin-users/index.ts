// POST /functions/v1/admin-users
// Body: { action: 'list' | 'set_active' | 'set_role' | 'invite' | 'stats', ...params }
//
// Every admin-only write in the spec (activate/deactivate a user, change a
// role, view system logs/usage) goes through here rather than through
// direct table access, per section 10/27: "Административните операции
// трябва да се изпълняват server-side." This function is the only thing
// with a reason to write to authorized_users or profiles.role.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// This file is intentionally self-contained (no imports from ../_shared) —
// see the comment at the top of ../chat/index.ts for why.

// ---------------------------------------------------------------------------
// Shared: CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set([
  'https://hah.todorovtees.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://hah.todorovtees.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req.headers.get('origin')) });
  return null;
}

// ---------------------------------------------------------------------------
// Shared: auth
// ---------------------------------------------------------------------------
interface AuthedContext {
  admin: SupabaseClient;
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
  }
}

async function requireUser(req: Request): Promise<AuthedContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new AuthError('Missing Authorization header', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new AuthError('Server misconfigured', 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) throw new AuthError('Invalid or expired session', 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', userData.user.id)
    .single();
  if (profileError || !profile) throw new AuthError('Account is not authorized', 403);

  return { admin, userId: userData.user.id, email: profile.email, role: profile.role as 'admin' | 'user' };
}

function requireAdmin(ctx: AuthedContext): void {
  if (ctx.role !== 'admin') throw new AuthError('Admin access required', 403);
}

// ---------------------------------------------------------------------------
// /admin-users — endpoint-specific logic
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' };

  let ctx: AuthedContext;
  try {
    ctx = await requireUser(req);
    requireAdmin(ctx);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: err instanceof AuthError ? err.status : 403,
      headers,
    });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    switch (action) {
      case 'list': {
        const [{ data: authorized }, { data: profiles }] = await Promise.all([
          ctx.admin.from('authorized_users').select('*').order('created_at', { ascending: false }),
          ctx.admin.from('profiles').select('id, email, role, display_name, created_at'),
        ]);
        return new Response(JSON.stringify({ authorized, profiles }), { headers });
      }

      case 'invite': {
        const { email, displayName, role = 'user' } = body;
        if (!email || typeof email !== 'string') {
          return new Response(JSON.stringify({ error: 'email is required' }), { status: 400, headers });
        }
        if (role !== 'admin' && role !== 'user') {
          return new Response(JSON.stringify({ error: 'role must be admin or user' }), { status: 400, headers });
        }

        const { error: upsertError } = await ctx.admin
          .from('authorized_users')
          .upsert({ email: email.toLowerCase(), display_name: displayName ?? null, role, is_active: true }, {
            onConflict: 'email',
          });
        if (upsertError) throw upsertError;

        // Triggers Supabase Auth's invite email; handle_new_user() picks up
        // the authorized_users row created above once the user accepts.
        const { error: inviteError } = await ctx.admin.auth.admin.inviteUserByEmail(email);
        if (inviteError && inviteError.message && !inviteError.message.includes('already been registered')) {
          throw inviteError;
        }

        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      case 'set_active': {
        const { email, isActive } = body;
        if (!email || typeof isActive !== 'boolean') {
          return new Response(JSON.stringify({ error: 'email and isActive are required' }), {
            status: 400,
            headers,
          });
        }
        const { error } = await ctx.admin
          .from('authorized_users')
          .update({ is_active: isActive })
          .eq('email', email.toLowerCase());
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      case 'set_role': {
        const { userId, role } = body;
        if (!userId || (role !== 'admin' && role !== 'user')) {
          return new Response(JSON.stringify({ error: 'userId and a valid role are required' }), {
            status: 400,
            headers,
          });
        }
        // Update both: profiles.role governs live access, authorized_users
        // keeps the allowlist consistent for the next time this person logs
        // in / is looked up.
        const { data: profile, error: profileError } = await ctx.admin
          .from('profiles')
          .update({ role })
          .eq('id', userId)
          .select('email')
          .single();
        if (profileError) throw profileError;
        if (profile?.email) {
          await ctx.admin.from('authorized_users').update({ role }).eq('email', profile.email);
        }
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      case 'stats': {
        const [{ count: userCount }, { count: conversationCount }, { count: last24hRequests }, { data: errors }] =
          await Promise.all([
            ctx.admin.from('profiles').select('*', { count: 'exact', head: true }),
            ctx.admin.from('conversations').select('*', { count: 'exact', head: true }),
            ctx.admin
              .from('usage_logs')
              .select('*', { count: 'exact', head: true })
              .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
            ctx.admin
              .from('system_logs')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(50),
          ]);
        return new Response(
          JSON.stringify({ userCount, conversationCount, last24hRequests, recentErrors: errors }),
          { headers },
        );
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers,
    });
  }
});
