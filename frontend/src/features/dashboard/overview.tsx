import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  TrendingUp,
  ShoppingBag,
  Clock,
  Armchair,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { invoke } from '@/lib/backend'
import type { AiReport } from '@/lib/pdf/aiReport'
import { useAuth } from '@/features/auth/auth-context'
import { useDashboardStats, useTopItems, useWeeklyReport, type WeeklyPoint } from './hooks'

// Analytics + narrative come from the `ai-report` Edge Function; the PDF is
// rendered in the browser.
async function downloadAiReport(restaurantId: string) {
  const [report, { downloadAiReportPdf }] = await Promise.all([
    invoke<AiReport>('ai-report', { restaurantId }),
    import('@/lib/pdf/aiReport'),
  ])
  await downloadAiReportPdf(report)
}

function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  loading,
}: {
  label: string
  value: string
  delta?: { pct: number; suffix: string } | null
  icon: LucideIcon
  loading?: boolean
}) {
  const isUp = delta && delta.pct >= 0
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3 text-2xl font-semibold tracking-tight">
          {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : value}
        </div>
        {delta && !loading && (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-xs font-medium',
              isUp ? 'text-success' : 'text-destructive'
            )}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isUp ? '+' : ''}
            {delta.pct.toFixed(0)}% {delta.suffix}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// Compare the last day of the weekly series to the day before it.
function computePreviousDeltas(report: WeeklyPoint[] | undefined) {
  if (!report || report.length < 2) return { revenueDelta: null, ordersDelta: null }
  const last = report[report.length - 1]
  const prev = report[report.length - 2]
  const pct = (curr: number, previous: number) =>
    previous > 0 ? ((curr - previous) / previous) * 100 : curr > 0 ? 100 : 0
  return {
    revenueDelta: { pct: pct(last.totalRevenue, prev.totalRevenue), suffix: 'vs yesterday' },
    ordersDelta: { pct: pct(last.totalOrders, prev.totalOrders), suffix: 'vs yesterday' },
  }
}

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  })

export function DashboardOverview() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const currency = user?.restaurant?.settings?.currency ?? 'TND'

  const stats = useDashboardStats()
  const weekly = useWeeklyReport()
  const topItems = useTopItems()

  const anyError = (stats.error || weekly.error || topItems.error) as
    | { message?: string }
    | undefined

  const { revenueDelta, ordersDelta } = computePreviousDeltas(weekly.data)

  // Trend chart uses real weekly data.
  const chartData = (weekly.data ?? []).map((p) => ({
    day: shortDay(p.date),
    revenue: p.totalRevenue,
  }))

  // Top items — pick the highest quantity so all bars scale off it.
  const maxQty = Math.max(1, ...(topItems.data ?? []).map((i) => i.totalQuantity))

  const [downloading, setDownloading] = useState(false)
  const onDownload = async () => {
    if (!user?.restaurant) return
    setDownloading(true)
    try {
      await downloadAiReport(user.restaurant._id)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('overview.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('overview.welcome', { name: user?.name ? `, ${user.name.split(' ')[0]}` : '' })}
          </p>
        </div>
        <Button onClick={onDownload} disabled={downloading}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('overview.downloadReport')}
        </Button>
      </div>

      {anyError?.message && <ErrorBanner message={anyError.message} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('overview.revenueToday')}
          value={formatCurrency(stats.data?.totalRevenueToday ?? 0, currency)}
          delta={revenueDelta}
          icon={TrendingUp}
          loading={stats.isLoading}
        />
        <StatCard
          label={t('overview.ordersToday')}
          value={String(stats.data?.totalOrdersToday ?? 0)}
          delta={ordersDelta}
          icon={ShoppingBag}
          loading={stats.isLoading}
        />
        <StatCard
          label={t('overview.pendingOrders')}
          value={String(stats.data?.pendingOrders ?? 0)}
          icon={Clock}
          loading={stats.isLoading}
        />
        <StatCard
          label={t('overview.tablesOccupied')}
          value={String(stats.data?.occupiedTables ?? 0)}
          icon={Armchair}
          loading={stats.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue — last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {weekly.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: -20, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4E7C9B" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#c4d7e4" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        color: 'hsl(var(--card-foreground))',
                        fontSize: 12,
                      }}
                      formatter={(value) => formatCurrency(Number(value) || 0, currency)}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="#4E7C9B" strokeWidth={2} fill="url(#rev)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topItems.isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (topItems.data?.length ?? 0) === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No items yet
              </div>
            ) : (
              topItems.data!.map((item) => (
                <div key={item.itemName} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2">{item.itemName}</span>
                    <span className="shrink-0 font-medium text-muted-foreground">
                      {item.totalQuantity}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(item.totalQuantity / maxQty) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
