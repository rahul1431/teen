# Environment Switcher Integration Guide

A complete guide to understanding and using the environment switcher system in the admin panel.

## Overview

The environment switcher allows DevAdmins and SuperAdmins to quickly toggle between DEV and PROD environments. All API calls automatically route to the correct environment based on the current selection.

### Key Features

- Auto-persisting environment selection (localStorage)
- One-click environment toggle with production warning
- Automatic API routing based on environment
- Zustand state management
- React hooks for easy integration
- TypeScript type safety
- Environment-aware data fetching patterns

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Admin Layout Header                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  EnvironmentSwitcher Component                        │   │
│  │  [DEV] [Switch to PROD] [Info Tooltip]               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
         ┌──────────────────────────────────┐
         │   Environment Store (Zustand)     │
         │ ┌──────────────────────────────┐ │
         │ │ State:                        │ │
         │ │ - currentEnv: 'dev' | 'prod' │ │
         │ │ - setEnvironment()            │ │
         │ │ - toggleEnvironment()         │ │
         │ └──────────────────────────────┘ │
         └──────────────────────────────────┘
                   │           │
        ┌──────────┘           └──────────┐
        ▼                                   ▼
  ┌───────────────┐           ┌────────────────────┐
  │ API Client    │           │ Component Hooks    │
  │ Interceptors  │           │ - useEnvironment*  │
  │ - Add env     │           │                    │
  │   header      │           │ - useEnvironment-  │
  │ - Route URLs  │           │   Effect()         │
  └───────────────┘           └────────────────────┘
        │                              │
        └──────────────┬───────────────┘
                       ▼
            ┌────────────────────────┐
            │   Backend Routes to:   │
            │   - DEV DB (dev_*)     │
            │   - PROD DB (prod_*)   │
            │   - DEV Services       │
            │   - PROD Services      │
            └────────────────────────┘
```

## File Structure

```
admin-panel/src/
├── components/
│   ├── EnvironmentSwitcher.tsx              # Main UI component
│   └── EnvironmentAwareData.example.tsx     # Usage examples
├── store/
│   └── environment.ts                       # Zustand store
├── types/
│   └── environment.ts                       # Types & configs
├── hooks/
│   └── useEnvironmentEffect.ts              # React hooks
├── utils/
│   └── environment.ts                       # Utility functions
├── api/
│   └── client.ts                            # Updated API client
├── pages/
│   └── Layout.tsx                           # Header integration
└── ENVIRONMENT_SWITCHER.md                  # User guide
```

## State Management

### Environment Store (Zustand)

**File**: `src/store/environment.ts`

```typescript
interface EnvironmentState {
  currentEnv: Environment                    // 'dev' | 'prod'
  setEnvironment: (env: Environment) => void // Set specific env
  toggleEnvironment: () => void              // Toggle dev ↔ prod
}
```

**Persisted to**: `localStorage['admin_environment']`

### Usage

```typescript
import { useEnvironmentStore } from '@/store/environment'

function MyComponent() {
  const { currentEnv, setEnvironment, toggleEnvironment } = useEnvironmentStore()

  return (
    <>
      <p>Current: {currentEnv}</p>
      <button onClick={() => setEnvironment('prod')}>To PROD</button>
      <button onClick={toggleEnvironment}>Toggle</button>
    </>
  )
}
```

## Configuration

### Environment Configs

**File**: `src/types/environment.ts`

Each environment has:
- `name`: 'dev' | 'prod'
- `label`: 'DEV' | 'PROD'
- `color`: Badge color (#ff7a45 or #ff4d4f)
- `bgColor`: Header background tint
- `apiUrl`: Base API URL
- `domain`: Domain name
- `database`: Database name
- `redisPort`: Redis port
- `servicePorts`: API, admin, socket ports

**To modify environment config:**

```typescript
// src/types/environment.ts
export const ENVIRONMENT_CONFIGS: Record<Environment, EnvironmentConfig> = {
  dev: {
    name: 'dev',
    label: 'DEV',
    color: '#ff7a45',
    // ... rest of config
  },
  prod: {
    name: 'prod',
    label: 'PROD',
    color: '#ff4d4f',
    // ... rest of config
  },
}
```

## API Integration

### Request Interceptors

The API client automatically:
1. Adds `X-Environment` header to all requests
2. Routes requests to correct base URL
3. Dynamically updates on environment changes

**File**: `src/api/client.ts`

```typescript
api.interceptors.request.use((config) => {
  // Update baseURL based on current environment
  config.baseURL = getBaseURL()

  // Add environment header
  const { currentEnv } = useEnvironmentStore.getState()
  config.headers['X-Environment'] = currentEnv

  return config
})
```

### Backend Route Detection

**Node.js Example:**

```typescript
// Middleware to detect environment
app.use((req, res, next) => {
  const environment = req.headers['x-environment'] || 'dev'
  
  // Route to correct database/redis
  req.db = environment === 'prod' ? prodDB : devDB
  req.redis = environment === 'prod' ? prodRedis : devRedis
  req.env = environment

  next()
})

