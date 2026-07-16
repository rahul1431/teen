# Environment Switcher Setup Checklist

Complete checklist for setting up and testing the environment switcher in your admin panel.

## Backend Setup

### API Environment Detection

Ensure your backend API adds middleware to detect environment:

- [ ] Add `X-Environment` header handling to API middleware
- [ ] Route requests to correct database based on environment
- [ ] Route requests to correct Redis instance based on environment
- [ ] Return environment context in API responses (optional)
- [ ] Add audit logging for production deployments (optional)

**Node.js Example:**
```typescript
// middleware/environment.ts
export const environmentMiddleware = (req, res, next) => {
  req.environment = req.headers['x-environment'] || 'dev'
  req.db = req.environment === 'prod' ? prodDB : devDB
  req.redis = req.environment === 'prod' ? prodRedis : devRedis
  next()
}

app.use(environmentMiddleware)
```

### Test Environment Endpoints

- [ ] `/api/test/environment` returns current environment
- [ ] `/api/users` works in both DEV and PROD
- [ ] `/api/stats` returns different data for DEV vs PROD
- [ ] Production deployment warning shows in admin panel

## Frontend Setup

### Install Dependencies

- [ ] All dependencies already included (zustand, axios, antd)
- [ ] No new npm packages required

### Files Created

- [ ] `src/components/EnvironmentSwitcher.tsx` - UI component
- [ ] `src/store/environment.ts` - Zustand store
- [ ] `src/types/environment.ts` - Type definitions
- [ ] `src/hooks/useEnvironmentEffect.ts` - React hook
- [ ] `src/utils/environment.ts` - Utility functions
- [ ] `src/pages/Layout.tsx` - Updated with switcher
- [ ] `src/api/client.ts` - Updated with environment routing

### Verify Installation

```bash
# Check all files exist
ls -la admin-panel/src/components/EnvironmentSwitcher.tsx
ls -la admin-panel/src/store/environment.ts
ls -la admin-panel/src/types/environment.ts
ls -la admin-panel/src/hooks/useEnvironmentEffect.ts
ls -la admin-panel/src/utils/environment.ts

# No build errors
cd admin-panel && npm run build
```

## Testing Checklist

### Basic Functionality

- [ ] Switcher appears in header (for DevAdmin only)
- [ ] Clicking switcher opens dropdown menu
- [ ] Can see current environment with checkmark
- [ ] "Switch to DEV/PROD" option works
- [ ] Environment persists after page reload

### Production Warning

- [ ] Switching to PROD shows confirmation modal
- [ ] Modal warns about production environment
- [ ] Can cancel production switch
- [ ] Production switch requires explicit confirmation

### API Routing

- [ ] `X-Environment` header sent with API requests
- [ ] API calls route to correct base URL
- [ ] Data changes when switching environments
- [ ] Can see different data in DEV vs PROD

### Visual Feedback

- [ ] Header background changes based on environment
  - [ ] DEV = slight orange tint
  - [ ] PROD = slight red tint
- [ ] Environment badge color matches (orange/red)
- [ ] Info tooltip shows database and port info

### Data Refresh

- [ ] Pages using `useEnvironmentEffect` refetch on switch
- [ ] Pagination resets when switching environments
- [ ] Loading indicators show during refresh
- [ ] No errors in browser console

### User Experience

- [ ] Mobile responsive (switcher on mobile header)
- [ ] Smooth transitions
- [ ] Clear visual distinction between environments
- [ ] No lag when switching

## Integration Checklist

### Update Existing Pages

For each page that fetches data:

- [ ] Import `useEnvironmentEffect` hook
- [ ] Replace `useEffect` with `useEnvironmentEffect` for data fetching
- [ ] Add environment logging with `logWithEnv()`
- [ ] Test data refetch on environment switch

### Example Pages to Update

- [ ] Dashboard
- [ ] Users
- [ ] Games
- [ ] Finance
- [ ] Any other data-fetching pages

## Deployment Checklist

### Before Deployment

- [ ] All pages tested with both environments
- [ ] Backend middleware properly routing requests
- [ ] Database/Redis separation confirmed
- [ ] No console errors
- [ ] Production build succeeds

### Deployment Steps

```bash
# 1. Build admin panel
cd admin-panel
npm run build

# 2. Deploy build artifacts
# ... your deployment process

# 3. Verify in production
# - Login to admin panel
# - Check environment switcher appears
# - Test both environments
# - Monitor API calls in Network tab
```

### Post-Deployment Verification

- [ ] Environment switcher visible
- [ ] Can switch between environments
- [ ] API calls include X-Environment header
- [ ] Data differs between environments
- [ ] No errors in production console
- [ ] Performance acceptable

## Configuration Updates

### Update Environment Ports (if needed)

Edit `src/types/environment.ts`:

```typescript
dev: {
  servicePorts: {
    api: 3001,      // Your dev API port
    admin: 3008,    // Your dev admin port
    socket: 3009,   // Your dev socket port
  },
},
prod: {
  servicePorts: {
    api: 443,       // Your prod API port
    admin: 443,     // Your prod admin port
    socket: 443,    // Your prod socket port
  },
},
```

### Update API Base URLs

Environment variables in `.env`:

```bash
VITE_API_BASE_URL=http://localhost:3001
VITE_ADMIN_API_BASE_URL=http://localhost:3001
```

Or for production:

```bash
VITE_API_BASE_URL=https://api.myonlinejoker.com
VITE_ADMIN_API_BASE_URL=https://api.myonlinejoker.com
```

## Troubleshooting

### Issue: Switcher not showing

- [ ] Check user role is 'DevAdmin' or 'SuperAdmin'
- [ ] Check browser console for errors
- [ ] Verify EnvironmentSwitcher is imported in Layout.tsx
- [ ] Verify all files exist

### Issue: API calls not routing correctly

- [ ] Check `X-Environment` header in Network tab
- [ ] Verify base URL changed in API requests
- [ ] Check backend is using X-Environment header
- [ ] Verify VITE_API_BASE_URL is set correctly

### Issue: Data not refreshing on switch

- [ ] Verify pages use `useEnvironmentEffect` not `useEffect`
- [ ] Check API endpoints exist in both environments
- [ ] Verify no API errors in console
- [ ] Check Network tab for API requests

### Issue: Environment not persisting

- [ ] Check localStorage is enabled
- [ ] Check browser Developer Tools > Application > Storage
- [ ] Verify no localStorage errors in console
- [ ] Try clearing storage and refreshing

## Documentation

- [ ] Read `ENVIRONMENT_SWITCHER.md` for user guide
- [ ] Read `ENVIRONMENT_INTEGRATION_GUIDE.md` for developer guide
- [ ] Share documentation with team
- [ ] Add to admin panel README

## Monitoring (Optional)

Consider adding monitoring for:

- [ ] Environment switch frequency
- [ ] API errors by environment
- [ ] Data latency differences
- [ ] User complaints about wrong environment

## Support

For issues or questions:

1. Check `ENVIRONMENT_SWITCHER.md` FAQ section
2. Check `ENVIRONMENT_INTEGRATION_GUIDE.md` troubleshooting
3. Check browser console for errors
4. Verify all setup steps completed
5. Contact development team

## Completion

- [ ] All checklist items completed
- [ ] Environment switcher deployed
- [ ] All users trained on usage
- [ ] Backend properly handling environments
- [ ] Documentation distributed
- [ ] Ready for production use

**Date Completed**: _______________

**Completed By**: _______________

**Notes**: 
