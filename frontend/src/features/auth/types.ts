export type Role = 'client' | 'waiter' | 'cashier' | 'cook' | 'manager' | 'superadmin'

export function getRoleHome(role: Role): string {
  if (role === 'cook') return '/kds'
  if (role === 'waiter') return '/waiter'
  if (role === 'cashier') return '/cashier'
  // client app is future work — send back to login for now
  if (role === 'client') return '/login'
  return '/'
}

export interface AuthRestaurant {
  _id: string
  name: string
  settings: { currency?: string; language?: string; timezone?: string }
}

export interface AuthUser {
  _id: string
  name: string
  email: string
  role: Role
  phone?: string
  restaurant?: AuthRestaurant
  isActive: boolean
  isVerified?: boolean
}
