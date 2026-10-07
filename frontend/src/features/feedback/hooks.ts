import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must, pageRange, toApiError } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { useRestaurantId } from '@/features/auth/auth-context'

export interface FeedbackRow {
  _id: string
  rating: number
  comment?: string
  category?: string
  status: 'new' | 'reviewed'
  createdAt: string
  reviewedAt?: string
  table?: { number?: number }
  order?: { orderNumber?: string }
}

export interface FeedbackPage {
  feedbacks: FeedbackRow[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const LIMIT = 20

interface Row {
  id: string
  rating: number
  comment: string | null
  category: string
  status: FeedbackRow['status']
  created_at: string
  reviewed_at: string | null
  table: { number: number } | null
  order: { order_number: string } | null
}

export function useFeedbacks(params: { page: number; status?: string }) {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['feedbacks', restaurantId, params],
    enabled: Boolean(restaurantId),
    queryFn: async (): Promise<FeedbackPage> => {
      const [from, to] = pageRange(params.page, LIMIT)
      let query = supabase
        .from('feedback')
        .select('id, rating, comment, category, status, created_at, reviewed_at, table:tables(number), order:orders(order_number)', {
          count: 'exact',
        })
        .eq('restaurant_id', restaurantId!)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (params.status === 'new' || params.status === 'reviewed') query = query.eq('status', params.status)
      const { data, error, count } = await query
      if (error) throw toApiError(error)
      const total = count ?? 0
      return {
        feedbacks: (data as unknown as Row[]).map((f) => ({
          _id: f.id,
          rating: f.rating,
          comment: f.comment ?? undefined,
          category: f.category,
          status: f.status,
          createdAt: f.created_at,
          reviewedAt: f.reviewed_at ?? undefined,
          table: f.table ? { number: f.table.number } : undefined,
          order: f.order ? { orderNumber: f.order.order_number } : undefined,
        })),
        total,
        page: params.page,
        limit: LIMIT,
        totalPages: Math.max(1, Math.ceil(total / LIMIT)),
      }
    },
    placeholderData: keepPreviousData,
  })
}

export function useUnreadCount() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['feedbacks', restaurantId, 'unread'],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId!)
        .eq('status', 'new')
      if (error) throw toApiError(error)
      return count ?? 0
    },
  })
}

export function useMarkReviewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      must(
        await supabase
          .from('feedback')
          .update({ status: reviewed ? 'reviewed' : 'new', reviewed_at: reviewed ? new Date().toISOString() : null })
          .eq('id', id)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedbacks'] })
    },
  })
}
