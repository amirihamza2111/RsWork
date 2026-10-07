import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { must } from '@/lib/backend'
import { deleteMenuImage, uploadMenuImage } from '@/lib/images'
import { supabase } from '@/lib/supabase'
import { useRestaurantId } from '@/features/auth/auth-context'

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

interface CategoryRow {
  id: string
  name: Trilingual
  sort_order: number | null
  is_active: boolean
}

interface MenuItemRow {
  id: string
  name: Trilingual
  description: Trilingual | null
  price: number
  category_id: string
  prep_station: 'kitchen' | 'bar'
  is_available: boolean
  is_vegetarian: boolean
  is_gluten_free: boolean
  image: string | null
}

export const toCategory = (c: CategoryRow): Category => ({
  _id: c.id,
  name: c.name,
  order: c.sort_order ?? undefined,
  isActive: c.is_active,
})

export const toMenuItem = (m: MenuItemRow): MenuItem => ({
  _id: m.id,
  name: m.name,
  description: m.description ?? undefined,
  price: Number(m.price),
  category: m.category_id,
  prepStation: m.prep_station,
  isAvailable: m.is_available,
  isVegetarian: m.is_vegetarian,
  isGlutenFree: m.is_gluten_free,
  image: m.image ?? undefined,
})

export async function fetchCategories(restaurantId: string) {
  const rows = must<CategoryRow[]>(
    await supabase
      .from('categories')
      .select('id, name, sort_order, is_active')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at')
  )
  return rows.map(toCategory)
}

export async function fetchMenuItems(restaurantId: string, categoryId?: string) {
  let query = supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('created_at')
  if (categoryId) query = query.eq('category_id', categoryId)
  return must<MenuItemRow[]>(await query).map(toMenuItem)
}

export function useCategories() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['categories', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: () => fetchCategories(restaurantId!),
  })
}

export function useMenuItems(categoryId?: string) {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['menuItems', restaurantId, categoryId ?? 'all'],
    enabled: Boolean(restaurantId),
    queryFn: () => fetchMenuItems(restaurantId!, categoryId),
  })
}

/* --------------------------------- Mutations -------------------------------- */

export function useCategoryMutations() {
  const qc = useQueryClient()
  const restaurantId = useRestaurantId()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] })

  const create = useMutation({
    mutationFn: async (body: { name: Trilingual; order?: number }) =>
      must(
        await supabase
          .from('categories')
          .insert({ restaurant_id: restaurantId, name: body.name, sort_order: body.order ?? null })
      ),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({ id, name, isActive }: { id: string; name?: Trilingual; isActive?: boolean }) =>
      must(
        await supabase
          .from('categories')
          .update({ ...(name ? { name } : {}), ...(isActive !== undefined ? { is_active: isActive } : {}) })
          .eq('id', id)
      ),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('categories').delete().eq('id', id)),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

interface MenuItemValues {
  name: Trilingual
  price: number
  category: string
  prepStation: 'kitchen' | 'bar'
}

const itemColumns = (v: MenuItemValues) => ({
  name: v.name,
  price: v.price,
  category_id: v.category,
  prep_station: v.prepStation,
})

export function useMenuItemMutations() {
  const qc = useQueryClient()
  const restaurantId = useRestaurantId()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['menuItems'] })

  const create = useMutation({
    mutationFn: async ({ values, imageFile }: { values: MenuItemValues; imageFile?: File | null }) => {
      const image = imageFile ? await uploadMenuImage(imageFile, restaurantId!) : undefined
      must(
        await supabase
          .from('menu_items')
          .insert({ ...itemColumns(values), restaurant_id: restaurantId, ...(image ? { image } : {}) })
      )
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      values,
      imageFile,
      previousImage,
    }: {
      id: string
      values: MenuItemValues
      imageFile?: File | null
      previousImage?: string
    }) => {
      const image = imageFile ? await uploadMenuImage(imageFile, restaurantId!) : undefined
      must(await supabase.from('menu_items').update({ ...itemColumns(values), ...(image ? { image } : {}) }).eq('id', id))
      // Remove the replaced photo only once the item points at the new one.
      if (image && previousImage) await deleteMenuImage(previousImage)
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const row = must<{ image: string | null }[]>(await supabase.from('menu_items').delete().eq('id', id).select('image'))
      if (row[0]?.image) await deleteMenuImage(row[0].image)
    },
    onSuccess: invalidate,
  })
  const toggle = useMutation({
    mutationFn: async (id: string) => {
      const current = must<{ is_available: boolean }>(
        await supabase.from('menu_items').select('is_available').eq('id', id).single()
      )
      must(await supabase.from('menu_items').update({ is_available: !current.is_available }).eq('id', id))
    },
    onSuccess: invalidate,
  })
  return { create, update, remove, toggle }
}
