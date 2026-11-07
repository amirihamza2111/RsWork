import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/backend'
import { downloadReceiptPdf, type ReceiptOrder } from '@/lib/pdf/receipt'
import { restaurantTopic, subscribe } from '@/lib/realtime'
import { useLivePolling } from '@/lib/use-live-polling'
import { useRestaurantId } from '@/features/auth/auth-context'

export interface CashierItem {
  _id: string
  quantity: number
  price: number
  menuItem?: { name?: { fr?: string; en?: string; ar?: string } | string }
}

export interface CashierOrder {
  _id: string
  orderNumber: string
  status: string
  paymentStatus?: string
  totalAmount: number
  createdAt: string
  items: CashierItem[]
}

export interface ActiveTableResult {
  table: { id: string; number: number }
  count: number
  totalDue: number
  orders: CashierOrder[]
}

// Cashier looks up a table's unpaid orders by table number. Disabled until a
// valid number is submitted; polls as a fallback to the realtime refresh.
export function useActiveByTable(tableNumber: number | null) {
  const restaurantId = useRestaurantId()
  const refetchInterval = useLivePolling(restaurantId ? restaurantTopic(restaurantId) : undefined, [
    ['cashier', 'active'],
  ])
  return useQuery({
    queryKey: ['cashier', 'active', tableNumber],
    queryFn: () =>
      rpc<ActiveTableResult>('active_orders_by_table', { p_restaurant: restaurantId, p_table_number: tableNumber }),
    enabled: Boolean(restaurantId) && tableNumber != null && tableNumber > 0,
    refetchInterval,
  })
}

// Cash settlement: create the cash payment, then confirm it (the cashier has
// physically taken the money). The order flips to paid and leaves the unpaid list.
export function usePayCash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { payment } = await rpc<{ payment: { _id: string } }>('start_cash_payment', { p_order: orderId })
      await rpc('confirm_cash_payment', { p_payment: payment._id })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cashier', 'active'] }),
  })
}

// Builds the thermal receipt in the browser from the (paid) order.
export async function downloadReceipt(orderId: string) {
  const order = await rpc<ReceiptOrder & { paymentStatus: string }>('get_order', { p_order: orderId })
  if (order.paymentStatus !== 'paid') throw { status: 400, message: 'Receipt is available only for paid orders' }
  await downloadReceiptPdf(order)
}

const CASHIER_EVENTS = [
  'new_order',
  'order_updated',
  'order_ready',
  'paymentCompleted',
  'cashPaymentRequested',
  'orderCancelled',
]

export function useCashierRealtime(restaurantId?: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!restaurantId) return
    return subscribe(restaurantTopic(restaurantId), CASHIER_EVENTS, () =>
      qc.invalidateQueries({ queryKey: ['cashier', 'active'] })
    )
  }, [restaurantId, qc])
}

export interface BillRequest {
  orderId: string
  orderNumber: string
  table?: { number?: number }
  method: 'cash' | 'card'
  requestedAt: string
}

// Events that add, clear or settle a bill request.
const BILL_EVENTS = ['bill_requested', 'bill_request_cleared', 'paymentCompleted', 'orderCancelled']

// "Diner wants to pay" alerts. Loaded from the database, so a request made while the
// screen was closed still shows; they stay until the bill is paid or someone dismisses it.
export function useBillRequests(restaurantId?: string) {
  const qc = useQueryClient()
  const queryKey = ['bills', 'pending', restaurantId]
  const refetchInterval = useLivePolling(restaurantId ? restaurantTopic(restaurantId) : undefined, [
    ['bills', 'pending'],
  ])
  const { data } = useQuery({
    queryKey,
    queryFn: () => rpc<BillRequest[]>('pending_bill_requests', { p_restaurant: restaurantId }),
    enabled: Boolean(restaurantId),
    refetchInterval,
  })

  useEffect(() => {
    if (!restaurantId) return
    return subscribe(restaurantTopic(restaurantId), BILL_EVENTS, () =>
      qc.invalidateQueries({ queryKey: ['bills', 'pending'] })
    )
  }, [restaurantId, qc])

  const dismissMutation = useMutation({
    mutationFn: (orderId: string) => rpc('dismiss_bill_request', { p_order: orderId }),
    onMutate: (orderId) =>
      qc.setQueryData<BillRequest[]>(queryKey, (r) => r?.filter((x) => x.orderId !== orderId)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['bills', 'pending'] }),
  })

  return { requests: data ?? [], dismiss: (orderId: string) => dismissMutation.mutate(orderId) }
}

export function itemDisplayName(item: CashierItem): string {
  const n = item.menuItem?.name
  if (!n) return 'Item'
  if (typeof n === 'string') return n
  return n.fr || n.en || n.ar || 'Item'
}
