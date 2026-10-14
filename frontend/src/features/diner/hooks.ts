import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, rpc } from '@/lib/backend'
import { subscribe, tableTopic } from '@/lib/realtime'
import { useLivePolling } from '@/lib/use-live-polling'
import { fetchCategories, fetchMenuItems } from '@/features/menu/hooks'

type Trilingual = { fr?: string; en?: string; ar?: string } | string

export interface TableInfo {
  _id: string
  number: number
  restaurant: { _id: string; name?: string; logo?: string; settings?: { currency?: string } }
}

export interface DinerCategory {
  _id: string
  name: Trilingual
  order?: number
}

export interface DinerItem {
  _id: string
  name: Trilingual
  description?: Trilingual
  price: number
  image?: string
  category: string | { _id: string }
  isAvailable: boolean
}

export interface TrackedItem {
  _id: string
  quantity: number
  status: string
  menuItem?: { name?: Trilingual }
}

export interface TrackedOrder {
  _id: string
  orderNumber: string
  status: string
  paymentStatus: 'unpaid' | 'paid' | 'partial'
  totalAmount: number
  createdAt: string
  table?: { _id?: string; number?: number }
  items: TrackedItem[]
}

const catId = (c: DinerItem['category']) => (typeof c === 'string' ? c : c?._id)

export interface TableSession {
  table: TableInfo
  session: { id: string; expiresAt: string }
}

// The QR encodes only the table id. Opening a session resolves the table (and
// its restaurant) AND returns the session id the diner must send to order.
// An existing active session is resumed, so a page refresh is safe.
export function useTableSession(tableId?: string) {
  return useQuery({
    queryKey: ['diner', 'session', tableId],
    queryFn: () => rpc<TableSession>('open_table_session', { p_table: tableId }),
    enabled: Boolean(tableId),
    staleTime: 30 * 60_000,
  })
}

// The menu is public data, read directly under RLS.
export function useDinerMenu(restaurantId?: string) {
  const categories = useQuery({
    queryKey: ['diner', 'categories', restaurantId],
    queryFn: () => fetchCategories(restaurantId!),
    select: (list): DinerCategory[] => [...list].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    enabled: Boolean(restaurantId),
    staleTime: 5 * 60_000,
  })
  const items = useQuery({
    queryKey: ['diner', 'items', restaurantId],
    queryFn: () => fetchMenuItems(restaurantId!),
    select: (list): DinerItem[] => list.filter((i) => i.isAvailable),
    enabled: Boolean(restaurantId),
    staleTime: 5 * 60_000,
  })
  return { categories, items, itemsByCategory: (id: string) => (items.data ?? []).filter((i) => catId(i.category) === id) }
}

export interface PlaceOrderPayload {
  table: string
  sessionId?: string
  lat?: number
  lng?: number
  items: { menuItem: string; quantity: number }[]
}

// Prices, availability, session, geofence and anti-abuse caps are all
// enforced inside the place_order database function.
export function usePlaceOrder() {
  return useMutation({
    mutationFn: async (payload: PlaceOrderPayload) => {
      const order = await rpc<{ _id: string }>('place_order', {
        p_table: payload.table,
        p_items: payload.items,
        p_session: payload.sessionId ?? null,
        p_lat: payload.lat ?? null,
        p_lng: payload.lng ?? null,
      })
      return { order }
    },
  })
}

// Diner asks to pay at the table — notifies the cashier/waiter.
export function useRequestBill() {
  return useMutation({
    mutationFn: ({ orderId, method }: { orderId: string; method: 'cash' | 'card' }) =>
      rpc<{ requested: boolean }>('request_bill', { p_order: orderId, p_method: method }),
  })
}

// One feedback per order (the database refuses a second one with a 409).
export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (body: { orderId: string; tableId?: string; rating: number; category: string; comment?: string }) =>
      rpc('submit_feedback', {
        p_rating: body.rating,
        p_order: body.orderId,
        p_table: body.tableId ?? null,
        p_category: body.category,
        p_comment: body.comment || null,
      }),
  })
}

/* ----------------------- Online card payment (Stripe) ---------------------- */

export interface StripeConfig {
  cardEnabled: boolean
  publishableKey: string | null
}

const STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) || null

// Online card payment is available when a Stripe publishable key is configured.
export function useStripeConfig() {
  return useQuery({
    queryKey: ['payments', 'config'],
    queryFn: (): StripeConfig => ({ cardEnabled: Boolean(STRIPE_PUBLISHABLE_KEY), publishableKey: STRIPE_PUBLISHABLE_KEY }),
    staleTime: Infinity,
  })
}

// Creates the PaymentIntent for an order (amount comes from the database).
export function useInitiateCardPayment() {
  return useMutation({
    mutationFn: (orderId: string) =>
      invoke<{ clientSecret: string; paymentId: string }>('stripe-intent', { action: 'create', orderId }),
  })
}

// After Stripe confirms client-side, settles the payment (the webhook is the backstop).
export function useConfirmCardPayment() {
  return useMutation({
    mutationFn: (paymentIntentId: string) => invoke('stripe-intent', { action: 'confirm', paymentIntentId }),
  })
}

// Live order tracking: fetch once, then refresh on realtime events for the table.
export function useTrackedOrder(orderId?: string) {
  const qc = useQueryClient()
  const queryKey = ['diner', 'order', orderId]
  // The table channel is only known once the order has loaded; until then this
  // counts as disconnected and polls fast.
  const tableId = qc.getQueryData<TrackedOrder>(queryKey)?.table?._id
  const refetchInterval = useLivePolling(tableId ? tableTopic(tableId) : undefined, [queryKey])
  const query = useQuery({
    queryKey,
    queryFn: () => rpc<TrackedOrder>('get_order', { p_order: orderId }),
    enabled: Boolean(orderId),
    refetchInterval,
  })

  useEffect(() => {
    if (!orderId || !tableId) return
    const events = ['new_order', 'order_updated', 'order_ready', 'kds_updated', 'paymentCompleted']
    return subscribe(tableTopic(tableId), events, () =>
      qc.invalidateQueries({ queryKey: ['diner', 'order', orderId] })
    )
  }, [orderId, tableId, qc])

  return query
}
