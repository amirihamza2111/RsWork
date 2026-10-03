# RsWork — Deployment Guide

Production stack:

```
  Diners' phones / staff devices
            │  HTTPS
            ▼
   Netlify ──────────►  frontend (Vite SPA, PWA) ──Auth + Realtime──►  Supabase
            │  XHR (CORS-allowlisted)                                  ▲
            ▼                                                          │
   Render  ──────────►  rswork-api   (Node/Express) ──SQL / Auth admin / Storage / Broadcast
            └─────────►  rswork-ml    (FastAPI forecast service, internal)
```

Everything is env-driven; **no secret is committed** (`.gitignore` blocks `.env*`).
Templates: `backend/.env.production.example`, `frontend/.env.production.example`.

---

## 0. Accounts you need (all have free tiers)
Supabase · Render · Netlify · Stripe · Resend · Groq · Sentry (optional).

---

## 1. Supabase
1. Create a project (pick the region closest to Render, e.g. `eu-west-1` / Frankfurt).
2. Apply `supabase/migrations/*.sql` in order (SQL editor, or `supabase link` + `supabase db push`).
   This creates the schema, RLS policies, Realtime channel authorization and the `menu-images` bucket.
3. **Authentication → Sign In / Providers → Email**: keep **Confirm email** on.
4. **Authentication → URL Configuration**: set the Site URL to the Netlify domain.
5. Collect the values for the API:
   - `SUPABASE_URL` — Project Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API keys (secret key). Server only.
   - `SUPABASE_DB_URL` — **Connect → Transaction pooler** connection string (port 6543).
   - For the frontend: the **publishable** key (`sb_publishable_…`).
6. Seed once from your machine with those env vars set: `cd backend && npm run seed && npm run seed:menu`.

> Free-tier note: Supabase pauses a free project after ~1 week without activity; resume it
> from the dashboard. Any regular traffic (or a weekly ping) keeps it active.

## 2. Render (backend API + forecast service)
1. Push this repo to GitHub (`main`).
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml` and creates **rswork-api** + **rswork-ml**.
3. On **rswork-api**, open **Environment** and paste the `sync:false` secrets from `backend/.env.production.example` (`SUPABASE_*`, Stripe, Resend, Groq, VAPID, Sentry). Leave `CLIENT_URL`/`CORS_ORIGINS` for step 4.
4. Deploy. Health check: `https://rswork-api.onrender.com/health` → `{"success":true}`.

## 3. Netlify (frontend)
1. Netlify → **Add new site → Import an existing project** → GitHub → pick the repo.
2. Build settings come from the repo-root **`netlify.toml`** (base `frontend`, command `npm run build`, publish `frontend/dist`, SPA redirects) — don't override them in the UI.
3. **Environment variables** (Site configuration → Environment variables — set them BEFORE the first deploy; Vite inlines them at build time):
   - `VITE_API_URL` = your Render API URL (`https://rswork-api.onrender.com`)
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` = the project URL + publishable key
   - `VITE_VAPID_PUBLIC_KEY` = same value as backend `VAPID_PUBLIC_KEY`
   - `VITE_SENTRY_DSN` = frontend Sentry DSN (optional)
4. Deploy → note the domain, e.g. `https://rswork.netlify.app` (rename under Site configuration → Change site name, or attach a custom domain). Every push to `main` auto-deploys.

## 4. Wire the two together (then redeploy each)
- **Render → rswork-api env:** set `CLIENT_URL` and `CORS_ORIGINS` to the Netlify domain, then redeploy.
- **Netlify:** confirm `VITE_API_URL` points at Render; if you changed an env var, **Deploys → Trigger deploy → Clear cache and deploy site** (env changes need a rebuild).
- **Regenerate QR codes:** log in as manager → **Tables → Regenerate QR** so every table QR points at the live `CLIENT_URL`.

## 5. Stripe (live card payments)
1. Stripe dashboard → **Developers → Webhooks → Add endpoint**: `https://rswork-api.onrender.com/api/payments/webhook`, event `payment_intent.succeeded` (+ `payment_intent.payment_failed`).
2. Copy the signing secret → set `STRIPE_WEBHOOK_SECRET` on Render.
3. Set `STRIPE_SECRET_KEY` (`sk_live_…`) + `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`). Card UI activates automatically once the publishable key is present.

## 6. Post-deploy smoke test
- [ ] `/health` on both Render services returns OK.
- [ ] Manager login works; dashboard loads; AI report downloads.
- [ ] Scan a table QR on a phone → menu loads (FR/EN/AR), place an order.
- [ ] Order appears on the KDS in real time (Realtime channel subscribed — "Live").
- [ ] Cashier settles cash + prints receipt; diner card payment succeeds (Stripe test card first).
- [ ] Set the restaurant **geofence** (Settings → Use my current location) if you want location-gated ordering.

---

## Known free-tier caveats (not blockers)
- **Render free** spins down after ~15 min idle → first request cold-starts (~50s). Upgrade to a paid instance to keep it warm.
- **Rate limiter and menu micro-cache are in-memory** (single instance). If you scale to multiple instances, move them to **Upstash Redis** (`express-rate-limit` + `rate-limit-redis`, and swap `utils/microCache.js`). Waiter presence already lives in Postgres.
- **Resend** only sends to arbitrary addresses once you verify a domain; until then it delivers to the account owner only. Verification codes and reset links are sent through Resend, not Supabase's built-in mailer.
- **Supabase free** pauses after a week of inactivity (see §1); Storage image transforms are a paid feature, so the API resizes uploads itself.
