import { LogOut, ChefHat } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'

export function KdsLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2.5">
          <ChefHat className="h-5 w-5 text-primary" />
          <span className="font-semibold">Kitchen Display</span>
          <span className="text-sm text-muted-foreground">· RsWork</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {user && <span>{user.name}</span>}
          <Button variant="ghost" size="sm" onClick={logout} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
