import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000, // 30s for load balancing tests
    hookTimeout: 30000,
  },
})
