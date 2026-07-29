import { describe, it, expect, beforeEach } from 'vitest'
import { useNotificationStore } from './notifications'

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ items: [], unreadCount: 0, muted: false })
    localStorage.clear()
  })

  it('addNotification prepends and increments unreadCount', () => {
    const n = { id: 1, type: 'ticket', title: 'T', body: 'B', severity: 'info', target_role: 'support', ref_table: null, ref_id: null, created_at: '2026-07-18T00:00:00Z', read: false }
    useNotificationStore.getState().addNotification(n)
    const state = useNotificationStore.getState()
    expect(state.items[0].id).toBe(1)
    expect(state.unreadCount).toBe(1)
  })

  it('markRead sets read=true and decrements unreadCount, once', () => {
    const n = { id: 2, type: 'ticket', title: 'T', body: 'B', severity: 'info', target_role: 'support', ref_table: null, ref_id: null, created_at: '2026-07-18T00:00:00Z', read: false }
    useNotificationStore.getState().addNotification(n)
    useNotificationStore.getState().markRead(2)
    useNotificationStore.getState().markRead(2) // idempotent — shouldn't double-decrement
    const state = useNotificationStore.getState()
    expect(state.items[0].read).toBe(true)
    expect(state.unreadCount).toBe(0)
  })

  it('toggleMute flips and persists to localStorage', () => {
    useNotificationStore.getState().toggleMute()
    expect(useNotificationStore.getState().muted).toBe(true)
    expect(localStorage.getItem('admin_notifications_muted')).toBe('true')
  })
})
