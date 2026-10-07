import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in the repo-root .env')
  process.exit(1)
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

// Service-role client: Auth admin and RLS-bypassing fixtures.
export const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, noSession)

// A fresh browser-equivalent client (anonymous until signed in).
export const publicClient = () => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, noSession)

export async function signedIn(email, password) {
  const client = publicClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`)
  return client
}

export function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}
