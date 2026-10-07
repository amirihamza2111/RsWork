import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

const url = Deno.env.get('SUPABASE_URL')!;

// New-style keys come as JSON maps; fall back to the legacy single keys.
const fromKeyMap = (name: string) => {
  try {
    return (JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>).default;
  } catch {
    return undefined;
  }
};
const secretKey = fromKeyMap('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publishableKey = fromKeyMap('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// Bypasses RLS — only for work the caller has already been authorized for.
export const admin: SupabaseClient = createClient(url, secretKey, noSession);

// Acts as the signed-in user, so RPC/RLS authorization applies.
export const asUser = (token: string): SupabaseClient =>
  createClient(url, publishableKey, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

export interface Caller {
  id: string;
  token: string;
}

// Verifies the user's access token (JWKS, cached); null when anonymous.
export async function getCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // The publishable key (sent when signed out) is not a JWT.
  if (token.split('.').length !== 3) return null;
  const { data, error } = await admin.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, token };
}

export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await getCaller(req);
  if (!caller) throw new HttpError(401, 'Not authorized');
  return caller;
}
