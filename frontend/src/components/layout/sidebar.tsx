import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  UtensilsCrossed,
  Grid3x3,
  Users,
  CreditCard,
  MessageSquare,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/menu', key: 'nav.menu', icon: UtensilsCrossed },
  { to: '/tables', key: 'nav.tables', icon: Grid3x3 },
  { to: '/staff', key: 'nav.staff', icon: Users },
  { to: '/payments', key: 'nav.payments', icon: CreditCard },
  { to: '/feedback', key: 'nav.feedback', icon: MessageSquare },
  { to: '/settings', key: 'nav.settings', icon: Settings },
]

export function Sidebar() {
  const { t } = useTranslation()
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-24 items-center gap-3 border-b px-6">
        <img
          src="/rswork_logo.png"
          alt="RsWork"
          className="h-14 w-14 rounded-xl object-contain"
        />
        <span className="text-2xl font-semibold tracking-tight">RsWork</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map(({ to, key, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {t(key)}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-col items-start gap-2 border-t p-5 text-xs text-muted-foreground">
        <span>Powered by</span>
        <img
          src="/Nerovex-no-background.png"
          alt="Nerovex"
          className="h-10 object-contain"
        />
      </div>
    </aside>
  )
}
