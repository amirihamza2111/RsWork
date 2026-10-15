import { useTranslation } from 'react-i18next'
import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Check, MapPin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/auth-context'
import type { ApiError } from '@/lib/backend'
import { useMyRestaurant, useUpdateRestaurant } from './hooks'

function RestaurantProfileCard() {
  const { data: restaurant, isLoading } = useMyRestaurant()
  const update = useUpdateRestaurant()
  const [form, setForm] = useState({ name: '', address: '', phone: '', currency: 'TND', language: 'fr' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (restaurant) {
      setForm({
        name: restaurant.name ?? '',
        address: restaurant.address ?? '',
        phone: restaurant.phone ?? '',
        currency: restaurant.settings?.currency ?? 'TND',
        language: restaurant.settings?.language ?? 'fr',
      })
    }
  }, [restaurant])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!restaurant) return
    setSaved(false)
    await update.mutateAsync({
      id: restaurant._id,
      name: form.name,
      address: form.address,
      phone: form.phone,
      settings: { currency: form.currency, language: form.language },
    })
    setSaved(true)
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Restaurant profile</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={form.name} onChange={set('name')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={set('address')} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={form.currency} onChange={set('currency')} />
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={form.language} onChange={set('language')}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </Select>
              </div>
            </div>
            {update.isError && (
              <p className="text-sm text-destructive">
                {(update.error as { message?: string })?.message ?? 'Failed to save'}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
              </Button>
              {saved && !update.isPending && (
                <span className="flex items-center gap-1 text-sm text-success">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function GeofenceCard() {
  const { data: restaurant, isLoading } = useMyRestaurant()
  const update = useUpdateRestaurant()
  const [radius, setRadius] = useState(250)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (restaurant?.geofenceRadius) setRadius(restaurant.geofenceRadius)
  }, [restaurant])

  const hasLocation = restaurant?.location?.lat != null

  async function captureAndSave() {
    if (!restaurant) return
    setError(null)
    setSaved(false)
    if (!('geolocation' in navigator)) return setError('Geolocation is not available on this device.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await update.mutateAsync({
            id: restaurant._id,
            location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            geofenceRadius: radius,
          })
          setSaved(true)
        } catch (err) {
          setError((err as { message?: string })?.message ?? 'Failed to save location')
        } finally {
          setLocating(false)
        }
      },
      () => {
        setError('Could not get your location. Please allow location access.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function saveRadius() {
    if (!restaurant) return
    setSaved(false)
    await update.mutateAsync({ id: restaurant._id, geofenceRadius: radius })
    setSaved(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordering location (geofence)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When set, diners can only place QR orders while physically near the restaurant.
              Stand inside your restaurant and tap the button below.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className={cn('h-4 w-4', hasLocation ? 'text-success' : 'text-muted-foreground')} />
              {hasLocation ? (
                <span className="text-success">
                  Location set ({restaurant!.location!.lat.toFixed(5)}, {restaurant!.location!.lng.toFixed(5)})
                </span>
              ) : (
                <span className="text-muted-foreground">Not set — geofence is off (diners can order from anywhere).</span>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Radius (metres)</Label>
                <Input
                  type="number"
                  min={50}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  onBlur={saveRadius}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-3">
              <Button onClick={captureAndSave} disabled={locating || update.isPending}>
                {locating || update.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                Use my current location
              </Button>
              {saved && !update.isPending && (
                <span className="flex items-center gap-1 text-sm text-success">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChangePasswordCard() {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (next !== confirm) return setError('Passwords do not match')
    if (next.length < 8) return setError('New password must be at least 8 characters')
    setBusy(true)
    try {
      await changePassword(current, next)
      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Current password</Label>
            <PasswordInput
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>New password</Label>
              <PasswordInput
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm new password</Label>
              <PasswordInput
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
            </Button>
            {done && (
              <span className="flex items-center gap-1 text-sm text-success">
                <Check className="h-4 w-4" /> Password updated
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </div>
      <RestaurantProfileCard />
      <GeofenceCard />
      <ChangePasswordCard />
    </div>
  )
}
