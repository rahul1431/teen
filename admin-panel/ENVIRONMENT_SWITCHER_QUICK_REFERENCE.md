# Environment Switcher - Quick Reference

A cheat sheet for developers working with the environment switcher.

## Common Imports

```typescript
// Store
import { useEnvironmentStore } from '@/store/environment'

// Hooks
import { useEnvironmentEffect } from '@/hooks/useEnvironmentEffect'

// Types
import { Environment, ENVIRONMENT_CONFIGS } from '@/types/environment'

// Utils
import {
  getCurrentEnvironment,
  isProduction,
  isDevelopment,
  getEnvConfig,
  getApiUrl,
  logWithEnv,
} from '@/utils/environment'

// API
import { api, adminApi } from '@/api/client'
```

## Common Patterns

### Get Current Environment
```typescript
const { currentEnv } = useEnvironmentStore()
// 'dev' or 'prod'
```

### Get Environment Config
```typescript
const config = ENVIRONMENT_CONFIGS[currentEnv]
console.log(config.apiUrl)    // API URL
console.log(config.domain)    // Domain name
console.log(config.database)  // Database name
```

### Check Environment
```typescript
if (isProduction()) { /* ... */ }
if (isDevelopment()) { /* ... */ }
```

### Fetch Data (Auto-Refresh on Switch)
```typescript
useEnvironmentEffect(async () => {
  const res = await api.get('/api/data')
  setData(res.data)
}, [])
```

### Fetch with Dependencies
```typescript
useEnvironmentEffect(async () => {
  const res = await api.get('/api/data', {
    params: { filter: selectedFilter }
  })
  setData(res.data)
}, [selectedFilter])
```

### Switch Environment
```typescript
const { setEnvironment } = useEnvironmentStore()
setEnvironment('prod')  // Switch to PROD
setEnvironment('dev')   // Switch to DEV
```

### Toggle Environment
```typescript
const { toggleEnvironment } = useEnvironmentStore()
toggleEnvironment()  // dev ↔ prod
```

### Log with Context
```typescript
logWithEnv('Data loaded successfully')
// Output: [DEV] Data loaded successfully
```

## Complete Example Component

```typescript
import { useState } from 'react'
import { Card, Spin, Button } from 'antd'
import { useEnvironmentStore } from '@/store/environment'
import { useEnvironmentEffect } from '@/hooks/useEnvironmentEffect'
import { api } from '@/api/client'
import { logWithEnv } from '@/utils/environment'

export function MyPage() {
  const { currentEnv } = useEnvironmentStore()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  // Auto-refetch when environment changes
  useEnvironmentEffect(async () => {
    await fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      logWithEnv('Fetching data...')
      const res = await api.get('/api/my-data')
      setData(res.data)
    } catch (err) {
      logWithEnv('Error fetching data', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title={`My Page (${currentEnv.toUpperCase()})`}>
      {loading && <Spin />}
      {data && <div>{JSON.stringify(data)}</div>}
      <Button onClick={fetchData}>Refresh</Button>
    </Card>
  )
}
```

## API Configuration

```typescript
// All requests automatically include:
// Header: X-Environment: dev|prod
// URL: routed to correct environment

// Example:
await api.get('/api/users')
// Requests to:
// DEV:  http://localhost:3001/api/users
// PROD: https://api.myonlinejoker.com/api/users
// Header: X-Environment: dev|prod
```

## Environment Info

