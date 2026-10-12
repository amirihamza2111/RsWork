import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Vite inlines VITE_* variables at build time, so a deploy built without them
// cannot work: say exactly what to fix instead of failing deeper inside supabase-js.
if (!url || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing from this build. ' +
      'Set them (frontend/.env.local locally, or the hosting provider’s environment variables) and rebuild.'
  )
}

// Browser client: Supabase Auth sessions, table queries under RLS, RPCs,
// Realtime and Storage. The publishable key is safe to ship to the browser.
export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rswork_auth' },
})
