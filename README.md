# RsWork

A QR-based **restaurant management platform** by **Nerovex**. A diner scans the QR on their table, orders from a multilingual menu, and tracks their meal in real time; the kitchen works a live KDS board, waiters are notified when food is ready, the cashier settles the bill (cash or card), and the owner gets a BI dashboard with ML-powered forecasting and an AI-written report.

## Architecture

```
RsWork/
├── frontend/      React + Vite SPA (manager dashboard, KDS, waiter, cashier, diner)
├── backend/       Node.js + Express API (business rules, payments, PDFs, AI report)
├── ml-service/    Python + FastAPI forecasting microservice (Holt-Winters)
└── supabase/      SQL migrations: schema, RLS, Realtime authorization, Storage
```

```
 Browser ──Supabase Auth (sign-in, OTP, password reset)──► Supabase
    │    ◄─Realtime Broadcast (restaurant / waiter / table channels)──┘
    │                                                              ▲
    └──REST + Bearer access token──► Express API ──SQL (pooler)────┤ Postgres
                                         │ ──Auth admin / Storage / Broadcast┘
                                         └──► ML service (forecast, optional)
```

Supabase is the platform: **Postgres** is the system of record, **Supabase Auth**
issues sessions, **Realtime Broadcast** pushes live updates, and **Storage** holds
menu images. The Express API keeps everything that needs a trusted server —
order pricing and anti-abuse caps, Stripe, PDF receipts, the AI report, and the
ML forecast (with a built-in fallback if the ML service is offline).

Highlights of the data layer:
- Normalized schema (`orders` ⇄ `order_items`, `recommendations` ⇄ `recommendation_items`)
  with FK cascades, CHECK constraints and a trigger that issues `ORD-YYYYMMDD-NNNN` numbers.
- **Row Level Security on every table** — the publishable key in the browser can't read
  tenant data; private Realtime channels are authorized by RLS on `realtime.messages`.
- Race-free workflows in SQL: conditional `UPDATE … RETURNING` for waiter/cook claims,
  row locks (`SELECT … FOR UPDATE`) around order placement and KDS status roll-ups.
- Analytics (dashboard, peak hours/days, top sellers, forecast history, market-basket
  recommendations) are plain SQL `GROUP BY` / self-join queries.

## Tech stack

| Area | Tech |
|------|------|
| API | Node.js, Express 5, `postgres` (SQL over the Supabase pooler) |
| Database | Supabase Postgres 17 + Row Level Security |
| Auth | Supabase Auth (email/password, email OTP, recovery links) |
| Realtime | Supabase Realtime Broadcast (private channels via RLS) |
| Media | Supabase Storage (images resized to WebP with `sharp`) |
| Payments | Stripe (cards) + cash, with Stripe webhook |
| Docs/Export | PDFKit (thermal receipt + BI report) |
| ML | Python, FastAPI, pure-Python Holt-Winters + rolling-origin CV |
| AI report | Groq / Gemini (provider-agnostic) |
| Tests | Node built-in test runner (`node:test`) |

## Getting started

### Supabase
1. Create a Supabase project.
2. Apply the migrations in `supabase/migrations/` in order (SQL editor, or `supabase db push`).
3. Auth settings: keep **Confirm email** enabled (sign-up verification uses email OTPs).

### Backend
```bash
cd backend
npm install
cp .env.example .env.development.local   # fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
npm run seed        # creates a demo restaurant + one user per role
npm run seed:menu   # optional: imports the full demo menu
npm run dev         # starts on PORT (default 5000)
```
Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Optional: Stripe, Resend, Groq/Gemini, VAPID, ML service. See `backend/.env.example`.

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                  # http://localhost:5173
```

Demo logins after `npm run seed` (password `password123`):
`manager@rswork.com`, `cook@rswork.com`, `waiter@rswork.com`, `cashier@rswork.com`, `client@rswork.com`.

### ML service (optional — forecasting falls back without it)
```bash
cd ml-service
python -m venv .venv
.venv/Scripts/activate        # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
uvicorn app:app --port 8000
```

### Tests
```bash
cd backend
npm run test:unit          # fast, no DB
npm run test:integration   # full circuit against the Supabase project in your env
npm test                   # both
```
Integration tests create uniquely named fixtures (restaurant, auth users) and delete
them afterwards, so they're safe to run against a dev project.

```bash
# features.test.js additionally needs a running API on API_URL (default :5000)
```

## Roles

`client · waiter · cashier · cook · manager · superadmin` — stored on `profiles`
(one row per Supabase Auth user), enforced by the API and by RLS with
per-restaurant (multi-tenant) scoping. New restaurants onboard via
`POST /api/auth/register-restaurant` (creates the restaurant + its first manager,
then emails a verification code). Staff accounts are created by a manager.

## API overview

| Group | Endpoints |
|-------|-----------|
| Auth | `register`, `register-restaurant`, `me`, `forgot-password`, `resend-verification` (sign-in, OTP verification, password change/reset run through Supabase Auth in the browser) |
| Menu | `menu`, `menu/items`, `menu/categories`, `menu/recommendations` |
| Tables | `tables` CRUD, `tables/qr/:id`, `tables/:id/session`, `tables/:id/release`, `tables/presence` (waiter heartbeat) |
| Orders | `orders`, `orders/kds`, `orders/active`, `orders/:id/status`, `orders/:id/items/:itemId/status` |
| Payments | `payments/cash`, `payments/card`, `payments/webhook`, receipt PDF |
| Reports | `dashboard`, `daily/weekly/monthly`, `top-items`, `peak-hours`, `peak-days`, `forecast`, `ai-report` |

Authenticated requests carry a Supabase access token: `Authorization: Bearer <access_token>`.
`backend/postman_collection.json` predates the Supabase migration — its login request no
longer exists; paste an access token from a signed-in session into the environment instead.

All JSON responses use the envelope `{ success, message, data }`.

## License

Proprietary — © Nerovex.
