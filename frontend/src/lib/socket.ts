import { io, type Socket } from 'socket.io-client'
import { getToken } from './api'

let socket: Socket | null = null

// Lazily create a single shared Socket.IO connection. The auth token is
// refreshed on each access so a fresh login is always reflected.
export function getSocket(): Socket {
  const url = import.meta.env.VITE_API_URL || 'http://localhost:5000'
  if (!socket) {
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
    })
  }
  socket.auth = { token: getToken() }
  if (!socket.connected) socket.connect()
  return socket
}
