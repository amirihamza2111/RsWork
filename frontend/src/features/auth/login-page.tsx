import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { PasswordInput } from '@/components/ui/password-input'
import { useAuth } from './auth-context'
import { getRoleHome } from './types'
import type { ApiError } from '@/lib/backend'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: { pathname: string } } }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login(email.trim(), password)
      const home = getRoleHome(user.role)
      const from = location.state?.from?.pathname
      // Honor "from" only when it's a real deep-link (not just "/" which may
      // be wrong for non-manager roles). Fall back to role's home route.
      const redirectTo = from && from !== '/' ? from : home
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/rswork_logo.png" alt="RsWork" className="h-16 w-16 rounded-2xl object-contain" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to RsWork</h1>
            <p className="text-sm text-muted-foreground">Sign in to manage your restaurant</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@restaurant.com"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {/* No email delivery: a manager resets passwords from the Staff page. */}
                  <span className="text-xs text-muted-foreground">Forgot it? Ask your manager.</span>
                </div>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </Button>
            </form>

            <div className="mt-6 border-t pt-6 text-center text-sm text-muted-foreground">
              Don’t have an account yet?{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                Register your restaurant
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Powered by</span>
          <img src="/Nerovex-no-background.png" alt="Nerovex" className="h-4 object-contain" />
        </p>
      </div>
    </div>
  )
}
