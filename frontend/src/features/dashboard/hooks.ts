import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/lib/backend'
import { useRestaurantId } from '@/features/auth/auth-context'

export interface DashboardStats {
  totalOrdersToday: number
  totalRevenueToday: number
  pendingOrders: number
  occupiedTables: number
}

export interface WeeklyPoint {
  date: string
  totalOrders: number
  totalRevenue: number
}

export interface TopItem {
  itemName: string
  totalQuantity: number
  totalRevenue: number
}

export function useDashboardStats() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['reports', restaurantId, 'dashboard'],
    enabled: Boolean(restaurantId),
    queryFn: () => rpc<DashboardStats>('report_dashboard', { p_restaurant: restaurantId }),
  })
}

export function useWeeklyReport() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['reports', restaurantId, 'weekly'],
    enabled: Boolean(restaurantId),
    queryFn: () => rpc<WeeklyPoint[]>('report_weekly', { p_restaurant: restaurantId }),
  })
}

export function useTopItems() {
  const restaurantId = useRestaurantId()
  return useQuery({
    queryKey: ['reports', restaurantId, 'top-items'],
    enabled: Boolean(restaurantId),
    queryFn: () => rpc<TopItem[]>('report_top_items', { p_restaurant: restaurantId, p_limit: 5 }),
  })
}
