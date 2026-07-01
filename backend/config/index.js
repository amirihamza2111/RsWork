const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';

// Load environment-specific file first (e.g. .env.production.local), then the default .env.
dotenv.config({ path: path.resolve(__dirname, `../.env.${nodeEnv}.local`) });
dotenv.config();

const REQUIRED = ['DB_URI', 'JWT_SECRET'];
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
  dbUri: process.env.DB_URI,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  // Explicit CORS allowlist. Vercel preview domains are opt-in via env.
  cors: {
    origins: parseList(process.env.CORS_ORIGINS || process.env.CLIENT_URL),
    allowVercelPreviews: String(process.env.ALLOW_VERCEL_PREVIEWS || 'false') === 'true',
  },
  clientUrl: process.env.CLIENT_URL || '',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
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
};

module.exports = config;
