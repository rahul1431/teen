import { create } from 'zustand'

export interface AdminNotification {
  id: number
  type: string
  title: string
  body: string
  severity: string
  target_role: string
  ref_table: string | null
  ref_id: string | null
  created_at: string
  read: boolean
}

interface NotificationState {
  items: AdminNotification[]
  unreadCount: number
  muted: boolean
  addNotification: (n: AdminNotification) => void
  setInitial: (items: AdminNotification[], unreadCount: number) => void
  markRead: (id: number) => void
  markAllRead: () => void
  toggleMute: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  muted: localStorage.getItem('admin_notifications_muted') === 'true',

  addNotification: (n) => set((state) => ({
    items: [n, ...state.items].slice(0, 100),
    unreadCount: state.unreadCount + (n.read ? 0 : 1),
  })),

  setInitial: (items, unreadCount) => set({ items, unreadCount }),

  markRead: (id) => set((state) => {
    const target = state.items.find(i => i.id === id)
    if (!target || target.read) return state
    return {
      items: state.items.map(i => i.id === id ? { ...i, read: true } : i),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }
  }),

  markAllRead: () => set((state) => ({
    items: state.items.map(i => ({ ...i, read: true })),
    unreadCount: 0,
  })),

  toggleMute: () => {
    const next = !get().muted
    localStorage.setItem('admin_notifications_muted', String(next))
    set({ muted: next })
  },
}))
