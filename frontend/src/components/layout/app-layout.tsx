import { Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { LogOut, Store } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import { must, setSelectedRestaurant } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { setAdminLanguage } from '@/lib/adminI18n'

const LANGS: { code: 'fr' | 'en' | 'ar'; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
]

// Multi-restaurant picker — appears only for owners with several restaurants.
// RLS returns exactly the restaurants this user may manage. Switching stores
// the selection and reloads so every screen re-scopes to the chosen restaurant.
function RestaurantSwitcher() {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: ['restaurants', 'mine'],
    queryFn: async () =>
      must<{ id: string; name: string }[]>(await supabase.from('restaurants').select('id, name').order('name')).map(
        (r) => ({ _id: r.id, name: r.name })
      ),
    enabled: user?.role === 'manager' || user?.role === 'superadmin',
    staleTime: 5 * 60_000,
  })

  if (!data || data.length < 2) return null
  const current = user?.restaurant?._id || data[0]._id

  return (
    <div className="flex items-center gap-1.5">
      <Store className="h-4 w-4 text-muted-foreground" />
      <select
        value={current}
        onChange={(e) => {
          setSelectedRestaurant(e.target.value)
          window.location.reload()
        }}
        className="h-8 rounded-md border bg-background px-2 text-sm font-medium"
        aria-label="Restaurant"
      >
        {data.map((r) => (
          <option key={r._id} value={r._id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function LanguageSwitcher() {
  const { i18n } = useTranslation()
  return (
    <div className="flex overflow-hidden rounded-full border">
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => setAdminLanguage(l.code)}
          className={cn(
            'px-2.5 py-1 text-xs font-semibold transition-colors',
            i18n.language === l.code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent'
          )}
          aria-label={l.label}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function AppLayout() {
  const { user, logout } = useAuth()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const initial = (user?.name || '?').trim().charAt(0).toUpperCase()

  function onLogout() {
    void logout()
    navigate('/login', { replace: true })
  }

  return (
    <div dir={i18n.language === 'ar' ? 'rtl' : 'ltr'} className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card/60 px-6 backdrop-blur">
          <div className="text-sm">
            <span className="text-muted-foreground">{t('layout.signedInAs')} </span>
            <span className="font-medium">{user?.name}</span>
            <span className="text-muted-foreground"> · {user?.role}</span>
          </div>
          <div className="flex items-center gap-3">
            <RestaurantSwitcher />
            <LanguageSwitcher />
            <ThemeToggle />
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground"
              aria-label={user?.name || 'User'}
            >
              {initial}
            </div>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              {t('layout.signOut')}
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
