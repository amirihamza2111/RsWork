import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { subscribe, tableTopic } from '@/lib/realtime'

type Trilingual = { fr?: string; en?: string; ar?: string } | string

export interface TableInfo {
  _id: string
  number: number
  restaurant: { _id: string; name?: string; settings?: { currency?: string } }
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
// The server resumes an existing active session, so a page refresh is safe.
export function useTableSession(tableId?: string) {
  return useQuery({
    queryKey: ['diner', 'session', tableId],
    queryFn: () => api.post<TableSession>(`/api/tables/${tableId}/session`),
    enabled: Boolean(tableId),
    staleTime: 30 * 60_000,
  })
}

export function useDinerMenu(restaurantId?: string) {
  const categories = useQuery({
    queryKey: ['diner', 'categories', restaurantId],
    queryFn: () => api.get<{ categories: DinerCategory[] }>('/api/menu/categories', { restaurantId }),
    select: (d) => [...d.categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    enabled: Boolean(restaurantId),
    staleTime: 5 * 60_000,
  })
  const items = useQuery({
    queryKey: ['diner', 'items', restaurantId],
    queryFn: () => api.get<{ menuItems: DinerItem[] }>('/api/menu/items', { restaurantId }),
    select: (d) => d.menuItems.filter((i) => i.isAvailable),
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

export function usePlaceOrder() {
  return useMutation({
    mutationFn: (payload: PlaceOrderPayload) =>
      api.post<{ order: { _id: string } }>('/api/orders', payload),
  })
}

// Diner asks to pay at the table — notifies the cashier/waiter.
export function useRequestBill() {
  return useMutation({
    mutationFn: ({ orderId, method }: { orderId: string; method: 'cash' | 'card' }) =>
      api.post<{ requested: boolean }>(`/api/orders/${orderId}/request-bill`, { method }),
  })
}

/* ----------------------- Online card payment (Stripe) ---------------------- */

export interface StripeConfig {
  cardEnabled: boolean
  publishableKey: string | null
  currency: string
}

// Whether online card payment is available (publishable key configured).
export function useStripeConfig() {
  return useQuery({
    queryKey: ['payments', 'config'],
    queryFn: () => api.get<StripeConfig>('/api/payments/config'),
    staleTime: 10 * 60_000,
  })
}

// Creates the PaymentIntent for an order (amount comes from the server).
export function useInitiateCardPayment() {
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<{ clientSecret: string; paymentId: string }>('/api/payments/card/diner', {
        orderId,
      }),
  })
}

// After Stripe confirms client-side, records the payment and marks the order paid.
export function useConfirmCardPayment() {
  return useMutation({
    mutationFn: (paymentIntentId: string) =>
      api.post('/api/payments/card/diner/confirm', { paymentIntentId }),
  })
}

// Live order tracking: fetch once, then refresh on realtime events for the table.
export function useTrackedOrder(orderId?: string) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['diner', 'order', orderId],
    queryFn: () => api.get<{ order: TrackedOrder }>(`/api/orders/${orderId}`),
    select: (d) => d.order,
    enabled: Boolean(orderId),
    refetchInterval: 15_000,
  })

  const tableId = query.data?.table?._id
  useEffect(() => {
    if (!orderId || !tableId) return
    const events = ['order_updated', 'order_ready', 'order_confirmed', 'orderStatusUpdated', 'kds_updated']
    return subscribe(tableTopic(tableId), events, () =>
      qc.invalidateQueries({ queryKey: ['diner', 'order', orderId] })
    )
  }, [orderId, tableId, qc])

  return query
}
