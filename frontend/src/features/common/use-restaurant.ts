import { useAuth } from '@/features/auth/auth-context'

// Currency of the restaurant the signed-in user works in.
export function useCurrency() {
  return useAuth().user?.restaurant?.settings?.currency ?? 'TND'
}
