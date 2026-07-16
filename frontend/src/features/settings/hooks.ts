import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Restaurant {
  _id: string
  name: string
  type?: string
  address?: string
  phone?: string
  logo?: string
  location?: { lat: number; lng: number }
  geofenceRadius?: number
  settings?: { currency?: string; language?: string; timezone?: string }
}

export function useMyRestaurant() {
  return useQuery({
    queryKey: ['restaurant', 'me'],
    queryFn: () => api.get<{ restaurant: Restaurant }>('/api/restaurants/me'),
    select: (d) => d.restaurant,
  })
}

export function useUpdateRestaurant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Restaurant> & { id: string }) =>
      api.put(`/api/restaurants/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['restaurant'] }),
  })
}
