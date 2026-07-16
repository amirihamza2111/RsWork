import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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

export function usePayments(params: { page: number; status?: string; method?: string }) {
  return useQuery({
    queryKey: ['payments', params],
    queryFn: () =>
      api.get<PaymentsPage>('/api/payments', {
        page: params.page,
        ...(params.status ? { status: params.status } : {}),
        ...(params.method ? { method: params.method } : {}),
      }),
    // Keep the current page visible while the next one loads (no flicker).
    placeholderData: keepPreviousData,
  })
}
