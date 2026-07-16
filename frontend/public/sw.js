// RsWork service worker — handles Web Push notifications.
// Intentionally minimal: no caching strategies here (add them later via Workbox
// if offline support is needed). The sole job is push + notificationclick.

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'RsWork', {
      body: data.body ?? 'You have a new notification',
      icon: '/rswork_logo.png',
      badge: '/rswork_logo.png',
      tag: data.tag ?? 'rswork',
      renotify: true,
      data: { url: data.url ?? '/waiter' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/waiter'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      // If the app is already open, focus and navigate it.
      for (const client of all) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open a new window.
      return clients.openWindow(url)
    })
  )
})
