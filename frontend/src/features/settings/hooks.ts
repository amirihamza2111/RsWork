import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must, rpc } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { useAuth, useRestaurantId } from '@/features/auth/auth-context'

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

interface RestaurantRow {
  id: string
  name: string
  type: string
  address: string | null
  phone: string | null
  logo: string | null
  lat: number | null
  lng: number | null
  geofence_radius: number
  settings: Restaurant['settings']
}

export async function fetchRestaurant(id: string): Promise<Restaurant> {
  const r = must<RestaurantRow>(await supabase.from('restaurants').select('*').eq('id', id).single())
  return {
    _id: r.id,
    name: r.name,
    type: r.type,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    logo: r.logo ?? undefined,
    location: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : undefined,
    geofenceRadius: r.geofence_radius,
    settings: r.settings ?? {},
  }
}

export function useMyRestaurant() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['restaurant', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: () => fetchRestaurant(restaurantId!),
  })
}

export function useUpdateRestaurant() {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<Omit<Restaurant, 'location'>> & { id: string; location?: Restaurant['location'] | null }) =>
      rpc('update_restaurant', { p_restaurant: id, p_patch: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restaurant'] })
      // Name/currency also live on the signed-in user's restaurant.
      void refresh()
    },
  })
}
