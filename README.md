# RsWork

A QR-based **restaurant management platform** by **Nerovex**. A diner scans the QR on their table, orders from a multilingual menu, and tracks their meal in real time; the kitchen works a live KDS board, waiters are notified when food is ready, the cashier settles the bill (cash or card), and the owner gets a BI dashboard with ML-powered forecasting and an AI-written report.

## Architecture

```
RsWork/
├── backend/       Node.js + Express + MongoDB API (REST + Socket.IO realtime)
└── ml-service/    Python + FastAPI forecasting microservice (Holt-Winters)
```

The backend is the system of record and calls the ML service for demand/revenue
forecasts (with a built-in fallback if it's offline). The AI report uses an LLM
(Groq or Gemini, provider-agnostic) and falls back to a deterministic template.

## Tech stack

| Area | Tech |
|------|------|
| API | Node.js, Express 5, Mongoose 9 |
| Realtime | Socket.IO (rooms per restaurant / table / waiter) |
| Auth | JWT (Bearer) + bcrypt |
| Payments | Stripe (cards) + cash, with Stripe webhook |
| Media | Cloudinary |
| Docs/Export | PDFKit (thermal receipt + BI report) |
| ML | Python, FastAPI, pure-Python Holt-Winters + rolling-origin CV |
| AI report | Groq / Gemini (provider-agnostic) |
| Tests | Node built-in test runner (`node:test`) |

## Getting started

### Backend
```bash
cd backend
npm install
cp .env.example .env.development.local   # then fill DB_URI, JWT_SECRET, etc.
npm run seed        # creates a demo restaurant + one user per role
npm run dev         # starts on PORT (default 5000)
```
Required env: `DB_URI`, `JWT_SECRET`. Optional: Stripe, Cloudinary, Groq/Gemini, ML service. See `backend/.env.example`.

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
npm run test:integration   # full circuit against a `rswork_test` database
npm test                   # both
```

## Roles

`client · waiter · cashier · cook · manager · superadmin` — enforced by JWT auth
and per-restaurant (multi-tenant) scoping. New restaurants onboard via
`POST /api/auth/register-restaurant` (creates the restaurant + its first manager).

## API overview

| Group | Endpoints |
|-------|-----------|
| Auth | `register`, `login`, `me`, `register-restaurant`, `change-password`, `forgot-password`, `reset-password` |
| Menu | `menu`, `menu/items`, `menu/categories`, `menu/recommendations` |
| Tables | `tables` CRUD, `tables/qr/:id`, `tables/:id/release` |
| Orders | `orders`, `orders/kds`, `orders/active`, `orders/:id/status`, `orders/:id/items/:itemId/status` |
| Payments | `payments/cash`, `payments/card`, `payments/webhook`, receipt PDF |
| Reports | `dashboard`, `daily/weekly/monthly`, `top-items`, `peak-hours`, `peak-days`, `forecast`, `ai-report` |

Import `backend/postman_collection.json` + `backend/postman_environment.json`
into Postman to try the full flow.

All JSON responses use the envelope `{ success, message, data }`.

## License

Proprietary — © Nerovex.
