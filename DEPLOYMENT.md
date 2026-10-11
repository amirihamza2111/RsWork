# RsWork — Deployment Guide

Production stack:

```
  Diners' phones / staff devices
            │  HTTPS
            ▼
   Vercel ───────────►  frontend (Vite SPA)
            │  supabase-js (Auth, PostgREST, Realtime, Storage, Functions)
            ▼
   Supabase ─────────►  Postgres + RLS + RPCs · Auth · Realtime · Storage · Edge Functions
            │                                   │
            └──── Stripe webhook ───────────────┘     ai-report ──► Groq / Gemini
                                                       ai-report ──► Render: rswork-ml (FastAPI)
```

There is no API server to host: everything that used to live in Express is in
Postgres functions or Edge Functions. The app sends no email. **No secret is
committed** (`.gitignore` blocks `.env*`); templates: `.env.example`,
`frontend/.env.production.example`.

---

## 0. Accounts (all have free tiers)
Supabase · Vercel · Render (ML service only) · Groq · Stripe (optional, test mode) · cron-job.org (keep-alive).

## 1. Supabase
1. Create a project (e.g. `eu-west-1`).
2. Apply `supabase/migrations/*.sql` in order — SQL editor, or `supabase link --project-ref <ref>` then `supabase db push`.
3. Deploy the functions: `supabase functions deploy staff-admin stripe-intent stripe-webhook ai-report --no-verify-jwt`
   (they verify callers themselves; the platform JWT check doesn't understand the new API keys).
4. **Edge Functions → Secrets**: `AI_PROVIDER` (`groq`/`gemini`), `GROQ_API_KEY` or `GEMINI_API_KEY`, `ML_SERVICE_URL` (step 2),
   optionally `AI_MODEL` to override the default model, and for card payments `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`.
5. **Authentication**
   - *Sign In / Providers → Email*: turn **Confirm email** off. Owners are signed in right after registering; managers set and reset staff passwords from the Staff page.
   - *URL Configuration*: Site URL = the Vercel domain.
6. Seed once from your machine: fill the repo-root `.env` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) and run `npm install && npm run seed`.

> Free-tier note: Supabase pauses a free project after ~1 week without activity. A daily
> keep-alive request (step 5) prevents it.

## 2. Render (forecast service)
1. Render → **New → Web Service** (or **Blueprint** with `render.yaml`): root directory `ml-service`,
   build `pip install -r requirements.txt`, start `uvicorn app:app --host 0.0.0.0 --port $PORT`, health check `/health`.
2. Check `https://<service>.onrender.com/health`, then put its URL in the `ML_SERVICE_URL` function secret.
   The free instance sleeps after 15 minutes idle; the AI report falls back to a built-in forecast if it doesn't answer within 4 s (see step 5).

## 3. Vercel (frontend)
1. **Add New → Project** → import the repo, set **Root Directory** to `frontend`. `frontend/vercel.json` sets the Vite build, `dist` output, SPA rewrites and asset caching.
2. **Environment Variables** (before the first build — Vite inlines them):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_STRIPE_PUBLISHABLE_KEY` (optional — enables online card payment)
3. Deploy, then set the Supabase Site URL (step 1.5) to the Vercel domain. Table QR codes are generated in the browser from the current domain, so they're correct automatically.

## 4. Stripe (card payments, optional)
1. **Developers → Webhooks → Add endpoint**: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events `payment_intent.succeeded` and `payment_intent.payment_failed`.
2. Copy the signing secret into the `STRIPE_WEBHOOK_SECRET` function secret; set `STRIPE_SECRET_KEY` there and `VITE_STRIPE_PUBLISHABLE_KEY` on Vercel.

## 5. Keep-alive (cron-job.org)
- Every 10 minutes: `GET https://<service>.onrender.com/health` (keeps the forecast service warm).
- Daily: `GET https://<project-ref>.supabase.co/rest/v1/categories?select=id&limit=1` with header `apikey: <publishable key>` (keeps the Supabase project active).

## 6. Post-deploy smoke test
- [ ] `npm test` (repo root) passes against the project.
- [ ] Register a restaurant → lands on the dashboard; manager login works; AI report PDF downloads.
- [ ] Scan a table QR on a phone → menu loads (FR/EN/AR), place an order.
- [ ] Order appears on the KDS in real time ("Live" badge).
- [ ] Cashier settles cash + downloads the receipt; the table goes back to "available" once served and paid.
- [ ] Set the restaurant **geofence** (Settings → Use my current location) if you want location-gated ordering.

## Known caveats
- Realtime delivers broadcasts while clients are connected; screens poll every 60 s as a safety net (every 10 s while disconnected).
- The Supabase security advisor lists the RPC functions as callable `SECURITY DEFINER` functions — intentional: they are the API, and each one authorizes its caller.
- Storage image transforms are a paid feature, so the browser resizes photos to WebP before upload.
