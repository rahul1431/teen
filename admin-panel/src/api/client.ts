import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE_URL || ''

export const api = axios.create({
  baseURL: BASE,
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      window.location.href = '/admin/login'
    }
    return Promise.reject(err)
  }
)

// Admin-specific API calls (admin service on port 3008)
export const adminApi = axios.create({
  baseURL: (import.meta.env.VITE_ADMIN_API_BASE_URL || BASE) + '/api/admin',
  timeout: 15000,
})

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
