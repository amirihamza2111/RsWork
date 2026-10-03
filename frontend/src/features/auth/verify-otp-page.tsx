import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from './auth-context'
import type { ApiError } from '@/lib/api'

const CODE_LEN = 6

// Six single-digit boxes that behave like one field: auto-advance, backspace to
// the previous cell, paste-fills all six, mobile numeric keyboard.
function CodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

  const digits = value.padEnd(CODE_LEN, ' ').slice(0, CODE_LEN).split('')

  const setAt = (i: number, ch: string) => {
    const next = digits.slice()
    next[i] = ch
    onChange(next.join('').replace(/\s/g, ''))
  }

  return (
    <div className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          value={d.trim()}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1)
            if (!ch) {
              setAt(i, ' ')
              return
            }
            setAt(i, ch)
            if (i < CODE_LEN - 1) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i].trim() && i > 0) {
              refs.current[i - 1]?.focus()
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LEN)
            if (!pasted) return
            e.preventDefault()
            onChange(pasted)
            refs.current[Math.min(pasted.length, CODE_LEN - 1)]?.focus()
          }}
          className="h-14 w-12 rounded-md border border-input bg-background text-center text-xl font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        />
      ))}
    </div>
  )
}

export function VerifyOtpPage() {
  const { user, pendingEmail, verifyEmail, resendVerification, logout } = useAuth()
  const navigate = useNavigate()
  const email = pendingEmail ?? user?.email ?? null

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)

  // Already verified? Get out of here. Nothing to verify? Back to sign in.
  useEffect(() => {
    if (user?.isVerified) navigate('/', { replace: true })
    else if (!email) navigate('/login', { replace: true })
  }, [user, email, navigate])

  async function onSubmit() {
    if (code.length !== CODE_LEN) return
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await verifyEmail(code)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function onResend() {
    if (!email) return
    setError(null)
    setInfo(null)
    setResending(true)
    try {
      const result = await resendVerification(email)
      setInfo(
        result?.verifyToken
          ? `Sent. Dev code: ${result.verifyToken}`
          : 'A new code has been sent to your inbox.'
      )
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <Mail className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-4 p-6">
            <CodeInput value={code} onChange={setCode} disabled={submitting} />

            {info && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{info}</span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={onSubmit}
              disabled={submitting || code.length !== CODE_LEN}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify email'}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={onResend}
                disabled={resending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {resending ? 'Sending…' : 'Resend code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void logout()
                  navigate('/login', { replace: true })
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          The code expires after a while — request a new one if it stops working. Check your spam
          folder if you can’t find it.
        </p>
      </div>
    </div>
  )
}
