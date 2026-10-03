const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';

// Load environment-specific file first (e.g. .env.production.local), then the default .env.
dotenv.config({ path: path.resolve(__dirname, `../.env.${nodeEnv}.local`) });
dotenv.config();

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL'];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isDev: nodeEnv === 'development',
  port: Number(process.env.PORT) || 5000,
  supabase: {
    url: String(process.env.SUPABASE_URL).replace(/\/+$/, ''),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    dbUrl: process.env.SUPABASE_DB_URL,
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'menu-images',
  },
  // Explicit CORS allowlist. Vercel preview domains are opt-in via env.
  cors: {
    origins: parseList(process.env.CORS_ORIGINS || process.env.CLIENT_URL),
    allowVercelPreviews: String(process.env.ALLOW_VERCEL_PREVIEWS || 'false') === 'true',
  },
  clientUrl: process.env.CLIENT_URL || '',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  // Forecast microservice (Python/FastAPI). Optional — the backend falls back
  // to a built-in seasonal-naive forecast when this is unreachable.
  ml: {
    url: process.env.ML_SERVICE_URL || 'http://localhost:8000',
    timeoutMs: Number(process.env.ML_TIMEOUT_MS) || 4000,
  },
  // Transactional email (verification, password reset). Optional — sends are
  // skipped (logged) when no key is configured, so flows never break.
  email: {
    provider: (process.env.EMAIL_PROVIDER || 'resend').toLowerCase(),
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || 'RsWork <onboarding@resend.dev>',
    timeoutMs: Number(process.env.EMAIL_TIMEOUT_MS) || 15000,
  },
  // LLM for the AI-written report. Optional — the report falls back to a
  // deterministic template narrative when no key is configured.
  // Provider: 'gemini' or 'groq'. AI_MODEL overrides the per-provider default.
  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    model: process.env.AI_MODEL || '',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,
  },
  // Anti-abuse caps for public (QR) ordering. A photographed QR can't flood a
  // table: orders are capped and the open (unpaid) tab is bounded.
  orders: {
    maxActivePerTable: Number(process.env.MAX_ACTIVE_ORDERS_PER_TABLE) || 5,
    maxOpenTab: Number(process.env.MAX_OPEN_TAB_AMOUNT) || 1000,
  },
  // Web Push (VAPID). Optional — push is silently disabled when keys are absent.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    contact: process.env.VAPID_CONTACT || 'mailto:admin@rswork.com',
  },
};

module.exports = config;
