import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/auth-context'

export interface Trilingual {
  fr: string
  en?: string
  ar?: string
}

export interface Category {
  _id: string
  name: Trilingual
  order?: number
  isActive: boolean
}

export interface MenuItem {
  _id: string
  name: Trilingual
  description?: Trilingual
  price: number
  category: string | { _id: string; name?: Trilingual }
  prepStation: 'kitchen' | 'bar'
  isAvailable: boolean
  isVegetarian?: boolean
  isGlutenFree?: boolean
  image?: string
}

// The manager's restaurant id — reads need it as a query param.
function useRestaurantId() {
  const { user } = useAuth()
  const r = user?.restaurant
  return typeof r === 'string' ? r : r?._id
}

export function useCategories() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['categories', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: () => api.get<{ categories: Category[] }>('/api/menu/categories', { restaurantId }),
    select: (d) => d.categories,
  })
}

export function useMenuItems(categoryId?: string) {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['menuItems', restaurantId, categoryId ?? 'all'],
    enabled: Boolean(restaurantId),
    queryFn: () =>
      api.get<{ menuItems: MenuItem[] }>('/api/menu/items', {
        restaurantId,
        ...(categoryId ? { categoryId } : {}),
      }),
    select: (d) => d.menuItems,
  })
}

/* --------------------------------- Mutations -------------------------------- */

export function useCategoryMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] })

  const create = useMutation({
    mutationFn: (body: { name: Trilingual; order?: number }) =>
      api.post('/api/menu/categories', body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: Trilingual; isActive?: boolean }) =>
      api.put(`/api/menu/categories/${id}`, body),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/menu/categories/${id}`),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useMenuItemMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['menuItems'] })

  const create = useMutation({
    mutationFn: (body: FormData | Record<string, unknown>) =>
      body instanceof FormData ? api.postForm('/api/menu/items', body) : api.post('/api/menu/items', body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FormData | Record<string, unknown> }) =>
      body instanceof FormData
        ? api.putForm(`/api/menu/items/${id}`, body)
        : api.put(`/api/menu/items/${id}`, body),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/menu/items/${id}`),
    onSuccess: invalidate,
  })
  const toggle = useMutation({
    mutationFn: (id: string) => api.patch(`/api/menu/items/${id}/toggle`),
    onSuccess: invalidate,
  })
  return { create, update, remove, toggle }
}
