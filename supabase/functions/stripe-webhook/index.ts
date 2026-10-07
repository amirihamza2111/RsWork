// Stripe webhook — the reliable, async source of truth for card payments.
// Deployed with verify_jwt = false: authenticity comes from the signature.
import { admin } from '../_shared/supabase.ts';
import { cryptoProvider, stripe } from '../_shared/stripe.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { message: 'Method not allowed' });
  if (!stripe || !webhookSecret) return reply(503, { message: 'Stripe is not configured' });

  const payload = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      req.headers.get('stripe-signature') ?? '',
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    return reply(400, { message: `Webhook signature failed: ${(err as Error).message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const { error } = await admin.rpc('settle_card_payment', { p_intent: event.data.object.id });
    if (error) return reply(500, { message: error.message });
  } else if (event.type === 'payment_intent.payment_failed') {
    const { error } = await admin.rpc('fail_card_payment', { p_intent: event.data.object.id });
    if (error) return reply(500, { message: error.message });
  }
  return reply(200, { received: true });
});
