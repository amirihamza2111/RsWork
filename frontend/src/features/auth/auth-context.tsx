import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { clearRestaurantSelection, getSelectedRestaurant, type ApiError } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import type { AuthRestaurant, AuthUser, Role } from './types'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  // Email awaiting OTP verification (set after registration or an unconfirmed login).
  pendingEmail: string | null
  login: (email: string, password: string) => Promise<AuthUser>
  registerRestaurant: (payload: RegisterRestaurantPayload) => Promise<void>
  verifyEmail: (code: string) => Promise<void>
  resendVerification: (email: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
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

const PENDING_EMAIL_KEY = 'rswork_pending_email'

export const EMAIL_NOT_CONFIRMED = 'email_not_confirmed'

const toApiError = (error: AuthError, fallback?: string): ApiError & { code?: string } => ({
  status: error.status ?? 400,
  message: fallback ?? error.message,
  code: error.code,
})

const readPendingEmail = () => {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY)
  } catch {
    return null
  }
}

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
    isVerified: Boolean(session.user.email_confirmed_at),
    restaurant,
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingEmail, setPendingEmailState] = useState<string | null>(readPendingEmail)

  const setPendingEmail = useCallback((email: string | null) => {
    try {
      if (email) sessionStorage.setItem(PENDING_EMAIL_KEY, email)
      else sessionStorage.removeItem(PENDING_EMAIL_KEY)
    } catch {
      // Storage unavailable (private mode) — the in-memory value still works.
    }
    setPendingEmailState(email)
  }, [])

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
        if (error.code === EMAIL_NOT_CONFIRMED) {
          setPendingEmail(email)
          throw toApiError(error, 'Please verify your email first — we sent you a new code.')
        }
        throw toApiError(error, 'Invalid credentials')
      }
      const profile = await refresh()
      if (!profile) throw { status: 401, message: 'Account is not available' } satisfies ApiError
      return profile
    },
    [refresh, setPendingEmail]
  )

  // A database trigger creates the restaurant and makes this user its manager.
  const registerRestaurant = useCallback(
    async ({ restaurantName, name, email, password, currency, language }: RegisterRestaurantPayload) => {
      const normalized = email.trim().toLowerCase()
      const { data, error } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: { name, restaurant_name: restaurantName, currency, language },
        },
      })
      if (error) throw toApiError(error)
      // With email enumeration protection on, an existing address returns a
      // user with no identities instead of an error.
      if (data.user && data.user.identities?.length === 0) {
        throw { status: 400, message: 'User already exists' } satisfies ApiError
      }
      setPendingEmail(normalized)
    },
    [setPendingEmail]
  )

  const verifyEmail = useCallback(
    async (code: string) => {
      const email = pendingEmail ?? user?.email
      if (!email) throw { status: 400, message: 'Sign in again to verify your email.' } satisfies ApiError
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
      if (error) throw toApiError(error, 'Invalid or expired code')
      setPendingEmail(null)
      await refresh()
    },
    [pendingEmail, user, refresh, setPendingEmail]
  )

  const resendVerification = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) throw toApiError(error)
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    // Same response whether or not the account exists (no user enumeration).
    if (error && error.status !== 400) throw toApiError(error)
  }, [])

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
        pendingEmail,
        login,
        registerRestaurant,
        verifyEmail,
        resendVerification,
        requestPasswordReset,
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
