import { useEffect, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { watchStatus } from './realtime'

// Polling is only a safety net under Realtime. Broadcasts are not replayed, so
// events sent while a channel is down (or before it first subscribes) are lost;
// the data itself is not, so refetching at the right moment is enough:
//   connected    → slow poll (a rare event dropped by the server)
//   disconnected → fast poll (the screen stays correct without Realtime)
//   (re)connect  → one immediate refetch (whatever was missed meanwhile)
export const LIVE_POLL_MS = 60_000
export const OFFLINE_POLL_MS = 10_000

// Whether the Realtime channel for `topic` is subscribed (false without a topic).
export function useChannelConnected(topic?: string) {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!topic) return
    return watchStatus(topic, setConnected)
  }, [topic])
  return Boolean(topic) && connected
}

// Returns the `refetchInterval` for queries kept fresh by `topic`, and refetches
// `queryKeys` each time the channel (re)connects.
export function useLivePolling(topic: string | undefined, queryKeys: QueryKey[]) {
  const qc = useQueryClient()
  const connected = useChannelConnected(topic)
  const keys = JSON.stringify(queryKeys)

  useEffect(() => {
    if (!connected) return
    for (const queryKey of JSON.parse(keys) as QueryKey[]) void qc.invalidateQueries({ queryKey })
  }, [connected, keys, qc])

  return connected ? LIVE_POLL_MS : OFFLINE_POLL_MS
}