// Use in routes
app.get('/api/users', (req, res) => {
  // Automatically uses correct database based on environment
  const users = req.db.query('SELECT * FROM users')
  res.json(users)
})
```

### Go/Echo Example:

```go
// Middleware
func EnvironmentMiddleware() echo.MiddlewareFunc {
  return func(next echo.HandlerFunc) echo.HandlerFunc {
    return func(c echo.Context) error {
      env := c.Request().Header.Get("X-Environment")
      if env == "" {
        env = "dev"
      }
      
      // Store in context
      c.Set("environment", env)
      
      return next(c)
    }
  }
}

// Use in handlers
func GetUsers(c echo.Context) error {
  env := c.Get("environment").(string)
  
  var db *gorm.DB
  if env == "prod" {
    db = prodDB
  } else {
    db = devDB
  }
  
  // Query using correct database
  return c.JSON(200, users)
}
```

## React Hooks

### useEnvironmentEffect

Automatically refetch data when environment changes:

```typescript
import { useEnvironmentEffect } from '@/hooks/useEnvironmentEffect'

function Dashboard() {
  const [data, setData] = useState(null)

  // Callback runs whenever environment changes
  useEnvironmentEffect(async () => {
    const response = await api.get('/dashboard')
    setData(response.data)
  }, [])

  return <div>{/* render data */}</div>
}
```

### Dependencies

Additional dependencies can be passed:

```typescript
useEnvironmentEffect(
  async () => {
    // Runs when environment OR filters change
    const response = await api.get('/data', {
      params: { filter: selectedFilter }
    })
    setData(response.data)
  },
  [selectedFilter] // Additional dependencies
)
```

## Utility Functions

**File**: `src/utils/environment.ts`

```typescript
// Get current environment
getCurrentEnvironment()        // Returns 'dev' | 'prod'

// Check environment
isProduction()                 // Boolean
isDevelopment()                // Boolean

// Get configuration
getEnvConfig()                 // Full config object
getApiUrl(path)                // Full API URL
getEnvLabel()                  // 'DEV' or 'PROD'
getEnvColor()                  // Environment color

// Build API endpoints
buildEndpoint('/users')        // Includes base URL

// Logging with environment context
logWithEnv('Message', data)    // Console log with [ENV] prefix
warnWithEnv('Warning', data)   // Console warn
errorWithEnv('Error', data)    // Console error

