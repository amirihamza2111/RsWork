import { useTranslation } from 'react-i18next'
import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Loader2, QrCode, Download, Printer, Shuffle, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogHeader } from '@/components/ui/dialog'
import {
  useTables,
  useTableMutations,
  type RestaurantTable,
  type TableStatus,
} from './hooks'
import { useStaff } from '@/features/staff/hooks'

const waiterId = (w: RestaurantTable['assignedWaiter']): string =>
  !w ? '' : typeof w === 'string' ? w : w._id ?? ''
const waiterName = (w: RestaurantTable['assignedWaiter']): string =>
  w && typeof w === 'object' ? (w.name ?? '') : ''

const statusVariant: Record<TableStatus, 'success' | 'warning' | 'default'> = {
  available: 'success',
  occupied: 'warning',
  reserved: 'default',
}

/* -------------------------------- Table dialog -------------------------------- */
function TableDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  editing: RestaurantTable | null
}) {
  const { create, update } = useTableMutations()
  const { data: staff } = useStaff()
  const waiters = (staff ?? []).filter((u) => u.role === 'waiter')
  const [number, setNumber] = useState('')
  const [capacity, setCapacity] = useState('4')
  const [status, setStatus] = useState<TableStatus>('available')
  const [assignedWaiter, setAssignedWaiter] = useState('')

  useMemo(() => {
    setNumber(editing ? String(editing.number) : '')
    setCapacity(editing ? String(editing.capacity) : '4')
    setStatus(editing?.status ?? 'available')
    setAssignedWaiter(editing ? waiterId(editing.assignedWaiter) : '')
  }, [editing, open])

  const pending = create.isPending || update.isPending
  const error = (create.error || update.error) as { message?: string } | undefined

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (editing) {
      await update.mutateAsync({
        id: editing._id,
        number: Number(number),
        capacity: Number(capacity),
        status,
        assignedWaiter: assignedWaiter || null,
      })
    } else {
      await create.mutateAsync({ number: Number(number), capacity: Number(capacity) })
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-sm">
      <DialogHeader title={editing ? `Edit table ${editing.number}` : 'New table'} />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Table number</Label>
            <Input
              required
              type="number"
              min="1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Capacity</Label>
            <Input
              required
              type="number"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>
        {editing && (
          <>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as TableStatus)}>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="reserved">Reserved</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assigned waiter</Label>
              <Select value={assignedWaiter} onChange={(e) => setAssignedWaiter(e.target.value)}>
                <option value="">Unassigned</option>
                {waiters.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Ready-order alerts for this table go to this waiter.
              </p>
            </div>
          </>
        )}
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

/* --------------------------------- QR dialog ---------------------------------- */

// Opens a print-ready page: big QR + table number, auto-triggers the print dialog.
// Built with DOM APIs (no document.write / inline handlers), so nothing is ever
// parsed as HTML and it works under the site's Content-Security-Policy.
function printQr(table: RestaurantTable) {
  if (!table.qrCode) return
  const w = window.open('', '_blank', 'width=480,height=640')
  if (!w) return
  const doc = w.document
  doc.title = `Table ${table.number} — QR`
  Object.assign(doc.body.style, {
    fontFamily: 'sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '95vh',
    margin: '0',
  })
  const title = doc.createElement('h1')
  title.textContent = `Table ${table.number}`
  Object.assign(title.style, { fontSize: '28px', margin: '0 0 4px' })
  const hint = doc.createElement('p')
  hint.textContent = 'Scan to see the menu & order'
  Object.assign(hint.style, { color: '#555', margin: '0 0 16px' })
  const img = doc.createElement('img')
  Object.assign(img.style, { width: '340px', height: '340px' })
  img.alt = `QR code for table ${table.number}`
  img.onload = () => w.print()
  img.src = table.qrCode
  doc.body.append(title, hint, img)
}

function QrDialog({ table, onClose }: { table: RestaurantTable | null; onClose: () => void }) {
  if (!table) return null
  return (
    <Dialog open={Boolean(table)} onClose={onClose} className="max-w-xs">
      <DialogHeader title={`Table ${table.number} — QR`} description="Diners scan this to open the menu." />
      <div className="flex flex-col items-center gap-4">
        {table.qrCode ? (
          <img src={table.qrCode} alt={`QR for table ${table.number}`} className="h-56 w-56 rounded-lg border bg-white p-2" />
        ) : (
          <div className="flex h-56 w-56 items-center justify-center rounded-lg border text-sm text-muted-foreground">
            No QR generated
          </div>
        )}
        {table.qrCode && (
          <div className="grid w-full grid-cols-2 gap-2">
            <a href={table.qrCode} download={`table-${table.number}-qr.png`}>
              <Button className="w-full" variant="outline">
                <Download className="h-4 w-4" />
                Download
              </Button>
            </a>
            <Button className="w-full" variant="outline" onClick={() => printQr(table)}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* ----------------------------------- Page ----------------------------------- */
export function TablesPage() {
  const { t } = useTranslation()
  const tables = useTables()
  const { remove, autoAssign } = useTableMutations()
  const [dialog, setDialog] = useState<{ open: boolean; editing: RestaurantTable | null }>({
    open: false,
    editing: null,
  })
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('tables.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('tables.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => autoAssign.mutate()}
            disabled={autoAssign.isPending}
            title="Redistribute tables across the waiters currently online"
          >
            {autoAssign.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Shuffle className="h-4 w-4" />
            )}
            Auto-assign
          </Button>
          <Button onClick={() => setDialog({ open: true, editing: null })}>
            <Plus className="h-4 w-4" />
            Table
          </Button>
        </div>
      </div>

      {autoAssign.isError && (
        <p className="text-sm text-destructive">
          {(autoAssign.error as { message?: string })?.message ?? 'Auto-assign failed'}
        </p>
      )}

      {tables.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (tables.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <QrCode className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No tables yet — add your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tables.data!.map((table) => (
            <Card key={table._id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-2xl font-semibold">#{table.number}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {table.capacity} seats
                    </div>
                    {waiterName(table.assignedWaiter) && (
                      <div className="mt-0.5 truncate text-xs font-medium text-primary">
                        {waiterName(table.assignedWaiter)}
                      </div>
                    )}
                  </div>
                  <Badge variant={statusVariant[table.status]}>{table.status}</Badge>
                </div>

                <button
                  onClick={() => setQrTable(table)}
                  className="mt-4 flex w-full items-center justify-center rounded-md border bg-white p-2 transition-opacity hover:opacity-80"
                  title="View QR code"
                >
                  {table.qrCode ? (
                    <img src={table.qrCode} alt={`QR ${table.number}`} className="h-24 w-24" />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center text-muted-foreground">
                      <QrCode className="h-8 w-8" />
                    </div>
                  )}
                </button>

                <div className="mt-3 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setDialog({ open: true, editing: table })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete table ${table.number}?`)) remove.mutate(table._id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TableDialog
        open={dialog.open}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
      />
      <QrDialog table={qrTable} onClose={() => setQrTable(null)} />
    </div>
  )
}
