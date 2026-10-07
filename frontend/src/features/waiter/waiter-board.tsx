import { useEffect, useState } from 'react'
import {
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  CreditCard,
  Hand,
  Loader2,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import { useBillRequests } from '@/features/cashier/hooks'
import {
  useWaiterOrders,
  useWaiterRealtime,
  useMarkServed,
  useClaimOrder,
  useMyTables,
  itemDisplayName,
  orderWaiterId,
  orderWaiterName,
  type WaiterOrder,
} from './hooks'

function useTick(ms = 30_000) {
  const [, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function OrderCard({ order, ready, meId }: { order: WaiterOrder; ready: boolean; meId: string }) {
  const serve = useMarkServed()
  const claim = useClaimOrder()

  const ownerId = orderWaiterId(order)
  const mine = ownerId === meId
  const unassigned = !ownerId

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border-2 bg-card shadow-sm transition-colors',
        ready ? 'border-success/70' : 'border-amber-400/50',
        !mine && !unassigned && 'opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="font-semibold">Table {order.table?.number ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{order.orderNumber}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {elapsed(order.createdAt)}
          </div>
          {mine ? (
            <Badge variant="success" className="text-[10px]">Yours</Badge>
          ) : unassigned ? (
            <Badge variant="warning" className="text-[10px]">Unassigned</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">{orderWaiterName(order) || 'Colleague'}</Badge>
          )}
        </div>
      </div>

      <div className="space-y-0.5 px-3 py-2 text-sm">
        {order.items.map((item) => (
          <div key={item._id} className="flex gap-1.5 text-sm">
            <span className="font-semibold">{item.quantity}×</span>
            <span>{itemDisplayName(item)}</span>
          </div>
        ))}
      </div>

      <div className="border-t px-3 py-2">
        {unassigned ? (
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={claim.isPending}
              onClick={() => claim.mutate(order._id)}
            >
              <Hand className="h-4 w-4" />
              Claim
            </Button>
            {claim.isError && (
              <p className="text-center text-xs text-destructive">
                {(claim.error as { message?: string })?.message ?? 'Claim failed'}
              </p>
            )}
          </div>
        ) : ready && mine ? (
          <Button
            size="sm"
            className="w-full gap-1.5"
            disabled={serve.isPending}
            onClick={() => serve.mutate(order._id)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark as Served
          </Button>
        ) : ready ? (
          <Badge variant="outline" className="w-full justify-center py-1">
            {orderWaiterName(order) ? `${orderWaiterName(order)} is serving` : 'Being served'}
          </Badge>
        ) : (
          <Badge variant="warning" className="w-full justify-center py-1">
            In kitchen…
          </Badge>
        )}
      </div>
    </div>
  )
}

export function WaiterBoard() {
  const { user } = useAuth()
  const meId = user?._id ?? ''
  const restaurantId =
    typeof user?.restaurant === 'string' ? user.restaurant : user?.restaurant?._id
  const { data: orders, isLoading, isError, error } = useWaiterOrders()
  const { data: myTables } = useMyTables()
  const { requests, dismiss } = useBillRequests(restaurantId)
  useWaiterRealtime(restaurantId)
  useTick()

  const readyOrders = (orders ?? []).filter((o) => o.status === 'ready')
  const kitchenOrders = (orders ?? []).filter((o) => o.status !== 'ready')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Orders</h1>
          <p className="text-sm text-muted-foreground">
            Serve highlighted orders first. Mark them delivered when done.
          </p>
          {(myTables?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">My tables:</span>
              {myTables!.map((t) => (
                <Badge key={t._id} variant="outline" className="px-2">
                  {t.number}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {readyOrders.length > 0 && (
          <Badge variant="success" className="gap-1.5 px-3 py-1 text-sm">
            <Bell className="h-3.5 w-3.5" />
            {readyOrders.length} ready to serve
          </Badge>
        )}
      </div>

      {/* Live "diner wants to pay" alerts */}
      {requests.length > 0 && (
        <div className="space-y-2">
          {requests.map((r) => (
            <div
              key={r.orderId}
              className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            >
              <BellRing className="h-5 w-5 shrink-0 animate-pulse text-primary" />
              <div className="flex-1 text-sm">
                <span className="font-semibold">Table {r.table?.number ?? '—'}</span> wants to pay
                <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
                  {r.method === 'card' ? <CreditCard className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                  {r.method}
                </span>
              </div>
              <button
                onClick={() => dismiss(r.orderId)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as { message?: string })?.message ?? 'Failed to load orders'}
        </div>
      ) : (orders?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-24 text-center">
          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No active orders — all quiet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {readyOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-success">
                <CheckCircle2 className="h-4 w-4" />
                Ready to Serve ({readyOrders.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {readyOrders.map((o) => (
                  <OrderCard key={o._id} order={o} ready meId={meId} />
                ))}
              </div>
            </section>
          )}

          {kitchenOrders.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-600">
                <Clock className="h-4 w-4" />
                In Kitchen ({kitchenOrders.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {kitchenOrders.map((o) => (
                  <OrderCard key={o._id} order={o} ready={false} meId={meId} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