// Create messages
createEnvMessage('Hello')      // '[ENV] Hello'
```

## Common Patterns

### Pattern 1: Basic Data Fetching

```typescript
function MyPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  // Auto-refetch when environment changes
  useEnvironmentEffect(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/data')
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  return <div>{loading ? 'Loading...' : 'Data: ' + JSON.stringify(data)}</div>
}
```

### Pattern 2: With Manual Refresh

```typescript
function DataTable() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/table')
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEnvironmentEffect(() => {
    fetchData()
  }, [])

  return (
    <>
      <button onClick={fetchData} disabled={loading}>
        Refresh
      </button>
      <table>
        <tbody>
          {data.map(row => <tr key={row.id}><td>{row.name}</td></tr>)}
        </tbody>
      </table>
    </>
  )
}
```

### Pattern 3: With Pagination

```typescript
function PaginatedData() {
  const [data, setData] = useState([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const fetchData = async (pageNum: number) => {
    setLoading(true)
    try {
      const res = await api.get('/api/data', {
        params: { page: pageNum, limit: 10 }
      })
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }

  // Reset page on environment change
  useEnvironmentEffect(() => {
    setPage(1)
    fetchData(1)
  }, [])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchData(newPage)
  }

  return (
    <>
      <Table dataSource={data} />
      <Pagination current={page} onChange={handlePageChange} />
    </>
  )
}
```

### Pattern 4: Multiple Data Sources

```typescript
function Dashboard() {
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  useEnvironmentEffect(async () => {
    setLoading(true)
    try {
      // Fetch all data in parallel
      const [usersRes, statsRes] = await Promise.all([
        api.get('/api/users'),
        api.get('/api/stats'),
      ])
      setUsers(usersRes.data)
      setStats(statsRes.data)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <>
      <UserList data={users} />
      <Stats data={stats} />
    </>
  )
}
```

## Migrating Existing Pages

### Step 1: Import hooks and stores

```typescript
import { useEnvironmentEffect } from '@/hooks/useEnvironmentEffect'
import { useEnvironmentStore } from '@/store/environment'
import { createEnvMessage, logWithEnv } from '@/utils/environment'
```

### Step 2: Use useEnvironmentEffect for data fetching

**Before:**
```typescript
useEffect(() => {
  fetchData()
}, [])
```

**After:**
```typescript
useEnvironmentEffect(() => {
  fetchData()
}, [])
```

### Step 3: Add error handling with environment context

**Before:**
```typescript
} catch (err) {
  console.error('Failed to load data')
}
```

**After:**
```typescript
} catch (err) {
  logWithEnv('Failed to load data', err)
}
```

### Step 4: Show current environment (optional)

```typescript
function MyPage() {
  const { currentEnv } = useEnvironmentStore()

  return (
    <Alert
      message={`Environment: ${currentEnv.toUpperCase()}`}
      type="info"
    />
  )
}
```

## Testing

### Testing Environment Switching

```typescript
// Mock the store
jest.mock('@/store/environment', () => ({
  useEnvironmentStore: jest.fn(() => ({
    currentEnv: 'dev',
    setEnvironment: jest.fn(),
  })),
}))

// Test component renders with env
test('shows current environment', () => {
  render(<MyComponent />)
  expect(screen.getByText('Environment: DEV')).toBeInTheDocument()
})
```

### Testing API Calls

```typescript
test('fetches data from correct environment', async () => {
  const apiSpy = jest.spyOn(api, 'get')
  
  render(<Dashboard />)
  
  await waitFor(() => {
    expect(apiSpy).toHaveBeenCalledWith('/api/data')
  })
})
```

## Performance Considerations

1. **Environment store is reactive** - Components re-render only when `currentEnv` changes
2. **API interceptors are efficient** - Header added on every request, URL updated dynamically
3. **LocalStorage is async** - Environment loads synchronously from cache
4. **No unnecessary re-renders** - Only affected components re-render on environment change

## Security Notes

1. **Frontend only** - Environment selection is UI-only, backend validates `X-Environment` header
2. **Role-based access** - Switcher only visible to DevAdmin/SuperAdmin roles
3. **Clear separation** - DEV and PROD use separate databases/Redis instances
4. **Backend routing** - Always validate environment header on backend
5. **Audit logging** - Consider logging environment switches in production

## Troubleshooting

### Environment not persisting

**Issue**: Environment resets on page reload

**Solution**:
- Check localStorage is enabled
- Verify browser allows localStorage for this domain
- Check browser console for errors

### API calls going to wrong environment

**Issue**: API calls still use old environment after switching

**Solution**:
- Clear browser cache and localStorage
- Verify API client has latest code
- Check X-Environment header is being sent (`DevTools > Network > Headers`)
- Verify backend is using the header correctly

### Switcher not visible

**Issue**: Environment switcher doesn't appear in header

**Solution**:
- Verify your role is 'DevAdmin' or 'SuperAdmin' (case-sensitive)
- Check browser console for errors
- Verify EnvironmentSwitcher is imported in Layout.tsx
- Inspect element to see if component is in DOM

### Data doesn't refresh on environment switch

**Issue**: Data stays the same when switching environments

**Solution**:
- Use `useEnvironmentEffect` instead of `useEffect`
- Check component is calling the API
- Verify API endpoint exists in both environments
- Check network tab for API calls

## Future Enhancements

- Audit logging for environment switches
- Environment-specific feature flags
- Staging/QA environment support
- Environment sync status indicator
- Scheduled backups per environment
- A/B testing utilities
- Environment comparison view

## Related Files

- `src/components/EnvironmentSwitcher.tsx` - Main UI component
- `src/store/environment.ts` - Zustand store
- `src/types/environment.ts` - Types and configs
- `src/hooks/useEnvironmentEffect.ts` - React hooks
- `src/utils/environment.ts` - Utility functions
- `src/api/client.ts` - API client with interceptors
- `src/pages/Layout.tsx` - Integration in header
- `ENVIRONMENT_SWITCHER.md` - User guide
