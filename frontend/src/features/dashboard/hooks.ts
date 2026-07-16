import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
  return useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => api.get<DashboardStats>('/api/reports/dashboard'),
  })
}

export function useWeeklyReport() {
  return useQuery({
    queryKey: ['reports', 'weekly'],
    queryFn: () => api.get<{ report: WeeklyPoint[] }>('/api/reports/weekly'),
    select: (data) => data.report,
  })
}

export function useTopItems() {
  return useQuery({
    queryKey: ['reports', 'top-items'],
    queryFn: () => api.get<{ topItems: TopItem[] }>('/api/reports/top-items'),
    select: (data) => data.topItems,
  })
}
