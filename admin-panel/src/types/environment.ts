export type Environment = 'dev' | 'prod'

export interface EnvironmentConfig {
  name: Environment
  label: string
  color: string
  bgColor: string
  apiUrl: string
  domain: string
  database: string
  redisPort: number
  servicePorts: {
    api: number
    admin: number
    socket: number
  }
}

export const ENVIRONMENT_CONFIGS: Record<Environment, EnvironmentConfig> = {
  dev: {
    name: 'dev',
    label: 'DEV',
    color: '#ff7a45',
    bgColor: 'rgba(255, 122, 69, 0.1)',
    apiUrl: '/api',
    domain: 'dev.myonlinejoker.com',
    database: 'teen_dev',
    redisPort: 6379,
    servicePorts: {
      api: 443,
      admin: 443,
      socket: 443,
    },
  },
  prod: {
    name: 'prod',
    label: 'PROD',
    color: '#ff4d4f',
    bgColor: 'rgba(255, 77, 79, 0.1)',
    apiUrl: '/api',
    domain: 'myonlinejoker.com',
    database: 'teen_prod',
    redisPort: 6380,
    servicePorts: {
      api: 443,
      admin: 443,
      socket: 443,
    },
  },
}
