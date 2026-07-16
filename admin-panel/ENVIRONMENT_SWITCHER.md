# Environment Switcher

The admin panel now includes a DEV/PROD environment switcher that allows DevAdmins and SuperAdmins to quickly toggle between development and production environments.

## Features

- **Header Badge/Toggle**: Shows current environment (DEV/PROD) with color coding
  - DEV = Orange (#ff7a45)
  - PROD = Red (#ff4d4f)
- **Quick Switcher Menu**: Dropdown menu with environment information
- **Environment Info Tooltip**: Shows domain, database, and service ports on hover
- **Production Warning**: Confirmation modal when switching to PROD
- **State Persistence**: Environment selection persists in localStorage
- **Visual Feedback**: Header background tint changes based on environment
- **Role-Based Access**: Only DevAdmin and SuperAdmin can use the switcher
- **API Integration**: All API calls automatically route to correct environment

## Component Structure

```
src/
├── components/
│   └── EnvironmentSwitcher.tsx          # Main switcher component
├── store/
│   └── environment.ts                   # Zustand environment state
├── types/
│   └── environment.ts                   # TypeScript types & configs
├── hooks/
│   └── useEnvironmentEffect.ts          # Hook for environment-aware data fetching
└── pages/
    └── Layout.tsx                       # Updated with switcher in header
```

## Usage

### For End Users (DevAdmin/SuperAdmin)

1. Look for the **environment badge** in the top-right corner of the admin panel header
2. Click to open the switcher dropdown
3. Click "Switch to DEV" or "Switch to PROD"
4. If switching to PROD, confirm the action in the modal
5. The environment changes persist across page reloads

### For Developers

#### Using the Environment Store

```typescript
import { useEnvironmentStore } from '@/store/environment'

function MyComponent() {
  const { currentEnv, setEnvironment, toggleEnvironment } = useEnvironmentStore()

  return (
    <div>
      <p>Current: {currentEnv}</p>
      <button onClick={() => setEnvironment('prod')}>Switch to PROD</button>
      <button onClick={toggleEnvironment}>Toggle</button>
    </div>
  )
}
```

#### Getting Environment Config

```typescript
import { useEnvironmentStore } from '@/store/environment'
import { ENVIRONMENT_CONFIGS } from '@/types/environment'

function MyComponent() {
  const { currentEnv } = useEnvironmentStore()
  const config = ENVIRONMENT_CONFIGS[currentEnv]

  return <div>API URL: {config.apiUrl}</div>
}
```

#### Refetching Data on Environment Change

Use the `useEnvironmentEffect` hook to automatically refetch data when the environment changes:

```typescript
import { useEnvironmentEffect } from '@/hooks/useEnvironmentEffect'
import { api } from '@/api/client'

function DashboardPage() {
  const [data, setData] = useState(null)

  // Automatically refetch when environment changes
  useEnvironmentEffect(async () => {
    const response = await api.get('/dashboard')
    setData(response.data)
  }, [])

  return <div>{/* render data */}</div>
}
```

## API Integration

The API client automatically adds the environment context to all requests:

### Headers
```
X-Environment: dev | prod
```

### Base URLs
The API client dynamically routes requests to the correct environment:
- **DEV**: http://localhost:3001
- **PROD**: https://api.myonlinejoker.com

### Backend Example (Node.js/Express)

```typescript
// Middleware to detect environment from header
app.use((req, res, next) => {
  const environment = req.headers['x-environment'] || 'dev'
  req.environment = environment

  // Route to correct database/services
  req.db = environment === 'prod' ? prodDB : devDB
  req.redis = environment === 'prod' ? prodRedis : devRedis

  next()
})

// Use in routes
app.get('/api/dashboard', (req, res) => {
  const data = req.db.query('SELECT * FROM users')
  res.json(data)
})
```

## Environment Configuration

Edit `src/types/environment.ts` to add or modify environment configurations:

```typescript
export const ENVIRONMENT_CONFIGS: Record<Environment, EnvironmentConfig> = {
  dev: {
    name: 'dev',
    label: 'DEV',
    color: '#ff7a45',
    bgColor: 'rgba(255, 122, 69, 0.1)',
    apiUrl: 'http://localhost:3001',
    domain: 'localhost',
    database: 'teen_dev',
    redisPort: 6379,
    servicePorts: {
      api: 3001,
      admin: 3008,
      socket: 3009,
    },
  },
  // ... prod config
}
```

## Best Practices

1. **Always use useEnvironmentStore()** to get the current environment instead of hardcoding URLs
2. **Use useEnvironmentEffect()** in pages that fetch data to automatically refresh when switching environments
3. **Add loading states** when environment changes to show data is being refreshed
4. **Test both DEV and PROD** when implementing features that interact with different environments
5. **Document environment-specific behavior** in code comments

## Security Notes

- The environment switcher is only visible to DevAdmin and SuperAdmin roles
- Production switches require explicit confirmation
- Environment selection is stored in localStorage (accessible only to the admin panel)
- The X-Environment header should be validated on the backend
- Consider adding audit logging for environment switches in production

## Troubleshooting

### Environment not persisting across page reloads
- Check that localStorage is not disabled
- Verify the browser allows localStorage for the admin panel domain

### API calls still going to old environment
- Clear browser cache and localStorage
- Verify the API client interceptor is properly adding the X-Environment header
- Check backend is correctly routing based on the header

### Switcher not appearing
- Verify your admin role is 'DevAdmin' or 'SuperAdmin' (case-sensitive)
- Check browser console for any errors
- Ensure EnvironmentSwitcher component is imported in Layout.tsx

## Future Enhancements

- [ ] Add audit logging for environment switches
- [ ] Show data sync status when switching environments
- [ ] Add environment-specific feature flags
- [ ] Create environment comparison view
- [ ] Add scheduled environment backups
- [ ] Support for staging/QA environments
