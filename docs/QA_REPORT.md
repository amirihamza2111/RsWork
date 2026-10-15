# RsWork — Quality, Performance & Security Report

Audit of 15 Oct 2026 against the live stack (Vercel frontend `rs-work-ge7g.vercel.app`,
Supabase project `obbpjdsdgpmuwfvwqxoh`). Every check below is reproducible with
the commands in the last section.

| Area | Result |
|---|---|
| Functional end-to-end suite | **20 / 20** pass (`tests/rswork.test.mjs`) |
| Security suite | **16 / 16** pass (`tests/security.test.mjs`) |
| Load test (k6) | **0 % errors**, p95 **163 ms** at up to 120 concurrent users |
| Production dependencies (`npm audit --omit=dev`) | **0** vulnerabilities |
| Secrets in code or git history | **none** |
| Security headers | CSP + 5 headers added (verified with zero CSP violations) |

---

## 1. Performance

### Load test — k6 (`perf/load-test.js`)
Same profile as the OphtaHealth test: ramp 15 → 50 → 100 virtual diners with 1–3 s
of reading time, thresholds `p95 < 800 ms` and `errors < 1 %`. Run on a throwaway
restaurant (`perf/fixture.mjs`), never the demo data.

| Scenario | Load | p95 | Avg |
|---|---|---|---|
| Diners: menu page (Vercel) + table session + menu (Supabase) | 0 → 100 users | **138 ms** | 98 ms |
| Ordering: session + `place_order` + tracking | 2 orders/s, 180 orders | **142 ms** | 108 ms |
| Kitchen screens: `kds_orders` as the cook (RLS) | 10 screens | **354 ms** | 213 ms |
| **All requests** | 8,185 requests, ~78 req/s | **163 ms** | 102 ms |

All 8,184 checks passed, 0 failed requests. The kitchen board is the slowest call
because it returns every open order (~180 accumulated during the run); it stays far
under the threshold and real screens refresh it from Realtime, not by polling.

### Bundle — rollup-plugin-visualizer (`npm run analyze` → `frontend/stats.html`)

| Chunk (gzip) | Before | After |
|---|---|---|
| Main app code | 163 KB in one 551 KB file (size warning) | **46 KB** app + **75 KB** React + **55 KB** Supabase, each cached separately |
| Stripe.js on the tracking page | loaded on every visit | **not loaded** unless card payment is configured |
| Dashboard (Recharts) | 103 KB, managers only | unchanged (lazy) |
| PDFKit | 213 KB, lazy | unchanged (only when a PDF is downloaded) |

---

## 2. Security

| Check | How it was tested | Result |
|---|---|---|
| **SQL injection** | Injection strings in every free-text RPC parameter, in uuid parameters and in PostgREST filters; review of all dynamic SQL | ✅ Values are bound parameters; `execute format()` only appears in migrations over constant lists. Injected ids fail as invalid uuids (`22P02`). |
| **XSS (stored)** | `<img onerror>`, `<script>`, `<svg onload>`, `javascript:` in notes, item comments/options and feedback | ✅ HTML is stripped in the database (`private.sanitize_text`) before storage; React escapes all output. |
| **Raw HTML sinks** (`dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`) | Code scan | ✅ None. The QR print page used `document.write` with non-user data; rewritten with DOM APIs anyway. |
| **IDOR / tenant isolation** | A second restaurant's manager reads/updates/deletes A's orders, items, payments, feedback, tables, profiles, files; calls every staff RPC and Edge Function with A's ids | ✅ RLS returns nothing and blocks writes; RPCs return 403; Storage refuses writes/deletes outside the restaurant folder. |
| **Least privilege** | Cook/waiter/client calling manager or cashier actions | ✅ 403 on every attempt. |
| **Overposting / mass assignment** | Self-promotion to superadmin, moving rows to another restaurant, extra fields in `update_restaurant`, direct inserts into orders/payments, client-side prices | ✅ No update policy on roles; `WITH CHECK` blocks cross-tenant moves; patch whitelist ignores `owner_id`/`is_active`; prices always come from the menu. |
| **JWT validation** | `alg: none`, tampered claims (`role: service_role`), bad signature, expired `exp` — against REST and Edge Functions | ✅ All 401. Edge Functions verify signatures with `auth.getClaims` (JWKS). |
| **Password hashing** | Hash algorithm prefix of every account | ✅ bcrypt, cost 10 (`$2a$10$`), managed by Supabase Auth. |
| **Password policy** | Weak passwords at sign-up | ⚠️ Supabase minimum was 6. App-side minimum raised to **8** (registration, settings, staff-admin). Set the same in the Supabase dashboard (see §3). |
| **Password reset** | Reset by waiter, by another restaurant's manager, anonymously; co-manager targeting the owner | ✅ 403 / 401; only a manager of the same restaurant can reset staff, nobody but the owner can change the owner's account. |
| **Secure reset token** | — | ✅ N/A: no email reset links exist (no email delivery), so there is no token to steal or guess. |
| **Rate limiting** | 40 rapid wrong-password logins | ✅ Supabase returns `429 over_request_rate_limit` after 26 attempts. App-level limits: 5 open orders / 1,000 open tab per table, bill request 1/min/order, 1 feedback per order and 1 per table per 10 min. |
| **Input sanitization** | Length caps and tag stripping in SQL; ratings, statuses, methods validated against fixed lists | ✅ |
| **Output encoding / CSP** | Live response headers; app exercised under the policy | ✅ Added CSP (`default-src 'self'`, scripts only from self + Stripe, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP. Diner menu, tracking + Realtime, dashboard charts, QR codes and PDF generation run with **zero** violations. |
| **Hardcoded secrets** | Patterns for Supabase/Stripe/Groq/Gemini/Resend keys, JWT secrets, private keys, Mongo URIs — current tree **and full git history** | ✅ None. Only an old `.env.example` placeholder. `.env*` is gitignored. The publishable key in docs is public by design. |
| **Dependencies** | `npm audit` (frontend, tools) | ✅ Production: 0 (react-router updated to 7.18.4). ⚠️ 2 dev-only issues in the Tailwind 3 build toolchain (`braces`, `postcss-selector-parser`), never shipped to browsers. |
| **Supabase advisors** | Security + performance linters | ✅ Only intentional notices: the RPCs are callable `SECURITY DEFINER` functions (they *are* the API and check the caller themselves). |

---

## 3. Remaining recommendations

1. **Supabase → Authentication → Sign In / Providers → Email**: set the minimum password length to **8** (and require letters + digits) so the API enforces what the app now enforces.
2. **Leaked-password protection** (HaveIBeenPwned) is a paid-plan feature; enable it if the project moves to Pro.
3. **Tailwind 4** upgrade would clear the two dev-only advisories.
4. The CSP allows inline *styles* (`'unsafe-inline'` in `style-src`) because React and Recharts set style attributes; scripts remain strict.
5. Public PostgREST endpoints have no generic per-IP limit on the free plan; the app-level caps above bound what an anonymous caller can do.

---

## 4. Re-running everything

```bash
# repo root, .env filled in
npm test                                         # functional + security suites (36 tests)
node --env-file=.env perf/fixture.mjs create     # throwaway restaurant for the load test
k6 run -e SITE=https://rs-work-ge7g.vercel.app perf/load-test.js
node --env-file=.env perf/fixture.mjs destroy
cd frontend && npm run analyze                   # bundle treemap → frontend/stats.html
cd frontend && npm audit --omit=dev
```
