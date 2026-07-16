import { useEnvironmentStore } from '../store/environment'
import { ENVIRONMENT_CONFIGS, Environment } from '../types/environment'

/**
 * Get the current environment configuration
 */
export function getEnvConfig() {
  const { currentEnv } = useEnvironmentStore.getState()
  return ENVIRONMENT_CONFIGS[currentEnv]
}

/**
 * Get the current environment
 */
export function getCurrentEnvironment(): Environment {
  const { currentEnv } = useEnvironmentStore.getState()
  return currentEnv
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return getCurrentEnvironment() === 'prod'
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return getCurrentEnvironment() === 'dev'
}

/**
 * Get environment-specific API URL
 */
export function getApiUrl(path?: string): string {
  const config = getEnvConfig()
  const baseUrl = config.apiUrl
  if (path) {
    return `${baseUrl}${path}`
  }
  return baseUrl
}

/**
 * Build environment-aware API endpoint
 */
export function buildEndpoint(endpoint: string): string {
  const config = getEnvConfig()
  return `${config.apiUrl}${endpoint}`
}

/**
 * Get environment display label with color
 */
export function getEnvLabel() {
  const config = getEnvConfig()
  return config.label
}

/**
 * Get environment color
 */
export function getEnvColor() {
  const config = getEnvConfig()
  return config.color
}

/**
 * Get environment background color
 */
export function getEnvBgColor() {
  const config = getEnvConfig()
  return config.bgColor
}

/**
 * Create a message with environment context
 */
export function createEnvMessage(message: string): string {
  const env = getEnvLabel()
  return `[${env}] ${message}`
}

/**
 * Log with environment context
 */
export function logWithEnv(message: string, data?: unknown) {
  const prefix = `[${getEnvLabel()}]`
  if (data) {
    console.log(`${prefix} ${message}`, data)
  } else {
    console.log(`${prefix} ${message}`)
  }
}

/**
 * Warn with environment context
 */
export function warnWithEnv(message: string, data?: unknown) {
  const prefix = `[${getEnvLabel()}]`
  if (data) {
    console.warn(`${prefix} ${message}`, data)
  } else {
    console.warn(`${prefix} ${message}`)
  }
}

/**
 * Error with environment context
 */
export function errorWithEnv(message: string, data?: unknown) {
  const prefix = `[${getEnvLabel()}]`
  if (data) {
    console.error(`${prefix} ${message}`, data)
  } else {
    console.error(`${prefix} ${message}`)
  }
}
