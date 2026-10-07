// Card payments for diners (anonymous) and cashiers. The amount always comes
// from the order in the database, never from the client.
//
// POST { action: 'create', orderId }            -> { clientSecret, paymentId }
// POST { action: 'confirm', paymentIntentId }   -> { settled }
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { admin } from '../_shared/supabase.ts';
import { currency, stripe } from '../_shared/stripe.ts';

serve(async (req) => {
  if (!stripe) throw new HttpError(400, 'Card payments are not configured');
  const body = await readJson(req);

  if (body.action === 'create') {
    const orderId = String(body.orderId ?? '');
    const { data: order } = await admin
      .from('orders')
      .select('id, restaurant_id, status, payment_status, total_amount')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status === 'cancelled') throw new HttpError(400, 'Order is cancelled');
    if (order.payment_status === 'paid') throw new HttpError(400, 'Order is already paid');

    const amount = Number(order.total_amount);
    // Reuse the pending intent while the amount is unchanged, so repeated taps
    // don't pile up orphan PaymentIntents.
    const { data: pending } = await admin
      .from('payments')
      .select('id, amount, stripe_client_secret')
      .eq('order_id', order.id)
      .eq('method', 'card')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending?.stripe_client_secret && Number(pending.amount) === amount) {
      return json({ clientSecret: pending.stripe_client_secret, paymentId: pending.id });
    }

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { orderId: order.id },
    });
    const fields = {
      amount,
      stripe_payment_intent_id: intent.id,
      stripe_client_secret: intent.client_secret,
    };
    const { data: payment, error } = pending
      ? await admin.from('payments').update(fields).eq('id', pending.id).select('id').single()
      : await admin
          .from('payments')
          .insert({ ...fields, order_id: order.id, restaurant_id: order.restaurant_id, method: 'card', status: 'pending' })
          .select('id')
          .single();
    if (error) throw new HttpError(500, error.message);
    return json({ clientSecret: intent.client_secret, paymentId: payment.id });
  }

  if (body.action === 'confirm') {
    const intentId = String(body.paymentIntentId ?? '');
    if (!intentId.startsWith('pi_')) throw new HttpError(400, 'Invalid payment intent');
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status !== 'succeeded') throw new HttpError(400, 'Payment not successful yet');

    // The webhook may already have settled it; settlement is idempotent.
    const { data, error } = await admin.rpc('settle_card_payment', { p_intent: intentId });
    if (error) throw new HttpError(500, error.message);
    return json(data);
  }

  throw new HttpError(400, 'Unknown action');
});
