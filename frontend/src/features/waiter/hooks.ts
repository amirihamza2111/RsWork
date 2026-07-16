import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'

export interface WaiterItem {
  _id: string
  quantity: number
  status: 'queued' | 'preparing' | 'ready' | 'served'
  menuItem?: { name?: { fr?: string; en?: string; ar?: string } | string }
}

export interface WaiterOrder {
  _id: string
  orderNumber: string
  status: string
  createdAt: string
  table?: { _id?: string; number?: number }
  waiter?: { _id: string; name?: string } | string | null
  items: WaiterItem[]
}

export const orderWaiterId = (o: WaiterOrder): string => {
  const w = o.waiter
  return !w ? '' : typeof w === 'string' ? w : w._id
}

export const orderWaiterName = (o: WaiterOrder): string =>
  o.waiter && typeof o.waiter === 'object' ? (o.waiter.name ?? '') : ''

const WAITER_EVENTS = [
  'new_order',
  'order_ready',
  'order_updated',
  'kds_updated',
  'orderCancelled',
  'sections_updated',
]

export function useWaiterOrders() {
  return useQuery({
    queryKey: ['orders', 'waiter'],
    queryFn: () => api.get<{ orders: WaiterOrder[] }>('/api/orders/kds'),
    select: (d) => d.orders,
    refetchInterval: 15_000,
  })
}

export function useMarkServed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      api.put(`/api/orders/${orderId}/status`, { status: 'served' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders', 'waiter'] }),
  })
}

// Atomic claim of an unassigned order — the first waiter wins, the loser
// receives a 409 with the winner's name.
export function useClaimOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => api.put(`/api/orders/${orderId}/claim`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['orders', 'waiter'] }),
  })
}

// The waiter's section: tables auto-assigned to them (updates on sections_updated).
export function useMyTables() {
  return useQuery({
    queryKey: ['waiter', 'tables'],
    queryFn: () => api.get<{ tables: { _id: string; number: number }[] }>('/api/tables'),
    select: (d) => [...d.tables].sort((a, b) => a.number - b.number),
    refetchInterval: 30_000,
  })
}

export function useWaiterRealtime(restaurantId?: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!restaurantId) return
    const s = getSocket()
    const join = () => s.emit('joinRestaurant', restaurantId)
    join()
    s.on('connect', join)
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['orders', 'waiter'] })
      qc.invalidateQueries({ queryKey: ['waiter', 'tables'] })
    }
    WAITER_EVENTS.forEach((e) => s.on(e, refresh))
    return () => {
      s.off('connect', join)
      WAITER_EVENTS.forEach((e) => s.off(e, refresh))
    }
  }, [restaurantId, qc])
}

export function itemDisplayName(item: WaiterItem): string {
  const n = item.menuItem?.name
  if (!n) return 'Item'
  if (typeof n === 'string') return n
  return n.fr || n.en || n.ar || 'Item'
}
