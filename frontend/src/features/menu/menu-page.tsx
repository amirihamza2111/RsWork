import { useTranslation } from 'react-i18next'
import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Loader2, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogHeader } from '@/components/ui/dialog'
import { cn, formatCurrency } from '@/lib/utils'
import { useCurrency } from '@/features/common/use-restaurant'
import {
  useCategories,
  useCategoryMutations,
  useMenuItems,
  useMenuItemMutations,
  type Category,
  type MenuItem,
  type Trilingual,
} from './hooks'

const nameOf = (t?: Trilingual) => t?.fr || t?.en || t?.ar || '—'
// EN/AR fall back to FR so the trilingual model stays satisfied.
const buildName = (fr: string, en: string, ar: string): Trilingual => ({
  fr,
  en: en || fr,
  ar: ar || fr,
})

/* -------------------------------- Category dialog ------------------------------- */
function CategoryDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  editing: Category | null
}) {
  const { create, update } = useCategoryMutations()
  const [fr, setFr] = useState('')
  const [en, setEn] = useState('')
  const [ar, setAr] = useState('')

  // Reset fields whenever the dialog target changes.
  useMemo(() => {
    setFr(editing?.name.fr ?? '')
    setEn(editing?.name.en ?? '')
    setAr(editing?.name.ar ?? '')
  }, [editing, open])

  const pending = create.isPending || update.isPending
  const error = (create.error || update.error) as { message?: string } | undefined

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const name = buildName(fr.trim(), en.trim(), ar.trim())
    if (editing) await update.mutateAsync({ id: editing._id, name })
    else await create.mutateAsync({ name })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader title={editing ? 'Edit category' : 'New category'} />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Name (French)</Label>
          <Input required value={fr} onChange={(e) => setFr(e.target.value)} placeholder="Plats" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>English</Label>
            <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="Dishes" />
          </div>
          <div className="space-y-2">
            <Label>Arabic</Label>
            <Input value={ar} onChange={(e) => setAr(e.target.value)} placeholder="أطباق" dir="rtl" />
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

/* --------------------------------- Item dialog --------------------------------- */
function MenuItemDialog({
  open,
  onClose,
  editing,
  categories,
  defaultCategory,
}: {
  open: boolean
  onClose: () => void
  editing: MenuItem | null
  categories: Category[]
  defaultCategory?: string
}) {
  const { create, update } = useMenuItemMutations()
  const [fr, setFr] = useState('')
  const [en, setEn] = useState('')
  const [ar, setAr] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [prepStation, setPrepStation] = useState<'kitchen' | 'bar'>('kitchen')
  const [imageFile, setImageFile] = useState<File | null>(null)

  useMemo(() => {
    setFr(editing?.name.fr ?? '')
    setEn(editing?.name.en ?? '')
    setAr(editing?.name.ar ?? '')
    setPrice(editing ? String(editing.price) : '')
    const cat = typeof editing?.category === 'object' ? editing.category._id : editing?.category
    setCategory(cat ?? defaultCategory ?? categories[0]?._id ?? '')
    setPrepStation(editing?.prepStation ?? 'kitchen')
    setImageFile(null)
  }, [editing, open, defaultCategory, categories])

  const pending = create.isPending || update.isPending
  const error = (create.error || update.error) as { message?: string } | undefined

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fields = {
      name: buildName(fr.trim(), en.trim(), ar.trim()),
      price: Number(price),
      category,
      prepStation,
    }
    // Multipart only when an image is attached; otherwise plain JSON.
    let payload: FormData | Record<string, unknown> = fields
    if (imageFile) {
      const fd = new FormData()
      fd.append('name', JSON.stringify(fields.name))
      fd.append('price', String(fields.price))
      fd.append('category', fields.category)
      fd.append('prepStation', fields.prepStation)
      fd.append('image', imageFile)
      payload = fd
    }
    if (editing) await update.mutateAsync({ id: editing._id, body: payload })
    else await create.mutateAsync(payload)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader title={editing ? 'Edit item' : 'New item'} />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Name (French)</Label>
          <Input required value={fr} onChange={(e) => setFr(e.target.value)} placeholder="Pizza Margherita" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>English</Label>
            <Input value={en} onChange={(e) => setEn(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Arabic</Label>
            <Input value={ar} onChange={(e) => setAr(e.target.value)} dir="rtl" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Price</Label>
            <Input
              required
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Station</Label>
            <Select value={prepStation} onChange={(e) => setPrepStation(e.target.value as 'kitchen' | 'bar')}>
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar (drinks)</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select required value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>
              Select a category
            </option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {nameOf(c.name)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Photo</Label>
          <div className="flex items-center gap-3">
            {(imageFile || editing?.image) && (
              <img
                src={imageFile ? URL.createObjectURL(imageFile) : editing?.image}
                alt="preview"
                className="h-14 w-14 shrink-0 rounded-md object-cover"
              />
            )}
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Optimized automatically on upload. Leave empty to keep the current photo.
          </p>
        </div>
        {error?.message && <p className="text-sm text-destructive">{error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !category}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/* ----------------------------------- Page ----------------------------------- */
export function MenuPage() {
  const { t } = useTranslation()
  const currency = useCurrency()
  const categories = useCategories()
  const [activeCat, setActiveCat] = useState<string | undefined>(undefined)
  const items = useMenuItems(activeCat)
  const { remove: removeCategory } = useCategoryMutations()
  const { remove: removeItem, toggle } = useMenuItemMutations()

  const [catDialog, setCatDialog] = useState<{ open: boolean; editing: Category | null }>({
    open: false,
    editing: null,
  })
  const [itemDialog, setItemDialog] = useState<{ open: boolean; editing: MenuItem | null }>({
    open: false,
    editing: null,
  })

  const cats = categories.data ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('menu.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('menu.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCatDialog({ open: true, editing: null })}>
            <Plus className="h-4 w-4" />
            Category
          </Button>
          <Button
            onClick={() => setItemDialog({ open: true, editing: null })}
            disabled={cats.length === 0}
          >
            <Plus className="h-4 w-4" />
            Item
          </Button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCat(undefined)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            !activeCat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
          )}
        >
          All
        </button>
        {cats.map((c) => (
          <div key={c._id} className="group flex items-center">
            <button
              onClick={() => setActiveCat(c._id)}
              className={cn(
                'rounded-l-full py-1.5 pl-3 pr-2 text-sm font-medium transition-colors',
                activeCat === c._id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {nameOf(c.name)}
            </button>
            <span
              className={cn(
                'flex items-center gap-0.5 rounded-r-full py-1.5 pr-2',
                activeCat === c._id ? 'bg-primary' : 'bg-muted'
              )}
            >
              <button
                onClick={() => setCatDialog({ open: true, editing: c })}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="Edit category"
              >
                <Pencil className={cn('h-3 w-3', activeCat === c._id && 'text-primary-foreground')} />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete category "${nameOf(c.name)}"?`)) removeCategory.mutate(c._id)
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                title="Delete category"
              >
                <Trash2 className={cn('h-3 w-3', activeCat === c._id && 'text-primary-foreground')} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Items */}
      {items.isLoading || categories.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (items.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <UtensilsCrossed className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {cats.length === 0 ? 'Create a category first, then add items.' : 'No items yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.data!.map((item) => (
            <Card key={item._id} className={cn(!item.isAvailable && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{nameOf(item.name)}</h3>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {formatCurrency(item.price, currency)}
                    </p>
                  </div>
                  <Badge variant={item.prepStation === 'bar' ? 'warning' : 'default'}>
                    {item.prepStation === 'bar' ? 'Bar' : 'Kitchen'}
                  </Badge>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    onClick={() => toggle.mutate(item._id)}
                    className={cn(
                      'text-xs font-medium',
                      item.isAvailable ? 'text-success' : 'text-muted-foreground'
                    )}
                  >
                    {item.isAvailable ? '● Available' : '○ Unavailable'}
                  </button>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setItemDialog({ open: true, editing: item })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete "${nameOf(item.name)}"?`)) removeItem.mutate(item._id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CategoryDialog
        open={catDialog.open}
        editing={catDialog.editing}
        onClose={() => setCatDialog({ open: false, editing: null })}
      />
      <MenuItemDialog
        open={itemDialog.open}
        editing={itemDialog.editing}
        categories={cats}
        defaultCategory={activeCat}
        onClose={() => setItemDialog({ open: false, editing: null })}
      />
    </div>
  )
}
