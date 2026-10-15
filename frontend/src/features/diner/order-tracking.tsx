import { useMemo, useState, type FormEvent } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Check, CircleDot, CreditCard, Heart, Loader2, UtensilsCrossed, Wallet, X, XCircle } from 'lucide-react'
// The `pure` entry only fetches js.stripe.com when loadStripe() runs, i.e. when
// card payment is configured — not on every tracking page view.
import { loadStripe } from '@stripe/stripe-js/pure'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { cn } from '@/lib/utils'
import {
  useTrackedOrder,
  useRequestBill,
  useStripeConfig,
  useInitiateCardPayment,
  useConfirmCardPayment,
} from './hooks'
import { useDiner } from './diner-context'
import { FeedbackCard } from './feedback-card'
import { tri, type TKey } from './i18n'

const STEPS: { key: string; label: TKey; hint: TKey }[] = [
  { key: 'pending', label: 'orderReceived', hint: 'hintReceived' },
  { key: 'confirmed', label: 'confirmed', hint: 'hintConfirmed' },
  { key: 'preparing', label: 'preparing', hint: 'hintPreparing' },
  { key: 'ready', label: 'ready', hint: 'hintReady' },
  { key: 'served', label: 'served', hint: 'hintServed' },
]

export function OrderTracking() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const navigate = useNavigate()
  const { t, lang } = useDiner()
  const { data: order, isLoading, isError } = useTrackedOrder(id)
  const requestBill = useRequestBill()
  const [payOpen, setPayOpen] = useState(false)
  const [billSent, setBillSent] = useState(false)

  // Online card payment (only when the restaurant has Stripe configured).
  const { data: payCfg } = useStripeConfig()
  const initiateCard = useInitiateCardPayment()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [cardPaid, setCardPaid] = useState(false)
  const stripePromise = useMemo(
    () => (payCfg?.publishableKey ? loadStripe(payCfg.publishableKey) : null),
    [payCfg?.publishableKey]
  )

  if (isLoading) return <div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#D6402C]" /></div>
  if (isError || !order) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-[#D6402C]">{t('tableNotFound')}</p>
        <button onClick={() => navigate('/menu')} className="text-sm font-medium text-[#D6402C] underline">{t('orderMore')}</button>
      </div>
    )
  }

  const cancelled = order.status === 'cancelled'
  // Settled by the cashier, or by card on this page.
  const paid = order.paymentStatus === 'paid' || cardPaid
  const currentIdx = STEPS.findIndex((s) => s.key === order.status)
  const backToMenu = () => navigate(order.table?._id ? `/menu?tableId=${order.table._id}` : '/menu')

  async function pay(method: 'cash' | 'card') {
    if (!id) return
    // Card + Stripe configured → pay online right here; otherwise notify staff.
    if (method === 'card' && payCfg?.cardEnabled && stripePromise) {
      const res = await initiateCard.mutateAsync(id)
      setClientSecret(res.clientSecret)
      return
    }
    await requestBill.mutateAsync({ orderId: id, method })
    setBillSent(true)
  }

  function closePaySheet() {
    setPayOpen(false)
    setClientSecret(null)
  }

  return (
    <div className="px-4 pb-10">
      {/* Warm confirmation hero */}
      <div className="mb-6 mt-4 flex flex-col items-center text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#D6402C]/10">
          <Heart className="h-8 w-8 text-[#D6402C]" fill="currentColor" />
        </div>
        <h1 className="font-serif text-3xl font-semibold">{t('thankYou')}</h1>
        <p className="mt-1 text-sm text-[#8A6A62]">{isNew ? t('orderPlaced') : t('autoUpdate')}</p>
        <p className="mt-1 text-sm italic text-[#D6402C]">{t('madeWithLove')} ♥</p>
        <p className="mt-2 text-xs text-[#B49A93]">
          {order.orderNumber}{order.table?.number != null ? ` · ${t('table')} ${order.table.number}` : ''}
        </p>
      </div>

      {cancelled ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-[#D6402C]/10 p-6 text-center">
          <XCircle className="h-8 w-8 text-[#D6402C]" />
          <p className="text-sm font-medium text-[#D6402C]">{t('cancelled')}</p>
        </div>
      ) : (
        <ol className="mx-auto max-w-xs">
          {STEPS.map((step, i) => {
            const done = i < currentIdx
            const active = i === currentIdx
            return (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2',
                    done && 'border-[#D6402C] bg-[#D6402C] text-white',
                    active && 'border-[#D6402C] text-[#D6402C]',
                    !done && !active && 'border-[#F3D9CF] text-[#D6C3BC]'
                  )}>
                    {done ? <Check className="h-4 w-4" /> : <CircleDot className={cn('h-4 w-4', active && 'animate-pulse')} />}
                  </span>
                  {i < STEPS.length - 1 && <span className={cn('my-1 w-0.5 flex-1', done ? 'bg-[#D6402C]' : 'bg-[#F3D9CF]')} />}
                </div>
                <div className={cn('pb-5 pt-1', !done && !active && 'opacity-45')}>
                  <div className="font-medium leading-tight">{t(step.label)}</div>
                  <div className="text-xs text-[#8A6A62]">{t(step.hint)}</div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* Items */}
      <section className="mt-4 rounded-2xl border border-[#F3D9CF] bg-white p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <UtensilsCrossed className="h-4 w-4 text-[#D6402C]" /> {t('yourItems')}
        </h2>
        <ul className="space-y-1 text-sm">
          {order.items.map((it) => (
            <li key={it._id} className="flex justify-between">
              <span><span className="font-medium">{it.quantity}×</span> {tri(it.menuItem?.name, lang)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Feedback, once the food has reached the table */}
      {!cancelled && (order.status === 'served' || paid) && id && (
        <FeedbackCard orderId={id} tableId={order.table?._id} />
      )}

      {/* Actions */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button onClick={backToMenu} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#F3D9CF] bg-white font-medium text-[#3F1D1B] active:scale-[0.99]">
          <UtensilsCrossed className="h-4 w-4" /> {t('orderMore')}
        </button>
        {paid ? (
          <div className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#D6402C]/10 font-medium text-[#D6402C]">
            <Check className="h-4 w-4" /> {t('paid')}
          </div>
        ) : (
          <button onClick={() => { setPayOpen(true); setBillSent(false) }} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#D6402C] font-medium text-white active:scale-[0.99]">
            <Wallet className="h-4 w-4" /> {t('payAtTable')}
          </button>
        )}
      </div>

      {/* Pay sheet */}
      {payOpen && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={closePaySheet}>
          <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold">{t('payAtTable')}</h2>
              <button onClick={closePaySheet} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F7E7E0]"><X className="h-4 w-4" /></button>
            </div>
            {billSent || paid ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D6402C]/10"><Check className="h-6 w-6 text-[#D6402C]" /></div>
                <p className="text-sm text-[#8A6A62]">{paid ? t('paymentSuccess') : t('billRequested')}</p>
              </div>
            ) : clientSecret && stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CardPaymentForm onPaid={() => setCardPaid(true)} />
              </Elements>
            ) : (
              <>
                <p className="mb-3 text-sm text-[#8A6A62]">{t('choosePayment')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => pay('cash')} disabled={requestBill.isPending || initiateCard.isPending} className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-[#F3D9CF] font-medium active:scale-[0.98] disabled:opacity-60">
                    <Wallet className="h-6 w-6 text-[#D6402C]" /> {t('payCash')}
                  </button>
                  <button onClick={() => pay('card')} disabled={requestBill.isPending || initiateCard.isPending} className="flex h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-[#F3D9CF] font-medium active:scale-[0.98] disabled:opacity-60">
                    <CreditCard className="h-6 w-6 text-[#D6402C]" /> {t('payCard')}
                  </button>
                </div>
                {(requestBill.isPending || initiateCard.isPending) && (
                  <p className="mt-3 text-center text-xs text-[#8A6A62]">{t('requesting')}</p>
                )}
                {initiateCard.isError && (
                  <p className="mt-3 text-center text-xs text-[#D6402C]">
                    {(initiateCard.error as { message?: string })?.message ?? t('paymentFailed')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <p className="mt-5 text-center text-xs text-[#B49A93]">{t('autoUpdate')}</p>
    </div>
  )
}

// Stripe PaymentElement + confirm. Rendered inside <Elements> with a clientSecret.
function CardPaymentForm({ onPaid }: { onPaid: () => void }) {
  const { t } = useDiner()
  const stripe = useStripe()
  const elements = useElements()
  const confirmCard = useConfirmCardPayment()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    setErr(null)
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })
    if (error) {
      setErr(error.message ?? t('paymentFailed'))
      setBusy(false)
      return
    }
    if (paymentIntent?.status === 'succeeded') {
      // Record server-side right away (the webhook is the async safety net).
      await confirmCard.mutateAsync(paymentIntent.id).catch(() => {})
      onPaid()
    } else {
      setErr(t('paymentFailed'))
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      {err && <p className="text-center text-xs text-[#D6402C]">{err}</p>}
      <button
        type="submit"
        disabled={busy || !stripe}
        className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#D6402C] py-3.5 font-medium text-white shadow-md transition-transform active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t('payNow')}
      </button>
      {busy && <p className="text-center text-xs text-[#8A6A62]">{t('paymentProcessing')}</p>}
    </form>
  )
}