### Development (DEV)
- URL: `http://localhost:3001`
- Domain: `localhost`
- Database: `teen_dev`
- Redis: `:6379`
- Color: Orange (#ff7a45)

### Production (PROD)
- URL: `https://api.myonlinejoker.com`
- Domain: `myonlinejoker.com`
- Database: `teen_prod`
- Redis: `:6380`
- Color: Red (#ff4d4f)

## Utility Functions

```typescript
getCurrentEnvironment()        // 'dev' | 'prod'
getEnvConfig()                 // Full config object
getApiUrl('/path')             // Full API URL
buildEndpoint('/users')        // API endpoint with base URL
getEnvLabel()                  // 'DEV' | 'PROD'
getEnvColor()                  // Color hex (#ff7a45 or #ff4d4f)
getEnvBgColor()                // Background color with alpha
isProduction()                 // boolean
isDevelopment()                // boolean
logWithEnv('msg', data)        // Console log with [ENV] prefix
warnWithEnv('msg', data)       // Console warn with [ENV] prefix
errorWithEnv('msg', data)      // Console error with [ENV] prefix
createEnvMessage('msg')        // '[ENV] msg'
```

## TypeScript Types

```typescript
type Environment = 'dev' | 'prod'

interface EnvironmentConfig {
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
```

## Common Mistakes to Avoid

```typescript
// ❌ DON'T: Use useEffect for data fetching with environment
useEffect(() => {
  fetchData()
}, [])  // Won't refetch on environment change!

// ✅ DO: Use useEnvironmentEffect
useEnvironmentEffect(() => {
  fetchData()
}, [])  // Automatically refetches on environment change

// ❌ DON'T: Hardcode API URLs
const url = 'http://localhost:3001/api/users'

// ✅ DO: Use environment config
const url = getApiUrl('/api/users')

// ❌ DON'T: Ignore environment in logging
console.error('Failed to load data')

// ✅ DO: Include environment context
errorWithEnv('Failed to load data')
```

## Debugging

```typescript
// Check current environment
const { currentEnv } = useEnvironmentStore()
console.log(currentEnv)

// Check environment config
import { ENVIRONMENT_CONFIGS } from '@/types/environment'
console.log(ENVIRONMENT_CONFIGS)

// Check localStorage
console.log(localStorage.getItem('admin_environment'))

// Check API headers
// DevTools > Network > Select request > Headers
// Look for: X-Environment: dev|prod

// Check API URL
// DevTools > Network > Select request > look at URL
// Should match environment's apiUrl

// Simulate environment change for testing
import { useEnvironmentStore } from '@/store/environment'
useEnvironmentStore.setState({ currentEnv: 'prod' })
```

## Testing

```typescript
// Mock environment
jest.mock('@/store/environment', () => ({
  useEnvironmentStore: () => ({
    currentEnv: 'dev',
    setEnvironment: jest.fn(),
  })
}))

// Test component with environment
test('renders dev environment', () => {
  render(<MyComponent />)
  expect(screen.getByText(/DEV/)).toBeInTheDocument()
})

// Test API calls
test('calls correct API for environment', async () => {
  const spy = jest.spyOn(api, 'get')
  render(<MyComponent />)
  await waitFor(() => {
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][1]?.headers['X-Environment']).toBe('dev')
  })
})
```

## Backend Integration

```typescript
// Node.js / Express
app.use((req, res, next) => {
  const env = req.headers['x-environment'] || 'dev'
  req.db = env === 'prod' ? prodDB : devDB
  req.redis = env === 'prod' ? prodRedis : devRedis
  next()
})

// Go / Echo
func EnvironmentMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
  return func(c echo.Context) error {
    env := c.Request().Header.Get("X-Environment")
    if env == "" { env = "dev" }
    c.Set("environment", env)
    return next(c)
  }
}

// Use in handlers
app.get('/api/users', (req, res) => {
  const users = req.db.query('SELECT * FROM users')
  res.json(users)
})
```

## Troubleshooting One-Liners

```typescript
// Not seeing switcher?
useAuthStore().admin.role  // Should be 'DevAdmin' or 'SuperAdmin'

// API not routing?
// DevTools: Network tab → Headers → X-Environment

// Data not refreshing?
// Make sure you're using useEnvironmentEffect not useEffect

// Lost environment on reload?
localStorage.getItem('admin_environment')  // Should have 'dev' or 'prod'

// Want to change API URL?
// Edit: src/types/environment.ts → ENVIRONMENT_CONFIGS
```

## File Locations

```
Components:        src/components/EnvironmentSwitcher.tsx
Store:            src/store/environment.ts
Types:            src/types/environment.ts
Hooks:            src/hooks/useEnvironmentEffect.ts
Utils:            src/utils/environment.ts
API Client:       src/api/client.ts
Layout:           src/pages/Layout.tsx
```

## Resources

- **User Guide**: `ENVIRONMENT_SWITCHER.md`
- **Developer Guide**: `ENVIRONMENT_INTEGRATION_GUIDE.md`
- **Setup Guide**: `ENVIRONMENT_SWITCHER_SETUP.md`
- **Examples**: `src/components/EnvironmentAwareData.example.tsx`

## Quick Links

- Toggle switcher: Header top-right (DevAdmin only)
- Check localStorage: DevTools → Application → Storage → Local Storage
- Debug API: DevTools → Network tab → Headers
- Update config: `src/types/environment.ts` → ENVIRONMENT_CONFIGS
- View docs: `ENVIRONMENT_SWITCHER_SETUP.md`
