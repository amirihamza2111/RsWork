import axios, { AxiosError } from 'axios'

const TOKEN_KEY = 'rswork_token'
const RESTAURANT_KEY = 'rswork_restaurant'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(RESTAURANT_KEY)
}

// Multi-restaurant switch: which restaurant the owner is currently managing.
// Sent as X-Restaurant-Id on every request; the backend validates ownership.
export const getSelectedRestaurant = () => localStorage.getItem(RESTAURANT_KEY) || ''
export const setSelectedRestaurant = (id: string) => {
  if (id) localStorage.setItem(RESTAURANT_KEY, id)
  else localStorage.removeItem(RESTAURANT_KEY)
}

// Axios instance pointed at the RsWork backend. The base URL comes from
// VITE_API_URL (fallback: localhost:8001). Every request auto-attaches the
// Bearer token if one is stored, and responses are unwrapped from the
// `{ success, message, data }` envelope so callers can work with `data` directly.
const resolvedBaseURL = import.meta.env.VITE_API_URL || 'http://localhost:8001'
console.debug('[API Client] Resolved base URL:', resolvedBaseURL)
const client = axios.create({
  baseURL: resolvedBaseURL,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  const restaurant = getSelectedRestaurant()
  if (restaurant) config.headers['X-Restaurant-Id'] = restaurant
  return config
})

export type ApiError = { status: number; message: string }

const toApiError = (err: unknown): ApiError => {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? 0
    const data = err.response?.data as { message?: string } | undefined
    return { status, message: data?.message || err.message || 'Request failed' }
  }
  return { status: 0, message: (err as Error).message || 'Request failed' }
}

async function unwrap<T>(promise: Promise<{ data: { data?: T } }>): Promise<T> {
  try {
    const resp = await promise
    return (resp.data.data ?? (resp.data as unknown)) as T
  } catch (err) {
    throw toApiError(err)
  }
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    unwrap<T>(client.get(url, { params })),
  post: <T>(url: string, body?: unknown) => unwrap<T>(client.post(url, body)),
  put: <T>(url: string, body?: unknown) => unwrap<T>(client.put(url, body)),
  // Multipart form upload (e.g. menu item images). Axios sets the boundary.
  postForm: <T>(url: string, form: FormData) =>
    unwrap<T>(client.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } })),
  putForm: <T>(url: string, form: FormData) =>
    unwrap<T>(client.put(url, form, { headers: { 'Content-Type': 'multipart/form-data' } })),
  patch: <T>(url: string, body?: unknown) => unwrap<T>(client.patch(url, body)),
  delete: <T>(url: string) => unwrap<T>(client.delete(url)),
  // Fetches a binary file (e.g. a PDF receipt) through axios so the Bearer
  // token is attached — unlike window.open(), which sends no auth header and 401s.
  getBlob: async (url: string): Promise<Blob> => {
    try {
      const resp = await client.get(url, { responseType: 'blob' })
      return resp.data as Blob
    } catch (err) {
      throw toApiError(err)
    }
  },
}
