import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type StaffRole = 'waiter' | 'cashier' | 'cook' | 'manager'

export interface StaffUser {
  _id: string
  name: string
  email: string
  role: StaffRole | 'superadmin' | 'client'
  phone?: string
  isActive: boolean
  isVerified?: boolean
}

// Roles a manager may assign (mirrors the backend's MANAGER_ALLOWED_ROLES).
export const ASSIGNABLE_ROLES: StaffRole[] = ['waiter', 'cashier', 'cook', 'manager']

export function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<{ users: StaffUser[] }>('/api/staff'),
    // Show active first, then alphabetical — stable, predictable ordering.
    select: (d) =>
      [...d.users].sort(
        (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)
      ),
  })
}

export function useStaffMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff'] })

  const create = useMutation({
    mutationFn: (body: { name: string; email: string; password: string; role: StaffRole; phone?: string }) =>
      api.post('/api/staff', body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; phone?: string; role?: StaffRole; isActive?: boolean }) =>
      api.put(`/api/users/${id}`, body),
    onSuccess: invalidate,
  })
  // Backend soft-deletes (sets isActive=false) so historical orders keep their ref.
  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/api/users/${id}`),
    onSuccess: invalidate,
  })
  return { create, update, deactivate }
}
