import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Star, Loader2, MessageSquare, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { cn } from '@/lib/utils'
import { useFeedbacks, useMarkReviewed, useUnreadCount, type FeedbackRow } from './hooks'

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            'h-4 w-4',
            n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  )
}

const TABS = [
  { key: '', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'reviewed', label: 'Reviewed' },
]

function FeedbackCard({ item }: { item: FeedbackRow }) {
  const markReviewed = useMarkReviewed()
  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Stars rating={item.rating} />
          {item.status === 'new' ? (
            <Badge variant="warning">new</Badge>
          ) : (
            <Badge variant="success">reviewed</Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(item.createdAt).toLocaleString(undefined, {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {item.comment && <p className="text-sm">{item.comment}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3 text-xs text-muted-foreground">
          {item.table?.number != null && <span>Table {item.table.number}</span>}
          {item.order?.orderNumber && <span>{item.order.orderNumber}</span>}
          {item.category && <span>{item.category}</span>}
        </div>
        {item.status === 'new' && (
          <Button
            variant="outline"
            size="sm"
            disabled={markReviewed.isPending}
            onClick={() => markReviewed.mutate({ id: item._id, reviewed: true })}
          >
            <Check className="h-4 w-4" />
            Mark reviewed
          </Button>
        )}
      </div>
    </div>
  )
}

export function FeedbackPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const { data, isLoading, isError, error } = useFeedbacks({ page, status })
  const unread = useUnreadCount()

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t('feedback.title')}</h1>
            {(unread.data ?? 0) > 0 && <Badge variant="warning">{unread.data} new</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{t('feedback.subtitle')}</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setStatus(t.key)
              setPage(1)
            }}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              status === t.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="p-6 text-sm text-destructive">
              {(error as { message?: string })?.message ?? 'Failed to load feedback'}
            </div>
          ) : (data?.feedbacks.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No feedback yet.</p>
            </div>
          ) : (
            <>
              <div className="divide-y">
                {data!.feedbacks.map((item) => (
                  <FeedbackCard key={item._id} item={item} />
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
