import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  console.error('[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set')
}

// Browser client: Supabase Auth sessions + Realtime. Data access goes through
// the RsWork API; RLS keeps the publishable key from reading tenant tables.
export const supabase = createClient(url ?? '', publishableKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rswork_auth' },
})
