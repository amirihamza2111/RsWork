# RsWork

A QR-based **restaurant management platform** by **Nerovex**. A diner scans the QR on their table, orders from a multilingual menu, and tracks their meal in real time; the kitchen works a live KDS board, waiters are notified when food is ready, the cashier settles the bill (cash or card), and the owner gets a BI dashboard with ML-powered forecasting and an AI-written report.

## Architecture

**No custom API server.** The React app talks to Supabase directly; business rules
live in Postgres, and the few things that need secrets run as Edge Functions.

```
RsWork/
├── frontend/              React + Vite SPA (manager dashboard, KDS, waiter, cashier, diner)
├── supabase/
│   ├── migrations/        schema, RLS, RPC functions, Realtime authorization, Storage
│   └── functions/         Edge Functions: staff-admin, stripe-intent, stripe-webhook, ai-report
├── ml-service/            Python + FastAPI forecasting microservice (Holt-Winters)
├── scripts/seed.mjs       demo data (restaurant, logins, menu + photos, tables, 90-day history)
│   └── assets/menu/       demo menu photos (WebP), uploaded to Supabase Storage by the seed
└── tests/                 end-to-end checks against the Supabase project
```

```
             ┌──────────── Supabase ─────────────────────────────────────────┐
 Browser ───►│ Auth        email/password sign-up and sign-in               │
  (React)    │ PostgREST   table reads/writes under RLS + RPC functions       │
             │ Realtime    broadcast channels  restaurant:<id> / table:<id>   │
             │ Storage     menu-images/<restaurant_id>/…                      │
             │ Edge Fns    staff-admin · stripe-intent · ai-report ──► Groq,  │
             │             stripe-webhook ◄── Stripe          ML service ────┤
             └────────────────────────────────────────────────────────────────┘
```

| Concern | Where it lives |
|---|---|
| Menu, tables, staff list, payments, feedback | Table queries guarded by **Row Level Security** |
| Ordering, KDS, claims, payments, sections, reports | `security definer` **RPC functions** that authorize the caller (`auth.uid()`, role, restaurant) |
| Live screens | RPCs publish **Realtime Broadcast** events; staff channels are private (RLS on `realtime.messages`), diner table channels carry no PII |
| Sign-up / onboarding | Supabase Auth + an `auth.users` trigger that creates the profile (and the restaurant for owners) — roles are never read from user-editable metadata |
| Staff accounts, Stripe, AI narrative | **Edge Functions** (Auth admin API, Stripe secret, LLM key) |
| QR codes, receipts, BI report PDF | Generated in the browser (`qrcode`, PDFKit) |

Highlights:
- Normalized schema (`orders` ⇄ `order_items`) with FK cascades, CHECK constraints and a trigger that issues `ORD-YYYYMMDD-NNNN` numbers.
- Race-free workflows: row locks (`SELECT … FOR UPDATE`) around order placement, waiter claims, KDS roll-ups and cash settlement; anti-abuse caps (open orders / open tab per table) can't be raced.
- Server-side pricing: the diner sends item ids and quantities; prices, availability, the QR session and the geofence are checked in `place_order`.
- Analytics are plain SQL (`GROUP BY`, `generate_series`, window over 90 days of history) feeding a Holt-Winters forecast with a seasonal-naive fallback.

## Tech stack

| Area | Tech |
|------|------|
| Frontend | React 19, Vite, TanStack Query, Tailwind, Recharts |
| Database | Supabase Postgres 17 — RLS, plpgsql RPCs, triggers |
| Auth | Supabase Auth (email/password; no email delivery — managers reset staff passwords) |
| Realtime | Supabase Realtime Broadcast |
| Media | Supabase Storage (images resized to WebP in the browser) |
| Server code | Supabase Edge Functions (Deno) |
| Payments | Stripe (cards) + cash, with Stripe webhook |
| PDFs | PDFKit browser build (thermal receipt + BI report) |
| ML | Python, FastAPI, pure-Python Holt-Winters + rolling-origin CV |
| AI report | Groq / Gemini (provider-agnostic), template fallback |
| Tests | `node:test` + supabase-js (end-to-end), `deno test` (functions) |

## Getting started

### 1. Supabase
1. Create a project and apply `supabase/migrations/*.sql` in order (SQL editor, or `supabase link` + `supabase db push`).
2. Deploy the Edge Functions in `supabase/functions/` (`supabase functions deploy --no-verify-jwt <name>` — each function authorizes callers itself).
3. **Authentication → Sign In / Providers → Email**: turn **Confirm email** off. The app sends no email: owners are signed in right after registering, and managers set or reset staff passwords from the Staff page.
4. **Authentication → URL Configuration**: Site URL = your frontend URL (`http://localhost:5173` locally).
5. Optional **Edge Function secrets**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `AI_PROVIDER` + `GROQ_API_KEY`/`GEMINI_API_KEY`, `ML_SERVICE_URL`.

### 2. Seed data and tests (repo root)
```bash
cp .env.example .env     # SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
npm install
npm run seed             # demo restaurant, logins, menu photos, tables, 90-day history (re-run to top up)
npm test                 # end-to-end suite (creates and deletes its own fixtures)
npm run test:functions   # Edge Function unit tests (Deno)
(cd ml-service && pytest -q)   # forecast service API tests
```
Demo logins (password `password123`): `manager@`, `cook@`, `waiter@`, `waiter2@`, `cashier@`, `client@rswork.com`.

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (+ optional Stripe)
npm run dev                  # http://localhost:5173
```

### 4. ML service (optional — forecasting falls back without it)
```bash
cd ml-service
python -m venv .venv
.venv/Scripts/activate        # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
uvicorn app:app --port 8000
```
Point the `ML_SERVICE_URL` Edge Function secret at it (it must be reachable from Supabase).

## Roles

`client · waiter · cashier · cook · manager · superadmin` — stored on `profiles` (one row per Supabase Auth user) and enforced by RLS and the RPC functions, scoped per restaurant. Owners onboard by signing up with a restaurant name (the database creates the restaurant and makes them its manager); staff accounts are created by a manager through the `staff-admin` Edge Function. Owners of several restaurants switch between them from the dashboard header.

## RPC overview

| Area | Functions |
|------|-----------|
| Diner (anonymous) | `open_table_session`, `place_order`, `get_order`, `request_bill`, `submit_feedback` |
| Kitchen / floor | `kds_orders`, `set_item_status`, `set_order_status`, `claim_order`, `waiter_tables`, `waiter_heartbeat`, `waiter_leave`, `auto_assign_sections` |
| Cashier | `active_orders_by_table`, `start_cash_payment`, `confirm_cash_payment` |
| Manager | `update_restaurant`, `report_dashboard`, `report_weekly`, `report_top_items`, `report_ai_analytics` |

Errors raise SQLSTATE `PTxxx`, which PostgREST maps to HTTP status `xxx`.

## License

Proprietary — © Nerovex.
