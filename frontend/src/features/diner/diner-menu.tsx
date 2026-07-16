import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Minus, Plus, ShoppingBag, UtensilsCrossed, X } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { useTableSession, useDinerMenu, usePlaceOrder, type DinerItem } from './hooks'
import { useDiner } from './diner-context'
import { tri } from './i18n'

// Best-effort geolocation for the geofence — resolves null if unavailable/denied.
function getCoords(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true }
    )
  })
}

export function DinerMenu() {
  const [params] = useSearchParams()
  const tableId = params.get('tableId') ?? undefined
  const navigate = useNavigate()
  const { lang, t, cart, setQty, cartCount, cartOpen, setCartOpen, clearCart, setRestaurant } = useDiner()

  const { data: sessionData, isLoading: tableLoading, isError: tableError } = useTableSession(tableId)
  const table = sessionData?.table
  const sessionId = sessionData?.session?.id
  const restaurantId = table?.restaurant?._id
  const currency = table?.restaurant?.settings?.currency ?? 'TND'
  const { categories, items, itemsByCategory } = useDinerMenu(restaurantId)

  const [activeCat, setActiveCat] = useState('all')
  const place = usePlaceOrder()

  // Feed restaurant identity to the navbar.
  useEffect(() => {
    if (table?.restaurant) setRestaurant(table.restaurant)
  }, [table, setRestaurant])

  const money = (v: number) => formatCurrency(v, currency)
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i._id, i])), [items.data])
  const shown: DinerItem[] = activeCat === 'all' ? items.data ?? [] : itemsByCategory(activeCat)

  const cartLines = Object.entries(cart).filter(([, q]) => q > 0)
  const cartTotal = cartLines.reduce((s, [id, q]) => s + (itemById.get(id)?.price ?? 0) * q, 0)

  async function placeOrder() {
    if (!tableId || cartLines.length === 0) return
    const coords = await getCoords()
    const res = await place.mutateAsync({
      table: tableId,
      sessionId,
      ...(coords ?? {}),
      items: cartLines.map(([menuItem, quantity]) => ({ menuItem, quantity })),
    })
    clearCart()
    setCartOpen(false)
    navigate(`/order/track/${res.order._id}?new=1`)
  }

  if (!tableId) return <Centered><UtensilsCrossed className="h-10 w-10 opacity-30" /><p className="text-sm">{t('scanPrompt')}</p></Centered>
  if (tableLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin opacity-60" /></Centered>
  if (tableError || !table) return <Centered><p className="text-sm text-[#D6402C]">{t('tableNotFound')}</p></Centered>

  return (
    <div className="pb-28">
      <div className="px-4 pb-2 pt-4">
        <p className="text-sm text-[#8A6A62]">{t('table')} {table.number}</p>
      </div>

      {/* Category chips */}
      <div className="no-scrollbar sticky top-[57px] z-10 flex gap-2 overflow-x-auto bg-[#FEF7F4]/95 px-4 py-2 backdrop-blur">
        <Chip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>{t('all')}</Chip>
        {(categories.data ?? []).map((c) => (
          <Chip key={c._id} active={activeCat === c._id} onClick={() => setActiveCat(c._id)}>{tri(c.name, lang)}</Chip>
        ))}
      </div>

      {items.isLoading ? (
        <Centered><Loader2 className="h-6 w-6 animate-spin opacity-60" /></Centered>
      ) : shown.length === 0 ? (
        <Centered><p className="text-sm text-[#8A6A62]">{t('emptySection')}</p></Centered>
      ) : (
        <ul className="space-y-2 px-3 pt-1">
          {shown.map((item) => {
            const qty = cart[item._id] ?? 0
            return (
              <li key={item._id} className="flex items-center gap-3 rounded-2xl border border-[#F3D9CF] bg-white p-2.5 shadow-sm">
                {item.image ? (
                  <img src={item.image} alt={tri(item.name, lang)} loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[#F7E7E0]">
                    <UtensilsCrossed className="h-6 w-6 text-[#D6402C]/40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-tight">{tri(item.name, lang)}</div>
                  {tri(item.description, lang) && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-[#8A6A62]">{tri(item.description, lang)}</div>
                  )}
                  <div className="mt-1 font-serif text-base font-semibold text-[#D6402C]">{money(item.price)}</div>
                </div>
                {qty === 0 ? (
                  <button
                    onClick={() => setQty(item._id, 1)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D6402C] text-white shadow-sm transition-transform active:scale-95"
                    aria-label={t('add')}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Stepper onClick={() => setQty(item._id, -1)}><Minus className="h-4 w-4" /></Stepper>
                    <span className="w-5 text-center font-semibold">{qty}</span>
                    <Stepper onClick={() => setQty(item._id, 1)}><Plus className="h-4 w-4" /></Stepper>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Sticky cart bar */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg p-3">
          <button
            onClick={() => setCartOpen(true)}
            className="flex h-14 w-full items-center justify-between rounded-2xl bg-[#D6402C] px-5 text-white shadow-lg transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 font-medium">
              <ShoppingBag className="h-5 w-5" />
              {cartCount}
            </span>
            <span className="font-serif text-lg font-semibold">{money(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={() => setCartOpen(false)}>
          <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold">{t('yourOrder')}</h2>
              <button onClick={() => setCartOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F7E7E0]">
                <X className="h-4 w-4" />
              </button>
            </div>
            {cartLines.length === 0 ? (
              <p className="py-8 text-center text-sm text-[#8A6A62]">{t('cartEmpty')}</p>
            ) : (
              <>
                <ul className="max-h-[45vh] space-y-3 overflow-y-auto">
                  {cartLines.map(([id, q]) => {
                    const item = itemById.get(id)
                    if (!item) return null
                    return (
                      <li key={id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{tri(item.name, lang)}</div>
                          <div className="text-xs text-[#D6402C]">{money(item.price)}</div>
                        </div>
                        <Stepper onClick={() => setQty(id, -1)} small><Minus className="h-3.5 w-3.5" /></Stepper>
                        <span className="w-5 text-center text-sm font-semibold">{q}</span>
                        <Stepper onClick={() => setQty(id, 1)} small><Plus className="h-3.5 w-3.5" /></Stepper>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-4 flex items-center justify-between border-t border-[#F3D9CF] pt-3">
                  <span className="text-sm text-[#8A6A62]">{t('total')}</span>
                  <span className="font-serif text-xl font-semibold">{money(cartTotal)}</span>
                </div>
                {place.isError && (
                  <div className="mt-2 rounded-xl bg-[#D6402C]/10 p-2.5 text-xs text-[#D6402C]">
                    {(place.error as { message?: string })?.message ?? t('locationNeeded')}
                  </div>
                )}
                <button
                  onClick={placeOrder}
                  disabled={place.isPending}
                  className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#D6402C] font-medium text-white shadow-md transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                  {place.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : `${t('placeOrder')} · ${money(cartTotal)}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center gap-2 px-6 text-center text-[#8A6A62]">{children}</div>
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active ? 'border-[#D6402C] bg-[#D6402C] text-white' : 'border-[#F3D9CF] bg-white text-[#8A6A62]'
      )}
    >
      {children}
    </button>
  )
}

function Stepper({ onClick, small, children }: { onClick: () => void; small?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-full border border-[#F3D9CF] bg-white text-[#3F1D1B] transition-transform active:scale-90',
        small ? 'h-7 w-7' : 'h-9 w-9'
      )}
    >
      {children}
    </button>
  )
}
