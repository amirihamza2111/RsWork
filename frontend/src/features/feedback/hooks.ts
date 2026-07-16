import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

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

export function useFeedbacks(params: { page: number; status?: string }) {
  return useQuery({
    queryKey: ['feedbacks', params],
    queryFn: () =>
      api.get<FeedbackPage>('/api/feedbacks', {
        page: params.page,
        ...(params.status ? { status: params.status } : {}),
      }),
    placeholderData: keepPreviousData,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['feedbacks', 'unread'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/feedbacks/unread-count'),
    select: (d) => d.unreadCount,
  })
}

export function useMarkReviewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      api.put(`/api/feedbacks/${id}/reviewed`, { reviewed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedbacks'] })
    },
  })
}
