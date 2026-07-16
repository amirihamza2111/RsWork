import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { api, type ApiError } from '@/lib/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // In dev the backend returns the raw token so the flow is testable without email.
  const [devToken, setDevToken] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const data = await api.post<{ resetToken?: string } | null>('/api/auth/forgot-password', {
        email: email.trim(),
      })
      setSent(true)
      if (data?.resetToken) setDevToken(data.resetToken)
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
            <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and we’ll send you a reset link.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            {sent ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <p className="text-sm text-muted-foreground">
                  If an account exists for <span className="font-medium text-foreground">{email}</span>,
                  a password reset link is on its way.
                </p>
                {devToken && (
                  <div className="rounded-md border border-dashed p-3 text-left text-xs">
                    <p className="mb-1 font-medium text-muted-foreground">Dev shortcut:</p>
                    <Link
                      to={`/reset-password?token=${devToken}`}
                      className="break-all text-primary hover:underline"
                    >
                      /reset-password?token={devToken}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
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
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
                </Button>
              </form>
            )}

            <div className="mt-6 border-t pt-6 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
