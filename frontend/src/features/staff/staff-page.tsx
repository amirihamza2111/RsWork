import { useTranslation } from 'react-i18next'
import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Loader2, Users, UserX, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogHeader } from '@/components/ui/dialog'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'
import {
  useStaff,
  useStaffMutations,
  ASSIGNABLE_ROLES,
  type StaffRole,
  type StaffUser,
} from './hooks'

const roleBadge: Record<string, 'default' | 'success' | 'warning' | 'outline'> = {
  manager: 'success',
  cashier: 'default',
  waiter: 'warning',
  cook: 'outline',
}

/* -------------------------------- Staff dialog -------------------------------- */
function StaffDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  editing: StaffUser | null
}) {
  const { create, update } = useStaffMutations()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffRole>('waiter')

  useMemo(() => {
    setName(editing?.name ?? '')
    setEmail(editing?.email ?? '')
    setPassword('')
    setPhone(editing?.phone ?? '')
    setRole((editing?.role as StaffRole) ?? 'waiter')
  }, [editing, open])

  const pending = create.isPending || update.isPending
  const error = (create.error || update.error) as { message?: string } | undefined

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (editing) {
      await update.mutateAsync({ id: editing._id, name, phone, role, password: password || undefined })
    } else {
      await create.mutateAsync({ name, email, password, phone: phone || undefined, role })
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader title={editing ? `Edit ${editing.name}` : 'Add staff member'} />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Full name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {!editing && (
          <div className="space-y-2">
            <Label>Email</Label>
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        {/* There is no email delivery: managers set passwords and reset forgotten ones here. */}
        <div className="space-y-2">
          <Label>{editing ? 'New password' : 'Temporary password'}</Label>
          <PasswordInput
            required={!editing}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={editing ? 'Leave empty to keep the current one' : 'At least 6 characters'}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        {error?.message && <p className="text-sm text-destructive">{error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/* ----------------------------------- Page ----------------------------------- */
export function StaffPage() {
  const { t } = useTranslation()
  const staff = useStaff()
  const { update, deactivate } = useStaffMutations()
  const [dialog, setDialog] = useState<{ open: boolean; editing: StaffUser | null }>({
    open: false,
    editing: null,
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('staff.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('staff.subtitle')}
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true, editing: null })}>
          <Plus className="h-4 w-4" />
          Add staff
        </Button>
      </div>

      {staff.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (staff.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No staff yet — add your first team member.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {staff.data!.map((member) => (
                <div
                  key={member._id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 p-4',
                    !member.isActive && 'opacity-60'
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{member.name}</span>
                      <Badge variant={roleBadge[member.role] ?? 'outline'}>{member.role}</Badge>
                      {!member.isActive && <Badge variant="destructive">inactive</Badge>}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{member.email}</div>
                  </div>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setDialog({ open: true, editing: member })}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {member.isActive ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Deactivate"
                        onClick={() => {
                          if (confirm(`Deactivate ${member.name}? They will lose access.`))
                            deactivate.mutate(member._id)
                        }}
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-success hover:text-success"
                        title="Reactivate"
                        onClick={() => update.mutate({ id: member._id, isActive: true })}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <StaffDialog
        open={dialog.open}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
      />
    </div>
  )
}
