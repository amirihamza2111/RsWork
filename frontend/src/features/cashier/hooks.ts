import { useEffect, useState } from 'react'
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
  at: number
}

// Live "diner wants to pay" alerts pushed from the diner app.
export function useBillRequests(restaurantId?: string) {
  const [requests, setRequests] = useState<BillRequest[]>([])
  useEffect(() => {
    if (!restaurantId) return
    return subscribe(restaurantTopic(restaurantId), ['bill_requested'], (_event, payload) => {
      const p = payload as Omit<BillRequest, 'at'>
      setRequests((r) => [{ ...p, at: Date.now() }, ...r.filter((x) => x.orderId !== p.orderId)].slice(0, 5))
    })
  }, [restaurantId])
  const dismiss = (orderId: string) => setRequests((r) => r.filter((x) => x.orderId !== orderId))
  return { requests, dismiss }
}

export function itemDisplayName(item: CashierItem): string {
  const n = item.menuItem?.name
  if (!n) return 'Item'
  if (typeof n === 'string') return n
  return n.fr || n.en || n.ar || 'Item'
}
