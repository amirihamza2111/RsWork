import { useEffect, useState } from 'react'
import { CookingPot, Wine, Check, Loader2, ChefHat, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import {
  useKdsOrders,
  useKdsRealtime,
  useSocketConnected,
  useUpdateItemStatus,
  itemName,
  nextItemAction,
  type KdsItem,
  type KdsOrder,
} from './hooks'

// Re-render every 30s so elapsed clocks stay fresh.
function useTick(intervalMs = 30_000) {
  const [, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
}

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function ItemRow({ orderId, item }: { orderId: string; item: KdsItem }) {
  const update = useUpdateItemStatus()
  const action = nextItemAction(item)
  const StationIcon = item.prepStation === 'bar' ? Wine : CookingPot

  return (
    <div className="flex items-center gap-2 py-1.5">
      <StationIcon
        className={cn('h-4 w-4 shrink-0', item.prepStation === 'bar' ? 'text-sky-500' : 'text-amber-600')}
      />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{item.quantity}×</span> {itemName(item)}
        {item.comment && <span className="block text-xs text-muted-foreground">"{item.comment}"</span>}
      </span>
      {action ? (
        <Button
          size="sm"
          variant={item.status === 'preparing' ? 'default' : 'outline'}
          className="h-7 px-2 text-xs"
          disabled={update.isPending}
          onClick={() => update.mutate({ orderId, itemId: item._id, status: action.to })}
        >
          {action.label}
        </Button>
      ) : (
        <Check className="h-4 w-4 shrink-0 text-success" />
      )}
    </div>
  )
}

function Ticket({ order }: { order: KdsOrder }) {
  const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000)
  const urgency =
    mins >= 15 ? 'border-destructive/60' : mins >= 8 ? 'border-amber-500/60' : 'border-border'

  return (
    <div className={cn('flex flex-col rounded-lg border-2 bg-card shadow-sm', urgency)}>
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="font-semibold">Table {order.table?.number ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{order.orderNumber}</div>
        </div>
        <div
          className={cn(
            'flex items-center gap-1 text-sm font-medium',
            mins >= 15 ? 'text-destructive' : mins >= 8 ? 'text-amber-600' : 'text-muted-foreground'
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {elapsed(order.createdAt)}
        </div>
      </div>
      <div className="divide-y px-3 py-1">
        {order.items.map((item) => (
          <ItemRow key={item._id} orderId={order._id} item={item} />
        ))}
      </div>
    </div>
  )
}

const COLUMNS: { id: string; label: string; statuses: string[]; accent: string }[] = [
  {
    id: 'queue',
    label: 'Queue',
    statuses: ['pending', 'confirmed'],
    accent: 'border-b-sky-400',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    statuses: ['preparing'],
    accent: 'border-b-amber-400',
  },
  {
    id: 'done',
    label: 'Done',
    statuses: ['ready'],
    accent: 'border-b-success',
  },
]

export function KdsBoard() {
  const { user } = useAuth()
  const restaurantId =
    typeof user?.restaurant === 'string' ? user.restaurant : user?.restaurant?._id
  const { data: orders, isLoading, isError, error } = useKdsOrders()
  useKdsRealtime(restaurantId)
  const connected = useSocketConnected()
  useTick()

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kitchen Display</h1>
          <p className="text-sm text-muted-foreground">
            Live order queue — oldest first. Start and finish each dish.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              connected ? 'animate-pulse bg-success' : 'bg-muted-foreground/40'
            )}
          />
          {connected ? 'Live' : 'Reconnecting…'}
          {orders && <span className="ml-2">· {orders.length} active</span>}
        </div>
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as { message?: string })?.message ?? 'Failed to load the kitchen board'}
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-3 gap-4 overflow-hidden">
          {COLUMNS.map((col) => {
            const colOrders = (orders ?? []).filter((o) => col.statuses.includes(o.status))
            return (
              <div key={col.id} className="flex flex-col gap-3 overflow-hidden">
                {/* Column header */}
                <div
                  className={cn(
                    'flex items-center justify-between rounded-md border-b-2 bg-muted/40 px-3 py-2',
                    col.accent
                  )}
                >
                  <span className="font-semibold">{col.label}</span>
                  <Badge variant="outline">{colOrders.length}</Badge>
                </div>

                {/* Scrollable ticket list */}
                <div className="flex flex-col gap-3 overflow-y-auto pb-2 pr-1">
                  {colOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
                      <ChefHat className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">Empty</p>
                    </div>
                  ) : (
                    colOrders.map((order) => <Ticket key={order._id} order={order} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
