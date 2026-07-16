import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { CreditCard, Loader2, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import { usePayments, type PaymentRow } from './hooks'

const statusVariant: Record<PaymentRow['status'], 'success' | 'warning' | 'destructive' | 'outline'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'destructive',
  refunded: 'outline',
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

export function PaymentsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const currency =
    (user?.restaurant as { settings?: { currency?: string } } | undefined)?.settings?.currency ?? 'TND'

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')

  const { data, isLoading, isError, error } = usePayments({ page, status, method })

  const onFilter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value)
    setPage(1)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('payments.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('payments.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={status} onChange={onFilter(setStatus)} className="w-40">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </Select>
        <Select value={method} onChange={onFilter(setMethod)} className="w-40">
          <option value="">All methods</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="p-6 text-sm text-destructive">
              {(error as { message?: string })?.message ?? 'Failed to load payments'}
            </div>
          ) : (data?.payments.length ?? 0) === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No payments found
            </div>
          ) : (
            <>
              {/* Column header */}
              <div className="hidden grid-cols-12 gap-3 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
                <span className="col-span-4">Order</span>
                <span className="col-span-3 text-right">Amount</span>
                <span className="col-span-2">Method</span>
                <span className="col-span-3 text-right">Date</span>
              </div>
              <div className="divide-y">
                {data!.payments.map((p) => (
                  <div key={p._id} className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-12 sm:items-center">
                    <div className="sm:col-span-4">
                      <div className="font-medium">{p.order?.orderNumber ?? '—'}</div>
                      <Badge variant={statusVariant[p.status]} className="mt-1">
                        {p.status}
                      </Badge>
                    </div>
                    <div className="text-right font-semibold sm:col-span-3">
                      {formatCurrency(p.amount, currency)}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground sm:col-span-2">
                      {p.method === 'card' ? (
                        <CreditCard className="h-4 w-4" />
                      ) : (
                        <Wallet className="h-4 w-4" />
                      )}
                      {p.method}
                    </div>
                    <div className="text-right text-sm text-muted-foreground sm:col-span-3">
                      {formatDateTime(p.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
              {data && (
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  total={data.total}
                  limit={data.limit}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
