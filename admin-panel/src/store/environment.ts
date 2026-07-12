import { create } from 'zustand'
import { Environment } from '../types/environment'

interface EnvironmentState {
  currentEnv: Environment
  setEnvironment: (env: Environment) => void
  toggleEnvironment: () => void
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  currentEnv: (() => {
    try {
      const stored = localStorage.getItem('admin_environment')
      return (stored as Environment) || 'dev'
    } catch {
      return 'dev'
    }
  })(),
  setEnvironment: (env: Environment) => {
    localStorage.setItem('admin_environment', env)
    set({ currentEnv: env })
  },
  toggleEnvironment: () => {
    const currentEnv = get().currentEnv
    const newEnv = currentEnv === 'dev' ? 'prod' : 'dev'
    get().setEnvironment(newEnv)
  },
}))
