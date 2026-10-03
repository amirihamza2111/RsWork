import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { api, clearRestaurantSelection, type ApiError } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { AuthUser, RegisterRestaurantResponse } from './types'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  // Email awaiting OTP verification (set after registration or an unconfirmed login).
  pendingEmail: string | null
  login: (email: string, password: string) => Promise<AuthUser>
  registerRestaurant: (payload: RegisterRestaurantPayload) => Promise<RegisterRestaurantResponse>
  verifyEmail: (code: string) => Promise<void>
  resendVerification: (email: string) => Promise<{ verifyToken?: string } | null>
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

  // Loads the app profile for the current Supabase session (if any).
  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        setUser(null)
        return null
      }
      const { user } = await api.get<{ user: AuthUser }>('/api/auth/me')
      setUser(user)
      return user
    } catch {
      // Session exists but the profile is missing/deactivated — sign out cleanly.
      await supabase.auth.signOut()
      setUser(null)
      return null
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

  const registerRestaurant = useCallback(
    async (payload: RegisterRestaurantPayload) => {
      const data = await api.post<RegisterRestaurantResponse>('/api/auth/register-restaurant', payload)
      setPendingEmail(payload.email.trim().toLowerCase())
      return data
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
    return api.post<{ verifyToken?: string } | null>('/api/auth/resend-verification', { email })
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
