import axios from 'axios'

const getBaseURL = () => import.meta.env.VITE_API_BASE_URL || ''
const getAdminBaseURL = () => import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/admin'

export const api = axios.create({ baseURL: getBaseURL(), timeout: 15000 })
export const adminApi = axios.create({ baseURL: getAdminBaseURL(), timeout: 15000 })

const attachToken = (config: any) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}
api.interceptors.request.use(attachToken)
adminApi.interceptors.request.use(attachToken)

// Only a 401 flagged `session_expired` by the backend (JWT invalid/expired,
// or the admin was deactivated/demoted/had their password reset — see
// docs/Bugs/admin-deactivation-does-not-revoke-active-sessions.md) forces a
// logout. Business-logic 401s (wrong password, wrong 2FA code, wrong current
// password) use a different error shape and must stay local to the calling
// page's own .catch(), not bounce the admin out of the app.
const handleAuthExpiry = (err: any) => {
  if (err.response?.status === 401 && err.response.data?.session_expired) {
    const isAgent = (() => {
      try { return JSON.parse(localStorage.getItem('admin_user') || 'null')?.role === 'agent' } catch { return false }
    })()
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    window.location.href = isAgent ? '/admin/agent/login' : '/admin/login'
  }
  return Promise.reject(err)
}
api.interceptors.response.use((r) => r, handleAuthExpiry)
adminApi.interceptors.response.use((r) => r, handleAuthExpiry)
