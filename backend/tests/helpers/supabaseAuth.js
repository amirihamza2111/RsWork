// Test-side Supabase Auth helpers: sign in / verify OTPs the way the browser
// does, returning the access token to send to the API as a Bearer token.
const { createClient } = require('@supabase/supabase-js');
const config = require('../../config');

const newAuthClient = () =>
  createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signIn(email, password) {
  const client = newAuthClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { client, error, token: data?.session?.access_token ?? null };
}

async function verifyEmailOtp(email, otp) {
  const client = newAuthClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: otp, type: 'email' });
  return { client, error, token: data?.session?.access_token ?? null };
}

async function verifyRecovery(tokenHash) {
  const client = newAuthClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  return { client, error, token: data?.session?.access_token ?? null };
}

module.exports = { signIn, verifyEmailOtp, verifyRecovery };
