import axios from 'axios'
import { getMockResponse } from './mockData'

const getBaseURL = () => import.meta.env.VITE_API_BASE_URL || ''
const getAdminBaseURL = () => import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/admin'

export const api = axios.create({ baseURL: getBaseURL(), timeout: 15000 })
export const adminApi = axios.create({ baseURL: getAdminBaseURL(), timeout: 15000 })

const attachTokenAndMock = (config: any) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}
api.interceptors.request.use(attachTokenAndMock)
adminApi.interceptors.request.use(attachTokenAndMock)

// Handle demo token or missing backend endpoints gracefully with mock data
const handleMockFallback = (instance: any) => {
  instance.interceptors.response.use(
    (response: any) => response,
    async (err: any) => {
      const token = localStorage.getItem('admin_token')
      const isDemo = !token || token.startsWith('demo-')
      const isNotFoundOrNetworkError = !err.response || err.response.status === 404 || err.response.status >= 500

      if ((isDemo || isNotFoundOrNetworkError) && err.config) {
        try {
          const mockData = getMockResponse(err.config.url || '', err.config.params)
          return {
            data: mockData,
            status: 200,
            statusText: 'OK (Mock)',
            headers: {},
            config: err.config,
          }
        } catch (mErr) {
          console.warn('Mock fallback failed', mErr)
        }
      }
      return handleAuthExpiry(err)
    }
  )
}

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

handleMockFallback(api)
handleMockFallback(adminApi)
