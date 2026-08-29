import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function logUsage(
  admin: SupabaseClient,
  entry: {
    userId: string | null;
    requestType: string;
    model?: string;
    inputSize?: number;
    outputSize?: number;
    durationMs?: number;
    status: 'success' | 'error' | 'rate_limited';
    errorCode?: string;
  },
): Promise<void> {
  const { error } = await admin.from('usage_logs').insert({
    user_id: entry.userId,
    request_type: entry.requestType,
    model: entry.model ?? null,
    input_size: entry.inputSize ?? null,
    output_size: entry.outputSize ?? null,
    duration_ms: entry.durationMs ?? null,
    status: entry.status,
    error_code: entry.errorCode ?? null,
  });
  // Logging must never take down the request it's logging for.
  if (error) console.error('logUsage failed', error.message);
}

export async function logSystemError(
  admin: SupabaseClient,
  source: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('system_logs').insert({
    level: 'error',
    source,
    message,
    metadata: metadata ?? null,
  });
  if (error) console.error('logSystemError failed', error.message);
}
