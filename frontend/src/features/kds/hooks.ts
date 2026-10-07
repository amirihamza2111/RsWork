import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/backend'
import { restaurantTopic, subscribe } from '@/lib/realtime'
import { useLivePolling } from '@/lib/use-live-polling'
import { useRestaurantId } from '@/features/auth/auth-context'

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
  const restaurantId = useRestaurantId()
  const refetchInterval = useLivePolling(restaurantId ? restaurantTopic(restaurantId) : undefined, [
    ['orders', 'kds'],
  ])
  return useQuery({
    queryKey: ['orders', 'kds'],
    enabled: Boolean(restaurantId),
    queryFn: () => rpc<KdsOrder[]>('kds_orders', { p_restaurant: restaurantId }),
    refetchInterval,
  })
}

export function useUpdateItemStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, itemId, status }: { orderId: string; itemId: string; status: ItemStatus }) =>
      rpc('set_item_status', { p_order: orderId, p_item: itemId, p_status: status }),
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

// Listens on the restaurant channel and refetches the board whenever a
// relevant realtime event arrives.
export function useKdsRealtime(restaurantId?: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!restaurantId) return
    return subscribe(restaurantTopic(restaurantId), KDS_EVENTS, () =>
      qc.invalidateQueries({ queryKey: ['orders', 'kds'] })
    )
  }, [restaurantId, qc])
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
