-- Supabase's auto-RLS event trigger function lives in the exposed schema; client
-- roles never need to call it (event triggers fire regardless of EXECUTE grants).
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
