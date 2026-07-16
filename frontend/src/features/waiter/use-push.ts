import { useEffect } from 'react'
import { api } from '@/lib/api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  // Back the array with a concrete ArrayBuffer so it satisfies BufferSource
  // (a plain Uint8Array is typed over ArrayBufferLike, which PushManager rejects).
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/**
 * Requests notification permission and subscribes this device to Web Push.
 * Safe to call on every mount — silently no-ops when already subscribed or
 * when the browser / VAPID key is not configured.
 */
export function usePushSubscription() {
  useEffect(() => {
    if (!VAPID_PUBLIC_KEY) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    async function subscribe() {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        const registration = await navigator.serviceWorker.ready
        let sub = await registration.pushManager.getSubscription()

        if (!sub) {
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
          })
        }

        await api.post('/api/push/subscribe', { subscription: sub.toJSON() })
      } catch (err) {
        // Non-fatal — the waiter still gets real-time updates via socket.
        console.warn('Push subscription failed:', err)
      }
    }

    void subscribe()
  }, [])
}
