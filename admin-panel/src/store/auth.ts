import { create } from 'zustand'

interface AdminUser {
  id: string
  username: string
  role: string
}

interface AuthState {
  token: string | null
  admin: AdminUser | null
  setAuth: (token: string, admin: AdminUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('admin_token'),
  admin: (() => {
    try { return JSON.parse(localStorage.getItem('admin_user') || 'null') } catch { return null }
  })(),
  setAuth: (token, admin) => {
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_user', JSON.stringify(admin))
    set({ token, admin })
  },
  logout: () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    set({ token: null, admin: null })
  },
}))
