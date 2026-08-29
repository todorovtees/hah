import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Tunable per request_type. Kept in code (not a DB config table) so a limit
// change is reviewed like any other code change; promote to a `settings`
// table later if admins need to tune this without a redeploy.
const LIMITS: Record<string, { windowSeconds: number; max: number }> = {
  chat: { windowSeconds: 60, max: 20 },
  search: { windowSeconds: 60, max: 20 },
  'process-file': { windowSeconds: 3600, max: 30 },
};

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Rate limit exceeded');
  }
}

export async function enforceRateLimit(
  admin: SupabaseClient,
  userId: string,
  requestType: keyof typeof LIMITS,
): Promise<void> {
  const limit = LIMITS[requestType];
  if (!limit) return;

  const { data, error } = await admin.rpc('count_recent_usage', {
    p_user_id: userId,
    p_request_type: requestType,
    p_window_seconds: limit.windowSeconds,
  });

  if (error) {
    // Fail open on a logging/infra error rather than blocking every user,
    // but record it so it's visible on the admin dashboard.
    await admin.from('system_logs').insert({
      level: 'error',
      source: 'rateLimit',
      message: 'count_recent_usage failed',
      metadata: { error: error.message, userId, requestType },
    });
    return;
  }

  if ((data as number) >= limit.max) {
    throw new RateLimitError(limit.windowSeconds);
  }
}
