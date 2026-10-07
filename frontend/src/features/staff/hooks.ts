import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, must } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { useRestaurantId } from '@/features/auth/auth-context'

export type StaffRole = 'waiter' | 'cashier' | 'cook' | 'manager'

export interface StaffUser {
  _id: string
  name: string
  email: string
  role: StaffRole | 'superadmin' | 'client'
  phone?: string
  isActive: boolean
}

// Roles a manager may assign (mirrors the staff-admin Edge Function).
export const ASSIGNABLE_ROLES: StaffRole[] = ['waiter', 'cashier', 'cook', 'manager']

interface ProfileRow {
  id: string
  name: string
  email: string
  role: StaffUser['role']
  phone: string | null
  is_active: boolean
}

export function useStaff() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['staff', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const rows = must<ProfileRow[]>(
        await supabase
          .from('profiles')
          .select('id, name, email, role, phone, is_active')
          .eq('restaurant_id', restaurantId!)
      )
      return rows.map(
        (p): StaffUser => ({
          _id: p.id,
          name: p.name,
          email: p.email,
          role: p.role,
          phone: p.phone ?? undefined,
          isActive: p.is_active,
        })
      )
    },
    // Show active first, then alphabetical — stable, predictable ordering.
    select: (users) =>
      [...users].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
  })
}

// Account changes need the Auth admin API, so they go through an Edge Function.
export function useStaffMutations() {
  const qc = useQueryClient()
  const restaurantId = useRestaurantId()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff'] })

  const create = useMutation({
    mutationFn: (body: { name: string; email: string; password: string; role: StaffRole; phone?: string }) =>
      invoke('staff-admin', { action: 'create', restaurantId, ...body }),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; phone?: string; role?: StaffRole; isActive?: boolean }) =>
      invoke('staff-admin', { action: 'update', userId: id, ...body }),
    onSuccess: invalidate,
  })
  // Soft delete: the account is deactivated (and can't sign in) so historical
  // orders keep referencing it.
  const deactivate = useMutation({
    mutationFn: (id: string) => invoke('staff-admin', { action: 'deactivate', userId: id }),
    onSuccess: invalidate,
  })
  return { create, update, deactivate }
}
