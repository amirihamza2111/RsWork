import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type TableStatus = 'available' | 'occupied' | 'reserved'

export interface RestaurantTable {
  _id: string
  number: number
  capacity: number
  status: TableStatus
  qrCode?: string // data URL (base64 PNG)
  isActive: boolean
  assignedWaiter?: { _id: string; name?: string } | string | null
}

export function useTables() {
  return useQuery({
    queryKey: ['tables'],
    queryFn: () => api.get<{ tables: RestaurantTable[] }>('/api/tables'),
    select: (d) => [...d.tables].sort((a, b) => a.number - b.number),
  })
}

export function useTableMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tables'] })

  const create = useMutation({
    mutationFn: (body: { number: number; capacity: number }) => api.post('/api/tables', body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      number?: number
      capacity?: number
      status?: TableStatus
      assignedWaiter?: string | null
    }) => api.put(`/api/tables/${id}`, body),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tables/${id}`),
    onSuccess: invalidate,
  })
  const regenerateAll = useMutation({
    mutationFn: () => api.post('/api/tables/regenerate-all-qr'),
    onSuccess: invalidate,
  })
  // Force a full reshuffle of table sections across the connected waiters.
  const autoAssign = useMutation({
    mutationFn: () => api.post<{ changed: number; waiters: number }>('/api/tables/auto-assign'),
    onSuccess: invalidate,
  })
  return { create, update, remove, regenerateAll, autoAssign }
}
