import axios from 'axios'
import { useEnvironmentStore } from '../store/environment'
import { ENVIRONMENT_CONFIGS } from '../types/environment'

const getBaseURL = () => {
  const { currentEnv } = useEnvironmentStore.getState()
  return import.meta.env.VITE_API_BASE_URL || ENVIRONMENT_CONFIGS[currentEnv].apiUrl || ''
}

export const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  // Update baseURL dynamically based on current environment
  config.baseURL = getBaseURL()

  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Add environment header for backend routing
  const { currentEnv } = useEnvironmentStore.getState()
  config.headers['X-Environment'] = currentEnv

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
const getAdminBaseURL = () => {
  const { currentEnv } = useEnvironmentStore.getState()
  // Use relative path for admin API
  return import.meta.env.VITE_ADMIN_API_BASE_URL || '/api/admin'
}

export const adminApi = axios.create({
  baseURL: getAdminBaseURL(),
  timeout: 15000,
})

adminApi.interceptors.request.use((config) => {
  // Update baseURL dynamically based on current environment
  config.baseURL = getAdminBaseURL()

  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Add environment header for backend routing
  const { currentEnv } = useEnvironmentStore.getState()
  config.headers['X-Environment'] = currentEnv

  return config
})
