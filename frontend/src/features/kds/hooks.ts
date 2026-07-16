import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'

export type ItemStatus = 'queued' | 'preparing' | 'ready' | 'served'

export interface KdsItem {
  _id: string
  quantity: number
  status: ItemStatus
  prepStation: 'kitchen' | 'bar'
  comment?: string
  menuItem?: { name?: { fr?: string; en?: string; ar?: string } | string }
}

export interface KdsOrder {
  _id: string
  orderNumber: string
  status: string
  createdAt: string
  table?: { number?: number }
  items: KdsItem[]
}

export function useKdsOrders() {
  return useQuery({
    queryKey: ['orders', 'kds'],
    queryFn: () => api.get<{ orders: KdsOrder[] }>('/api/orders/kds'),
    select: (d) => d.orders,
    // Fallback polling in case a realtime event is ever missed.
    refetchInterval: 15_000,
  })
}

export function useUpdateItemStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, itemId, status }: { orderId: string; itemId: string; status: ItemStatus }) =>
      api.patch(`/api/orders/${orderId}/items/${itemId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'kds'] }),
  })
}

const KDS_EVENTS = [
  'new_order',
  'kds_updated',
  'order_updated',
  'order_ready',
  'drinks_requested',
  'orderCancelled',
]

// Joins the restaurant room and refetches the board whenever a relevant
// realtime event arrives.
export function useKdsRealtime(restaurantId?: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!restaurantId) return
    const s = getSocket()
    const join = () => s.emit('joinRestaurant', restaurantId)
    join()
    s.on('connect', join)

    const refresh = () => qc.invalidateQueries({ queryKey: ['orders', 'kds'] })
    KDS_EVENTS.forEach((e) => s.on(e, refresh))

    return () => {
      s.off('connect', join)
      KDS_EVENTS.forEach((e) => s.off(e, refresh))
    }
  }, [restaurantId, qc])
}

export function useSocketConnected() {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const s = getSocket()
    setConnected(s.connected)
    const on = () => setConnected(true)
    const off = () => setConnected(false)
    s.on('connect', on)
    s.on('disconnect', off)
    return () => {
      s.off('connect', on)
      s.off('disconnect', off)
    }
  }, [])
  return connected
}

// Item display helpers ------------------------------------------------------
export function itemName(item: KdsItem): string {
  const n = item.menuItem?.name
  if (!n) return 'Item'
  if (typeof n === 'string') return n
  return n.fr || n.en || n.ar || 'Item'
}

export function nextItemAction(item: KdsItem): { label: string; to: ItemStatus } | null {
  if (item.status === 'queued') {
    return item.prepStation === 'bar' ? { label: 'Ready', to: 'ready' } : { label: 'Start', to: 'preparing' }
  }
  if (item.status === 'preparing') return { label: 'Ready', to: 'ready' }
  return null
}
