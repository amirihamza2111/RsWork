import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { restaurantTopic, subscribe } from '@/lib/realtime'

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
// valid number is submitted; polls as a fallback to the socket refresh.
export function useActiveByTable(tableNumber: number | null) {
  return useQuery({
    queryKey: ['cashier', 'active', tableNumber],
    queryFn: () => api.get<ActiveTableResult>('/api/orders/active', { tableNumber }),
    enabled: tableNumber != null && tableNumber > 0,
    refetchInterval: 15_000,
  })
}

// Cash settlement: create the cash payment, then confirm it (the cashier has
// physically taken the money). The order flips to paid and leaves the unpaid list.
export function usePayCash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { payment } = await api.post<{ payment: { _id: string } }>('/api/payments/cash', {
        orderId,
      })
      await api.post('/api/payments/cash/confirm', { paymentId: payment._id })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cashier', 'active'] }),
  })
}

// Downloads the thermal receipt PDF with the auth header attached (window.open
// would 401 — no Bearer token).
export async function downloadReceipt(orderId: string, orderNumber: string) {
  const blob = await api.getBlob(`/api/payments/order/${orderId}/receipt/pdf`)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `facture-${orderNumber || orderId}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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
