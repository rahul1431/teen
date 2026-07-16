import { useEffect } from 'react'
import { useEnvironmentStore } from '../store/environment'

/**
 * Hook to trigger a callback when the environment changes
 * Useful for refetching data when switching between DEV and PROD
 *
 * @param callback - Function to call when environment changes
 * @param dependencies - Additional dependencies array
 *
 * @example
 * useEnvironmentEffect(() => {
 *   // Refetch data when environment changes
 *   fetchData()
 * }, [])
 */
export function useEnvironmentEffect(
  callback: () => void | Promise<void>,
  dependencies: unknown[] = []
) {
  const { currentEnv } = useEnvironmentStore()

  useEffect(() => {
    callback()
  }, [currentEnv, ...dependencies]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Hook to get the current environment and its config
 * Components using this will automatically re-render when environment changes
 */
export function useCurrentEnvironment() {
  const { currentEnv } = useEnvironmentStore()
  return currentEnv
}
