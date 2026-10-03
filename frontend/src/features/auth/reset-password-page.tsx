import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { PasswordInput } from '@/components/ui/password-input'
import { supabase } from '@/lib/supabase'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setSubmitting(true)
    try {
      // The emailed link carries a one-time recovery token: exchanging it opens a
      // short-lived session that is allowed to set the new password.
      const verified = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' })
      if (verified.error) throw new Error('This reset link is invalid or has expired.')
      const updated = await supabase.auth.updateUser({ password })
      if (updated.error) throw new Error(updated.error.message)
      await supabase.auth.signOut()
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/rswork_logo.png" alt="RsWork" className="h-16 w-16 rounded-2xl object-contain" />
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        </div>

        <Card>
          <CardContent className="p-6">
            {!token ? (
              <p className="text-center text-sm text-destructive">
                This reset link is invalid. Please request a new one.
              </p>
            ) : done ? (
              <div className="space-y-3 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <p className="text-sm text-muted-foreground">
                  Password updated. Redirecting you to sign in…
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <PasswordInput
                    id="confirm"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reset password'}
                </Button>
              </form>
            )}

            <div className="mt-6 border-t pt-6 text-center text-sm">
              <Link to="/login" className="text-muted-foreground hover:text-foreground">
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
