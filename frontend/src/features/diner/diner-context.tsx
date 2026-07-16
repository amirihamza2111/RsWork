import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { makeT, type Lang, type TKey } from './i18n'

export interface DinerRestaurant {
  _id?: string
  name?: string
  logo?: string
  settings?: { currency?: string }
}

interface DinerState {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: TKey) => string
  cart: Record<string, number>
  setQty: (id: string, delta: number) => void
  clearCart: () => void
  cartCount: number
  cartOpen: boolean
  setCartOpen: (v: boolean) => void
  restaurant: DinerRestaurant | null
  setRestaurant: (r: DinerRestaurant | null) => void
}

const DinerContext = createContext<DinerState | null>(null)

const LANG_KEY = 'rswork_diner_lang'
const initialLang = (): Lang => {
  const s = localStorage.getItem(LANG_KEY)
  return s === 'en' || s === 'ar' || s === 'fr' ? s : 'fr'
}

export function DinerProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [restaurant, setRestaurant] = useState<DinerRestaurant | null>(null)

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l)
    setLangState(l)
  }, [])

  const setQty = useCallback((id: string, delta: number) => {
    setCart((c) => {
      const next = Math.max(0, (c[id] ?? 0) + delta)
      const copy = { ...c }
      if (next === 0) delete copy[id]
      else copy[id] = next
      return copy
    })
  }, [])

  const clearCart = useCallback(() => setCart({}), [])

  const t = useMemo(() => makeT(lang), [lang])
  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0)

  return (
    <DinerContext.Provider
      value={{
        lang,
        setLang,
        t,
        cart,
        setQty,
        clearCart,
        cartCount,
        cartOpen,
        setCartOpen,
        restaurant,
        setRestaurant,
      }}
    >
      {children}
    </DinerContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDiner() {
  const ctx = useContext(DinerContext)
  if (!ctx) throw new Error('useDiner must be used inside DinerProvider')
  return ctx
}
