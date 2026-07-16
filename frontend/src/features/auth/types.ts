export type Role = 'client' | 'waiter' | 'cashier' | 'cook' | 'manager' | 'superadmin'

export function getRoleHome(role: Role): string {
  if (role === 'cook') return '/kds'
  if (role === 'waiter') return '/waiter'
  if (role === 'cashier') return '/cashier'
  // client app is future work — send back to login for now
  if (role === 'client') return '/login'
  return '/'
}

export interface AuthUser {
  _id: string
  name: string
  email: string
  role: Role
  restaurant?: string | { _id: string; name?: string }
  isActive: boolean
  isVerified?: boolean
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface RegisterRestaurantResponse extends LoginResponse {
  restaurant: { _id: string; name: string }
  verifyToken?: string
}
