import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toApiError, pageRange } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { useRestaurantId } from '@/features/auth/auth-context'

export interface PaymentRow {
  _id: string
  amount: number
  method: 'cash' | 'card'
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  createdAt: string
  paidAt?: string
  order?: { _id: string; orderNumber?: string; totalAmount?: number }
}

export interface PaymentsPage {
  payments: PaymentRow[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const LIMIT = 20

interface Row {
  id: string
  amount: number
  method: PaymentRow['method']
  status: PaymentRow['status']
  created_at: string
  paid_at: string | null
  order: { id: string; order_number: string; total_amount: number } | null
}

export function usePayments(params: { page: number; status?: string; method?: string }) {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['payments', restaurantId, params],
    enabled: Boolean(restaurantId),
    queryFn: async (): Promise<PaymentsPage> => {
      const [from, to] = pageRange(params.page, LIMIT)
      let query = supabase
        .from('payments')
        .select('id, amount, method, status, created_at, paid_at, order:orders(id, order_number, total_amount)', {
          count: 'exact',
        })
        .eq('restaurant_id', restaurantId!)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (params.status) query = query.eq('status', params.status)
      if (params.method) query = query.eq('method', params.method)
      const { data, error, count } = await query
      if (error) throw toApiError(error)
      const total = count ?? 0
      return {
        payments: (data as unknown as Row[]).map((p) => ({
          _id: p.id,
          amount: Number(p.amount),
          method: p.method,
          status: p.status,
          createdAt: p.created_at,
          paidAt: p.paid_at ?? undefined,
          order: p.order
            ? { _id: p.order.id, orderNumber: p.order.order_number, totalAmount: Number(p.order.total_amount) }
            : undefined,
        })),
        total,
        page: params.page,
        limit: LIMIT,
        totalPages: Math.max(1, Math.ceil(total / LIMIT)),
      }
    },
    // Keep the current page visible while the next one loads (no flicker).
    placeholderData: keepPreviousData,
  })
}
