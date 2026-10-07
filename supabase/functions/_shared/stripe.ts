import Stripe from 'npm:stripe@17';

const secretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// Null when card payments aren't configured; callers respond accordingly.
export const stripe = secretKey
  ? new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
  : null;

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export const currency = (Deno.env.get('STRIPE_CURRENCY') ?? 'usd').toLowerCase();
