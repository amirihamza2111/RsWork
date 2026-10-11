# RsWork — frontend

React 19 + TypeScript + Vite SPA that talks to Supabase directly (Auth,
PostgREST/RPC, Realtime, Storage, Edge Functions). See the repository
[README](../README.md) for the architecture and [DEPLOYMENT](../DEPLOYMENT.md)
for hosting.

```bash
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                  # http://localhost:5173
npm run build                # type-check + production build
npm run lint                 # oxlint
```

Layout: `src/features/<area>` holds each screen with its data hooks (diner,
kds, waiter, cashier, dashboard, menu, tables, staff, payments, feedback,
settings, auth); `src/lib` holds the Supabase client, realtime channels,
polling policy, image upload and in-browser PDF generation.
