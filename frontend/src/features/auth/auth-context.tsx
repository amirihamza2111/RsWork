import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, setToken } from '@/lib/api'
import type { AuthUser, LoginResponse, RegisterRestaurantResponse } from './types'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  registerRestaurant: (payload: RegisterRestaurantPayload) => Promise<RegisterRestaurantResponse>
  verifyEmail: (code: string) => Promise<void>
  resendVerification: (email: string) => Promise<{ verifyToken?: string }>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
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

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(Boolean(getToken()))

  // If a stored token exists on load, fetch the current user to hydrate state.
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const { user } = await api.get<{ user: AuthUser }>('/api/auth/me')
      setUser(user)
    } catch {
      clearToken()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<LoginResponse>('/api/auth/login', { email, password })
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const registerRestaurant = useCallback(async (payload: RegisterRestaurantPayload) => {
    const data = await api.post<RegisterRestaurantResponse>(
      '/api/auth/register-restaurant',
      payload
    )
    setToken(data.token)
    setUser(data.user)
    return data
  }, [])

  const verifyEmail = useCallback(
    async (code: string) => {
      await api.post('/api/auth/verify-email', { token: code })
      await refresh()
    },
    [refresh]
  )

  const resendVerification = useCallback(async (email: string) => {
    return api.post<{ verifyToken?: string }>('/api/auth/resend-verification', { email })
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const data = await api.post<{ token?: string }>('/api/auth/change-password', {
      currentPassword,
      newPassword,
    })
    // Backend returns a fresh token so this session stays valid.
    if (data?.token) setToken(data.token)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
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
