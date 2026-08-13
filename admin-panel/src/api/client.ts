import axios from 'axios'

const getBaseURL = () => import.meta.env.VITE_API_BASE_URL || ''
const getAdminBaseURL = () => import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/admin'

export const api = axios.create({ baseURL: getBaseURL(), timeout: 15000 })
export const adminApi = axios.create({ baseURL: getAdminBaseURL(), timeout: 15000 })

// Attach JWT from localStorage to every request
const attachToken = (config: any) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}
api.interceptors.request.use(attachToken)
adminApi.interceptors.request.use(attachToken)

// Handle response errors: log details and redirect on session expiry
const handleErrors = (instance: any) => {
  instance.interceptors.response.use(
    (response: any) => response,
    (err: any) => {
      const status = err.response?.status
      const url = err.config?.url
      const data = err.response?.data
      console.error(`[AdminAPI] ${status} ${url}`, data || err.message)

      // Redirect to login on session expiry
      if (status === 401 && data?.session_expired) {
        const isAgent = (() => {
          try { return JSON.parse(localStorage.getItem('admin_user') || 'null')?.role === 'agent' } catch { return false }
        })()
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        window.location.href = isAgent ? '/admin/agent/login' : '/admin/login'
      }
      return Promise.reject(err)
    }
  )
}
handleErrors(api)
handleErrors(adminApi)

