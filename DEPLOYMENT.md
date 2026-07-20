# RsWork — Deployment Guide

Production stack:

```
  Diners' phones / staff devices
            │  HTTPS
            ▼
   Netlify ──────────►  frontend (Vite SPA, PWA)
            │  XHR + WebSocket (CORS-allowlisted)
            ▼
   Render  ──────────►  rswork-api   (Node/Express + Socket.IO)  ──►  MongoDB Atlas
            └─────────►  rswork-ml    (FastAPI forecast service, internal)
```

Everything is env-driven; **no secret is committed** (`.gitignore` blocks `.env*`).
Templates: `backend/.env.production.example`, `frontend/.env.production.example`.

---

## 0. Accounts you need (all have free tiers)
MongoDB Atlas · Render · Netlify · Stripe · Cloudinary · Resend · Groq · Sentry (optional).

---

## 1. MongoDB Atlas
1. Create a cluster (M0 works to launch; **M10** recommended for real traffic).
2. **Database Access** → add a user (username + password).
3. **Network Access** → allow `0.0.0.0/0` (Render/Netlify are dynamic-IP) or Render's egress IPs.
4. Copy the **SRV connection string**; append the DB name, e.g. `.../rswork?retryWrites=true&w=majority`. This is `DB_URI`.
5. Seed once (from your machine, pointing at the prod DB): `cd backend && DB_URI="<prod>" npm run seed && DB_URI="<prod>" npm run seed:menu`.

## 2. Render (backend API + forecast service)
1. Push this repo to GitHub (`main`).
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml` and creates **rswork-api** + **rswork-ml**.
3. On **rswork-api**, open **Environment** and paste the `sync:false` secrets from `backend/.env.production.example` (`DB_URI`, Stripe, Cloudinary, Resend, Groq, VAPID, Sentry). Leave `CLIENT_URL`/`CORS_ORIGINS` for step 4.
4. Deploy. Health check: `https://rswork-api.onrender.com/health` → `{"success":true}`.

## 3. Netlify (frontend)
1. Netlify → **Add new site → Import an existing project** → GitHub → pick the repo.
2. Build settings come from the repo-root **`netlify.toml`** (base `frontend`, command `npm run build`, publish `frontend/dist`, SPA redirects) — don't override them in the UI.
3. **Environment variables** (Site configuration → Environment variables — set them BEFORE the first deploy; Vite inlines them at build time):
   - `VITE_API_URL` = your Render API URL (`https://rswork-api.onrender.com`)
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
- [ ] Order appears on the KDS in real time (Socket.IO connected — "Live").
- [ ] Cashier settles cash + prints receipt; diner card payment succeeds (Stripe test card first).
- [ ] Set the restaurant **geofence** (Settings → Use my current location) if you want location-gated ordering.

---

## Known free-tier caveats (not blockers)
- **Render free** spins down after ~15 min idle → first request cold-starts (~50s). Upgrade to a paid instance to keep it warm.
- **Rate limiter, menu micro-cache, and waiter-section state are in-memory** (single instance). If you scale to multiple instances, move them to **Upstash Redis** (`express-rate-limit` + `rate-limit-redis`, and swap `utils/microCache.js`).
- **Resend** only sends to arbitrary addresses once you verify a domain; until then it delivers to the account owner only.
- **Atlas M0** is fine for pilots; upgrade to **M10** before real concurrent traffic (see the k6 report — writes are the ceiling, reads are cached).
