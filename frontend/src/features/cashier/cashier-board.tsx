import { useMemo, useState, type FormEvent } from 'react'
import {
  BellRing,
  CheckCircle2,
  CreditCard,
  Loader2,
  Receipt,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import {
  useActiveByTable,
  usePayCash,
  useCashierRealtime,
  useBillRequests,
  downloadReceipt,
  itemDisplayName,
  type CashierOrder,
} from './hooks'

interface SettledOrder {
  _id: string
  orderNumber: string
  amount: number
}

export function CashierBoard() {
  const { user } = useAuth()
  const restaurantId =
    typeof user?.restaurant === 'string' ? user.restaurant : user?.restaurant?._id
  const currency =
    (user?.restaurant as { settings?: { currency?: string } } | undefined)?.settings?.currency ??
    'TND'

  const [input, setInput] = useState('')
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  // Orders paid in this checkout session — kept locally so the receipt stays
  // downloadable after the paid order drops out of the unpaid list.
  const [settled, setSettled] = useState<SettledOrder[]>([])
  const [receiptError, setReceiptError] = useState<string | null>(null)

  const { data, isLoading, isError, error, isFetching } = useActiveByTable(tableNumber)
  const payCash = usePayCash()
  useCashierRealtime(restaurantId)
  const { requests, dismiss } = useBillRequests(restaurantId)

  const money = (v: number) => formatCurrency(v, currency)

  function goToTable(n?: number) {
    if (n == null) return
    setInput(String(n))
    setSettled([])
    setReceiptError(null)
    setTableNumber(n)
  }

  const settledIds = useMemo(() => new Set(settled.map((s) => s._id)), [settled])
  const unpaid = (data?.orders ?? []).filter((o) => !settledIds.has(o._id))
  const totalDue = unpaid.reduce((sum, o) => sum + (o.totalAmount || 0), 0)

  function lookUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const n = Number(input)
    if (!Number.isFinite(n) || n <= 0) return
    setSettled([])
    setReceiptError(null)
    setTableNumber(n)
  }

  async function pay(order: CashierOrder) {
    await payCash.mutateAsync(order._id)
    setSettled((prev) => [
      ...prev,
      { _id: order._id, orderNumber: order.orderNumber, amount: order.totalAmount || 0 },
    ])
  }

  async function payAll() {
    for (const order of unpaid) {
      // Sequential so a mid-batch failure leaves the rest recoverable.
      // eslint-disable-next-line no-await-in-loop
      await pay(order)
    }
  }

  async function receipt(orderId: string, orderNumber: string) {
    setReceiptError(null)
    try {
      await downloadReceipt(orderId, orderNumber)
    } catch (err) {
      setReceiptError((err as { message?: string })?.message ?? 'Could not download receipt')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        <p className="text-sm text-muted-foreground">
          Enter a table number to settle its bill.
        </p>
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
              <Button size="sm" variant="outline" onClick={() => { goToTable(r.table?.number); dismiss(r.orderId) }}>
                Settle
              </Button>
              <button onClick={() => dismiss(r.orderId)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={lookUp} className="flex gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Table number"
          className="max-w-[180px]"
          autoFocus
        />
        <Button type="submit" className="gap-1.5">
          <Search className="h-4 w-4" />
          Look up
        </Button>
      </form>

      {tableNumber != null && (
        <>
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as { message?: string })?.message ?? 'Table lookup failed'}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Bill summary */}
              <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Table {data?.table.number ?? tableNumber}</span>
                  {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Total due</div>
                  <div className="text-lg font-semibold">{money(totalDue)}</div>
                </div>
              </div>

              {unpaid.length > 1 && (
                <Button
                  className="w-full gap-1.5"
                  disabled={payCash.isPending}
                  onClick={payAll}
                >
                  {payCash.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  Collect all in cash — {money(totalDue)}
                </Button>
              )}

              {unpaid.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No unpaid orders for this table.
                </div>
              ) : (
                <div className="space-y-3">
                  {unpaid.map((order) => (
                    <Card key={order._id}>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{order.orderNumber}</div>
                          <Badge variant="warning">{order.status}</Badge>
                        </div>
                        <div className="space-y-1 text-sm">
                          {order.items.map((item) => (
                            <div key={item._id} className="flex justify-between gap-2">
                              <span>
                                <span className="font-medium">{item.quantity}×</span>{' '}
                                {itemDisplayName(item)}
                              </span>
                              <span className="text-muted-foreground">
                                {money((item.price || 0) * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t pt-3">
                          <span className="text-sm text-muted-foreground">Order total</span>
                          <span className="font-semibold">{money(order.totalAmount || 0)}</span>
                        </div>
                        <Button
                          size="sm"
                          className="w-full gap-1.5"
                          disabled={payCash.isPending}
                          onClick={() => pay(order)}
                        >
                          <Wallet className="h-4 w-4" />
                          Collect cash
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Paid this session — receipt download */}
              {settled.length > 0 && (
                <section className="space-y-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Paid ({settled.length})
                  </h2>
                  {receiptError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                      {receiptError}
                    </div>
                  )}
                  <div className="space-y-2">
                    {settled.map((s) => (
                      <div
                        key={s._id}
                        className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{s.orderNumber}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{money(s.amount)}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => receipt(s._id, s.orderNumber)}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Receipt
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
