import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth-context'
import { getRoleHome, type Role } from './types'

const MANAGEMENT_ROLES: Role[] = ['manager', 'superadmin']

export function ProtectedRoute({
  children,
  roles = MANAGEMENT_ROLES,
}: {
  children: ReactNode
  roles?: Role[]
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Wrong role — redirect to that role's home instead of showing a dead end.
  if (roles.length && !roles.includes(user.role)) {
    return <Navigate to={getRoleHome(user.role)} replace />
  }

  return <>{children}</>
}
