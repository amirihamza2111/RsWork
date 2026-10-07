import { FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Every data call goes straight to Supabase: table queries (guarded by RLS),
// Postgres RPC functions for business rules, and a few Edge Functions.
// Failures are normalized to ApiError so screens can show `message`.
export type ApiError = { status: number; message: string }

const PG_MESSAGES: Record<string, [number, string]> = {
  '23505': [409, 'That value already exists'],
  '23503': [400, 'Referenced record does not exist'],
  '23514': [400, 'Value failed validation'],
  '22P02': [400, 'Invalid value'],
  '42501': [403, 'You are not allowed to do that'],
  PGRST116: [404, 'Not found'],
}

// RPCs raise SQLSTATE 'PTxxx' to choose the HTTP status (and keep their message).
export function toApiError(error: PostgrestError | { code?: string; message: string }): ApiError {
  const code = error.code ?? ''
  if (/^PT\d{3}$/.test(code)) return { status: Number(code.slice(2)), message: error.message }
  const known = PG_MESSAGES[code]
  if (known) return { status: known[0], message: code === '23505' ? known[1] : error.message || known[1] }
  return { status: 500, message: error.message || 'Request failed' }
}

export function must<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw toApiError(result.error)
  return result.data as T
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return must<T>(await supabase.rpc(fn, args))
}

export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null)
      throw { status: error.context.status, message: detail?.message ?? error.message } satisfies ApiError
    }
    throw { status: 0, message: error.message } satisfies ApiError
  }
  return data as T
}

// Owners of several restaurants pick which one they're managing.
const RESTAURANT_KEY = 'rswork_restaurant'

export const getSelectedRestaurant = () => {
  try {
    return localStorage.getItem(RESTAURANT_KEY) || ''
  } catch {
    return ''
  }
}

export const setSelectedRestaurant = (id: string) => {
  try {
    if (id) localStorage.setItem(RESTAURANT_KEY, id)
    else localStorage.removeItem(RESTAURANT_KEY)
  } catch {
    // Storage unavailable — the selection just won't persist.
  }
}

export const clearRestaurantSelection = () => setSelectedRestaurant('')

// Paginated list helper (`page` is 1-based).
export const pageRange = (page: number, limit: number) => {
  const from = (Math.max(1, page) - 1) * limit
  return [from, from + limit - 1] as const
}
