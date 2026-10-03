import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Supabase Realtime Broadcast channels published by the API:
//   restaurant:<id>  private — staff of that restaurant (authorized by RLS)
//   waiter:<id>      private — one waiter
//   table:<id>       public  — diners at a table (no PII)
// One channel per topic is shared by every hook that needs it.

type Listener = (event: string, payload: unknown) => void
type StatusListener = (connected: boolean) => void

interface Entry {
  channel: RealtimeChannel | null
  listeners: Set<Listener>
  statusListeners: Set<StatusListener>
  connected: boolean
  closed: boolean
}

const entries = new Map<string, Entry>()

const isPrivateTopic = (topic: string) => !topic.startsWith('table:')

function open(topic: string): Entry {
  const entry: Entry = {
    channel: null,
    listeners: new Set(),
    statusListeners: new Set(),
    connected: false,
    closed: false,
  }
  entries.set(topic, entry)

  const setConnected = (connected: boolean) => {
    entry.connected = connected
    entry.statusListeners.forEach((l) => l(connected))
  }

  void (async () => {
    const isPrivate = isPrivateTopic(topic)
    // Private channels are authorized with the signed-in user's access token.
    if (isPrivate) await supabase.realtime.setAuth()
    if (entry.closed) return
    const channel = supabase.channel(topic, { config: { private: isPrivate } })
    channel.on('broadcast', { event: '*' }, (message) => {
      entry.listeners.forEach((l) => l(message.event, message.payload))
    })
    channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'))
    entry.channel = channel
  })()

  return entry
}

function release(topic: string, entry: Entry) {
  if (entry.listeners.size || entry.statusListeners.size) return
  entry.closed = true
  entries.delete(topic)
  if (entry.channel) void supabase.removeChannel(entry.channel)
}

// Calls `listener` for each of `events` broadcast on `topic`. Returns an unsubscribe.
export function subscribe(topic: string, events: string[], listener: (event: string, payload: unknown) => void) {
  const entry = entries.get(topic) ?? open(topic)
  const wanted = new Set(events)
  const filtered: Listener = (event, payload) => {
    if (wanted.has(event)) listener(event, payload)
  }
  entry.listeners.add(filtered)
  return () => {
    entry.listeners.delete(filtered)
    release(topic, entry)
  }
}

// Reports whether the channel for `topic` is currently subscribed.
export function watchStatus(topic: string, onChange: StatusListener) {
  const entry = entries.get(topic) ?? open(topic)
  entry.statusListeners.add(onChange)
  onChange(entry.connected)
  return () => {
    entry.statusListeners.delete(onChange)
    release(topic, entry)
  }
}

export const restaurantTopic = (restaurantId: string) => `restaurant:${restaurantId}`
export const tableTopic = (tableId: string) => `table:${tableId}`
export const waiterTopic = (userId: string) => `waiter:${userId}`
