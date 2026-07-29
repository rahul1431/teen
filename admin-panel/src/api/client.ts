import axios from 'axios'

const getBaseURL = () => import.meta.env.VITE_API_BASE_URL || ''

export const api = axios.create({
  baseURL: getBaseURL(),
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

// Admin-specific API calls
const getAdminBaseURL = () => import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/admin'

export const adminApi = axios.create({
  baseURL: getAdminBaseURL(),
  timeout: 15000,
})

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  return config
})
