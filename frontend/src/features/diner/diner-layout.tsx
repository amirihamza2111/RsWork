import { Outlet } from 'react-router-dom'
import { ShoppingBag, UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDiner } from './diner-context'
import { LANGS, isRTL } from './i18n'

// Warm, appetizing diner shell — its own palette, independent of the admin theme.
export function DinerLayout() {
  const { lang, setLang, restaurant, cartCount, setCartOpen } = useDiner()

  return (
    <div
      dir={isRTL(lang) ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#FEF7F4] text-[#3F1D1B]"
      style={{ ['--diner-primary' as string]: '#D6402C' }}
    >
      <header className="sticky top-0 z-20 border-b border-[#F3D9CF] bg-[#FEF7F4]/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-2.5">
          {/* Left: restaurant logo + name */}
          <div className="flex min-w-0 items-center gap-2.5">
            {restaurant?.logo ? (
              <img
                src={restaurant.logo}
                alt={restaurant.name ?? 'Restaurant'}
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-[#F3D9CF]"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D6402C]/10 text-[#D6402C]">
                <UtensilsCrossed className="h-5 w-5" />
              </div>
            )}
            <span className="truncate font-serif text-lg font-semibold leading-none">
              {restaurant?.name ?? 'RsWork'}
            </span>
          </div>

          {/* Right: language switcher + cart */}
          <div className="flex items-center gap-1.5">
            <div className="flex overflow-hidden rounded-full border border-[#F3D9CF]">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-semibold transition-colors',
                    lang === l.code ? 'bg-[#D6402C] text-white' : 'text-[#8A6A62] hover:bg-[#F7E7E0]'
                  )}
                  aria-label={l.label}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCartOpen(true)}
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#3F1D1B] hover:bg-[#F7E7E0]"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D6402C] px-1 text-[10px] font-bold text-white">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg">
        <Outlet />
      </main>
    </div>
  )
}
