// Shared CORS handling for every edge function. Only the production origin
// and localhost dev origins are allowed — this is defense in depth, not the
// primary access control (that's JWT auth + RLS), but it stops random pages
// from driving authenticated browser requests against these endpoints.
const ALLOWED_ORIGINS = new Set([
  'https://hah.todorovtees.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://hah.todorovtees.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req.headers.get('origin')) });
  }
  return null;
}
