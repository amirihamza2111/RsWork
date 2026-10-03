const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

// Service-role client: Auth admin, Storage writes and Realtime broadcasts.
// Never expose this key to the browser.
const supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabaseAdmin };
