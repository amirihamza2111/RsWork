# RsWork — Deployment Guide

Production stack:

```
  Diners' phones / staff devices
            │  HTTPS
            ▼
   Netlify ──────────►  frontend (Vite SPA)
            │  supabase-js (Auth, PostgREST, Realtime, Storage, Functions)
            ▼
   Supabase ─────────►  Postgres + RLS + RPCs · Auth · Realtime · Storage · Edge Functions
            │                                   │
            └──── Stripe webhook ───────────────┘     ai-report ──► Groq / Gemini
                                                       ai-report ──► Render: rswork-ml (FastAPI)
```

There is no API server to host: everything that used to live in Express is in
Postgres functions or Edge Functions. **No secret is committed** (`.gitignore`
blocks `.env*`); templates: `.env.example`, `frontend/.env.production.example`.

---

## 0. Accounts (all have free tiers)
Supabase · Netlify · Render (ML service only) · Stripe · Resend (SMTP) · Groq · Sentry (optional).

## 1. Supabase
1. Create a project (e.g. `eu-west-1`).
2. Apply `supabase/migrations/*.sql` in order — SQL editor, or `supabase link --project-ref <ref>` then `supabase db push`.
3. Deploy the functions: `supabase functions deploy staff-admin stripe-intent stripe-webhook ai-report --no-verify-jwt`
   (they verify callers themselves; the platform JWT check doesn't understand the new API keys).
4. **Edge Functions → Secrets**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY` (default `usd`), `AI_PROVIDER` (`groq`/`gemini`), `GROQ_API_KEY` or `GEMINI_API_KEY`, `ML_SERVICE_URL` (from step 2).
5. **Authentication**
   - *Sign In / Providers → Email*: keep **Confirm email** on.
   - *SMTP*: custom SMTP with Resend (host `smtp.resend.com`, port 465, user `resend`, password = Resend API key, sender on your verified domain). Without it Supabase only emails your own team.
   - *Emails → Confirm signup*: include the code, e.g. `Your RsWork code: {{ .Token }}`.
   - *URL Configuration*: Site URL = the Netlify domain; redirect URLs: `https://<domain>/reset-password`.
6. Seed once from your machine: fill the repo-root `.env` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) and run `npm install && npm run seed`.

> Free-tier note: Supabase pauses a free project after ~1 week without activity; resume it
> from the dashboard. Any regular traffic keeps it active.

## 2. Render (forecast service)
1. Render → **New → Blueprint** → pick the repo; `render.yaml` creates **rswork-ml**.
2. Health check: `https://rswork-ml.onrender.com/health`. Put its URL in the `ML_SERVICE_URL` function secret.
   The free instance sleeps when idle; the AI report falls back to a built-in forecast if it doesn't answer within 4 s.

## 3. Netlify (frontend)
1. **Add new site → Import an existing project** → pick the repo. `netlify.toml` sets base `frontend`, build `npm run build`, publish `dist`, SPA redirects.
2. **Environment variables** (before the first build — Vite inlines them):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_STRIPE_PUBLISHABLE_KEY` (optional — enables online card payment)
   - `VITE_SENTRY_DSN` (optional)
3. Deploy, then set the Supabase Site URL (step 1.5) to the Netlify domain. Table QR codes are generated in the browser from the current domain, so they're correct automatically.

## 4. Stripe (card payments)
1. **Developers → Webhooks → Add endpoint**: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events `payment_intent.succeeded` and `payment_intent.payment_failed`.
2. Copy the signing secret into the `STRIPE_WEBHOOK_SECRET` function secret; set `STRIPE_SECRET_KEY` there and `VITE_STRIPE_PUBLISHABLE_KEY` on Netlify.

## 5. Post-deploy smoke test
- [ ] `npm test` (repo root) passes against the project.
- [ ] Manager login works; dashboard loads; AI report PDF downloads.
- [ ] Scan a table QR on a phone → menu loads (FR/EN/AR), place an order.
- [ ] Order appears on the KDS in real time ("Live" badge).
- [ ] Cashier settles cash + downloads the receipt; a Stripe test card payment succeeds.
- [ ] Set the restaurant **geofence** (Settings → Use my current location) if you want location-gated ordering.

## Known caveats
- Realtime delivers broadcasts while clients are connected; screens also poll every 15 s as a safety net.
- The Supabase security advisor lists the RPC functions as callable `SECURITY DEFINER` functions — intentional: they are the API, and each one authorizes its caller.
- Storage image transforms are a paid feature, so the browser resizes photos to WebP before upload.
