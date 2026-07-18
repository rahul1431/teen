import { useEffect, useRef } from 'react'
import { adminApi } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useNotificationStore, type AdminNotification } from '../store/notifications'
import { playChime } from '../lib/notificationSound'

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/admin/notifications?token=${encodeURIComponent(token)}`
}

export function useAdminNotifications() {
  const token = useAuthStore((s) => s.token)
  const addNotification = useNotificationStore((s) => s.addNotification)
  const setInitial = useNotificationStore((s) => s.setInitial)
  const muted = useNotificationStore((s) => s.muted)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let reconnectDelay = 1000

    // Backfill history + unread count on (re)connect
    async function backfill() {
      try {
        const res = await adminApi.get('/notifications', { params: { limit: 50 } })
        if (cancelled) return
        const items: AdminNotification[] = res.data.notifications.map((n: any) => ({ ...n, read: false }))
        setInitial(items, res.data.unread_count)
      } catch {
        // history fetch failed — WS/poll will still deliver new events live
      }
    }
    backfill()

    function connect() {
      const ws = new WebSocket(wsUrl(token!))
      wsRef.current = ws
      ws.onopen = () => {
        reconnectDelay = 1000
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
      ws.onmessage = (evt) => {
        const notif = JSON.parse(evt.data)
        addNotification({ ...notif, read: false })
        if (!mutedRef.current) playChime()
      }
      ws.onclose = () => {
        if (cancelled) return
        // Fall back to polling while disconnected (covers the known
        // nginx-Upgrade-header pitfall for this project, and any transient drop).
        if (!pollRef.current) {
          pollRef.current = setInterval(backfill, 15000)
        }
        reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }
      ws.onerror = () => ws.close()
    }
    connect()

    return () => {
      cancelled = true
      wsRef.current?.close()
      if (pollRef.current) clearInterval(pollRef.current)
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    }
  }, [token, addNotification, setInitial])
}
