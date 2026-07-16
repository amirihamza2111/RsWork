import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Restaurant {
  _id: string
  name: string
  type?: string
  address?: string
  phone?: string
  settings?: { currency?: string; language?: string; timezone?: string }
}

export function useRestaurant() {
  return useQuery({
    queryKey: ['restaurant', 'me'],
    queryFn: () => api.get<{ restaurant: Restaurant }>('/api/restaurants/me'),
    select: (data) => data.restaurant,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCurrency() {
  const { data } = useRestaurant()
  return data?.settings?.currency ?? 'TND'
}
