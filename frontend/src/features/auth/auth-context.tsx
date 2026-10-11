import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { clearRestaurantSelection, getSelectedRestaurant, type ApiError } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import type { AuthRestaurant, AuthUser, Role } from './types'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  registerRestaurant: (payload: RegisterRestaurantPayload) => Promise<AuthUser>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<AuthUser | null>
}

interface RegisterRestaurantPayload {
  restaurantName: string
  name: string
  email: string
  password: string
  confirmPassword?: string
  currency?: string
  language?: string
}

// Accounts are used straight away: there is no email delivery, so the
// Supabase "Confirm email" setting must be off.
const CONFIRM_EMAIL_ON =
  'Sign-in is blocked because "Confirm email" is enabled in Supabase (Authentication → Sign In / Providers → Email). Turn it off.'

const toApiError = (error: AuthError, fallback?: string): ApiError & { code?: string } => ({
  status: error.status ?? 400,
  message: fallback ?? error.message,
  code: error.code,
})

interface RestaurantRow {
  id: string
  name: string
  settings: AuthRestaurant['settings']
}
const toRestaurant = (r: RestaurantRow | null): AuthRestaurant | undefined =>
  r ? { _id: r.id, name: r.name, settings: r.settings ?? {} } : undefined

// The signed-in user's profile, scoped to the restaurant they're working in:
// owners of several restaurants (and superadmins) can switch, and RLS only
// returns a selected restaurant they're actually allowed to manage.
async function loadProfile(): Promise<AuthUser | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) return null

  const { data: profile, error } = await supabase
    .from('profiles')
    .select(
      'id, name, email, role, phone, is_active, restaurant:restaurants!profiles_restaurant_id_fkey(id, name, settings)'
    )
    .eq('id', session.user.id)
    .maybeSingle()
  if (error || !profile || !profile.is_active) return null

  let restaurant = toRestaurant(profile.restaurant as unknown as RestaurantRow | null)
  const selected = getSelectedRestaurant()
  if (selected && selected !== restaurant?._id && ['manager', 'superadmin'].includes(profile.role)) {
    const { data } = await supabase.from('restaurants').select('id, name, settings').eq('id', selected).maybeSingle()
    if (data) restaurant = toRestaurant(data as RestaurantRow)
  }

  return {
    _id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role as Role,
    phone: profile.phone ?? undefined,
    isActive: profile.is_active,
    restaurant,
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const profile = await loadProfile()
      if (!profile) {
        // A session without an active profile (deactivated / deleted) is useless.
        const { data } = await supabase.auth.getSession()
        if (data.session) await supabase.auth.signOut()
      }
      setUser(profile)
      return profile
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Don't call Supabase from inside this callback (it can deadlock the auth
    // lock); only mirror sign-outs, e.g. from another tab or an expired refresh.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null)
    })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.code === 'email_not_confirmed') throw toApiError(error, CONFIRM_EMAIL_ON)
        throw toApiError(error, 'Invalid credentials')
      }
      const profile = await refresh()
      if (!profile) throw { status: 401, message: 'Account is not available' } satisfies ApiError
      return profile
    },
    [refresh]
  )

  // A database trigger creates the restaurant and makes this user its manager;
  // the new manager is signed in right away.
  const registerRestaurant = useCallback(
    async ({ restaurantName, name, email, password, currency, language }: RegisterRestaurantPayload) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            name,
            restaurant_name: restaurantName,
            currency,
            language,
            // Reports count days and peak hours in the restaurant's timezone.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      })
      if (error) throw toApiError(error)
      // With email enumeration protection on, an existing address returns a
      // user with no identities instead of an error.
      if (data.user && data.user.identities?.length === 0) {
        throw { status: 400, message: 'User already exists' } satisfies ApiError
      }
      if (!data.session) throw { status: 403, message: CONFIRM_EMAIL_ON } satisfies ApiError
      const profile = await refresh()
      if (!profile) throw { status: 500, message: 'The restaurant could not be created' } satisfies ApiError
      return profile
    },
    [refresh]
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!user?.email) throw { status: 401, message: 'Not signed in' } satisfies ApiError
      // Re-check the current password before allowing the change.
      const check = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (check.error) throw toApiError(check.error, 'Current password is incorrect')
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw toApiError(error)
    },
    [user]
  )

  const logout = useCallback(async () => {
    clearRestaurantSelection()
    setUser(null)
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        registerRestaurant,
        changePassword,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// The restaurant the signed-in staff member is working in.
// eslint-disable-next-line react-refresh/only-export-components
export function useRestaurantId() {
  return useAuth().user?.restaurant?._id
}
