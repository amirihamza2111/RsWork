-- Card-payment settlement, executed only by the Stripe Edge Functions
-- (service role). Idempotent: Stripe retries webhooks and the diner app may
-- also confirm, but an order is settled and announced exactly once.

create or replace function public.settle_card_payment(p_intent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where stripe_payment_intent_id = p_intent for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'unknown payment intent');
  end if;
  if p.status = 'completed' then
    return jsonb_build_object('settled', false, 'reason', 'already completed', 'paymentId', p.id);
  end if;

  update public.payments set status = 'completed', paid_at = now() where id = p.id;
  update public.orders set payment_status = 'paid', payment_method = 'card' where id = p.order_id;
  perform private.emit_order(p.order_id, array['paymentCompleted']);
  return jsonb_build_object('settled', true, 'paymentId', p.id, 'orderId', p.order_id);
end;
$$;

create or replace function public.fail_card_payment(p_intent text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments set status = 'failed'
  where stripe_payment_intent_id = p_intent and status = 'pending'
$$;

revoke all on function public.settle_card_payment(text) from public, anon, authenticated;
revoke all on function public.fail_card_payment(text) from public, anon, authenticated;
grant execute on function public.settle_card_payment(text) to service_role;
grant execute on function public.fail_card_payment(text) to service_role;
