import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { must, rpc } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { useRestaurantId } from '@/features/auth/auth-context'

export type TableStatus = 'available' | 'occupied' | 'reserved'

export interface RestaurantTable {
  _id: string
  number: number
  capacity: number
  status: TableStatus
  qrCode?: string // data URL (PNG), rendered in the browser
  isActive: boolean
  assignedWaiter?: { _id: string; name?: string } | string | null
}

interface TableRow {
  id: string
  number: number
  capacity: number
  status: TableStatus
  is_active: boolean
  assigned_waiter: { id: string; name: string } | null
}

// The QR encodes the diner menu URL for the table on this deployment.
export const tableMenuUrl = (tableId: string) => `${window.location.origin}/menu?tableId=${tableId}`

export function useTables() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['tables', restaurantId],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const rows = must(
        await supabase
          .from('tables')
          .select('id, number, capacity, status, is_active, assigned_waiter:profiles!tables_assigned_waiter_id_fkey(id, name)')
          .eq('restaurant_id', restaurantId!)
          .order('number')
      ) as unknown as TableRow[]
      return Promise.all(
        rows.map(
          async (t): Promise<RestaurantTable> => ({
            _id: t.id,
            number: t.number,
            capacity: t.capacity,
            status: t.status,
            isActive: t.is_active,
            assignedWaiter: t.assigned_waiter ? { _id: t.assigned_waiter.id, name: t.assigned_waiter.name } : null,
            qrCode: await QRCode.toDataURL(tableMenuUrl(t.id), { margin: 1, width: 512 }),
          })
        )
      )
    },
  })
}

export function useTableMutations() {
  const qc = useQueryClient()
  const restaurantId = useRestaurantId()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tables'] })

  const create = useMutation({
    mutationFn: async (body: { number: number; capacity: number }) => {
      const { error } = await supabase
        .from('tables')
        .insert({ restaurant_id: restaurantId, number: body.number, capacity: body.capacity || 4 })
      if (error?.code === '23505') throw { status: 409, message: 'Table number already exists' }
      must({ data: null, error })
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string
      number?: number
      capacity?: number
      status?: TableStatus
      assignedWaiter?: string | null
    }) => {
      const { error } = await supabase
        .from('tables')
        .update({
          ...(body.number !== undefined ? { number: body.number } : {}),
          ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
          ...(body.status ? { status: body.status } : {}),
          // '' / null clears the section assignment.
          ...(body.assignedWaiter !== undefined ? { assigned_waiter_id: body.assignedWaiter || null } : {}),
        })
        .eq('id', id)
      if (error?.code === '23505') throw { status: 409, message: 'Table number already exists' }
      must({ data: null, error })
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('tables').delete().eq('id', id)),
    onSuccess: invalidate,
  })
  // Force a full reshuffle of table sections across the waiters on the floor.
  const autoAssign = useMutation({
    mutationFn: () => rpc<{ changed: number; waiters: number }>('auto_assign_sections', { p_restaurant: restaurantId }),
    onSuccess: invalidate,
  })
  return { create, update, remove, autoAssign }
}
