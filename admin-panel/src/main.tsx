import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App, Button, Result } from 'antd'
import { antdTheme } from './theme/antdTheme'
import { tokens } from './theme/tokens'
import './index.css'
import { useAuthStore } from './store/auth'

// Auto-recovery for lazy loading when new deployment changes chunk hashes
function lazyRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  name: string = 'Component'
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem(`page-has-been-force-refreshed-${name}`) || 'false'
    )

    try {
      const component = await componentImport()
      window.sessionStorage.setItem(`page-has-been-force-refreshed-${name}`, 'false')
      return component
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        window.sessionStorage.setItem(`page-has-been-force-refreshed-${name}`, 'true')
        window.location.reload()
      }
      throw error
    }
  })
}

// Global React Error Boundary
class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[GlobalErrorBoundary] Uncaught React error:', error, errorInfo)
  }

  handleReload = () => {
    localStorage.removeItem('page-has-been-force-refreshed')
    window.location.reload()
  }

  handleClearCacheAndLogout = () => {
    localStorage.clear()
    sessionStorage.clear()
    window.location.href = '/admin/login'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0D0F14',
          padding: 24,
        }}>
          <Result
            status="error"
            title={<span style={{ color: '#FFFFFF' }}>Admin Console Encountered An Issue</span>}
            subTitle={
              <span style={{ color: tokens.color.textOnDarkMuted }}>
                {this.state.error?.message || 'An unexpected rendering error occurred. Please reload to refresh the cached assets.'}
              </span>
            }
            extra={[
              <Button type="primary" key="reload" onClick={this.handleReload} size="large" style={{ background: tokens.color.gold, borderColor: tokens.color.gold, color: '#000000', fontWeight: 600 }}>
                Reload Page
              </Button>,
              <Button key="logout" onClick={this.handleClearCacheAndLogout} size="large" style={{ color: '#FFFFFF', borderColor: 'rgba(255,255,255,0.3)' }}>
                Clear Cache & Re-login
              </Button>
            ]}
          />
        </div>
      )
    }

    return this.props.children
  }
}

const Login = lazyRetry(() => import('./pages/Login'), 'Login')
const AdminLayout = lazyRetry(() => import('./pages/Layout'), 'Layout')
const Dashboard = lazyRetry(() => import('./pages/Dashboard'), 'Dashboard')
const Users = lazyRetry(() => import('./pages/Users'), 'Users')
const Bots = lazyRetry(() => import('./pages/Bots'), 'Bots')
const Finance = lazyRetry(() => import('./pages/Finance'), 'Finance')
const Notifications = lazyRetry(() => import('./pages/Notifications'), 'Notifications')
const NotificationsHistory = lazyRetry(() => import('./pages/NotificationsHistory'), 'NotificationsHistory')
const AdminUsers = lazyRetry(() => import('./pages/AdminUsers'), 'AdminUsers')
const Profile = lazyRetry(() => import('./pages/Profile'), 'Profile')
const RiskCenter = lazyRetry(() => import('./pages/RiskCenter'), 'RiskCenter')
const Support = lazyRetry(() => import('./pages/Support'), 'Support')
const TeenPatti = lazyRetry(() => import('./pages/games/TeenPatti'), 'TeenPatti')
const Ludo = lazyRetry(() => import('./pages/games/Ludo'), 'Ludo')
const Aviator = lazyRetry(() => import('./pages/games/Aviator'), 'Aviator')
const Matka = lazyRetry(() => import('./pages/games/Matka'), 'Matka')
const Lottery = lazyRetry(() => import('./pages/games/Lottery'), 'Lottery')
const Cricket = lazyRetry(() => import('./pages/games/Cricket'), 'Cricket')
const Rummy = lazyRetry(() => import('./pages/games/Rummy'), 'Rummy')
const ColorPrediction = lazyRetry(() => import('./pages/games/ColorPrediction'), 'ColorPrediction')
const Leaderboard = lazyRetry(() => import('./pages/Leaderboard'), 'Leaderboard')
const Security = lazyRetry(() => import('./pages/Security'), 'Security')
const Changelog = lazyRetry(() => import('./pages/Changelog'), 'Changelog')
const AIControlCenter = lazyRetry(() => import('./pages/AIControlCenter').then(module => ({ default: module.AIControlCenter })), 'AIControlCenter')
const AppMonitor = lazyRetry(() => import('./pages/AppMonitor'), 'AppMonitor')
const PlayerTracking = lazyRetry(() => import('./pages/PlayerTracking'), 'PlayerTracking')
const Banners = lazyRetry(() => import('./pages/Banners'), 'Banners')
const PromoCodes = lazyRetry(() => import('./pages/PromoCodes'), 'PromoCodes')
const KYCPage = lazyRetry(() => import('./pages/KYC'), 'KYC')
const AppUpdate = lazyRetry(() => import('./pages/AppUpdate'), 'AppUpdate')
const Marketing = lazyRetry(() => import('./pages/Marketing'), 'Marketing')
const CMSManagement = lazyRetry(() => import('./pages/CMSManagement'), 'CMSManagement')
const MetricsDashboard = lazyRetry(() => import('./pages/MetricsDashboard'), 'MetricsDashboard')
const PlayerAnomaliesPage = lazyRetry(() => import('./pages/PlayerAnomaliesPage'), 'PlayerAnomaliesPage')
const Tasks = lazyRetry(() => import('./pages/Tasks'), 'Tasks')
const Agents = lazyRetry(() => import('./pages/Agents'), 'Agents')
const Analytics = lazyRetry(() => import('./pages/Analytics'), 'Analytics')
const AgentLogin = lazyRetry(() => import('./pages/AgentLogin'), 'AgentLogin')
const AgentPortal = lazyRetry(() => import('./pages/AgentPortal'), 'AgentPortal')
const WebsiteSettings = lazyRetry(() => import('./pages/WebsiteSettings'), 'WebsiteSettings')
const AppControls = lazyRetry(() => import('./pages/AppControls'), 'AppControls')
const Missions = lazyRetry(() => import('./pages/Missions'), 'Missions')
const GameRooms = lazyRetry(() => import('./pages/GameRooms'), 'GameRooms')
const LeadManager = lazyRetry(() => import('./pages/LeadManager'), 'LeadManager')
const UserDetailPage = lazyRetry(() => import('./pages/UserDetailPage'), 'UserDetailPage')

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, admin } = useAuthStore()
  // An agent JWT must never render the admin SPA shell
  if (!token || admin?.role === 'agent') return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

function ProtectedAgentRoute({ children }: { children: React.ReactNode }) {
  const { token, admin } = useAuthStore()
  if (!token || admin?.role !== 'agent') return <Navigate to="/admin/agent/login" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <GlobalErrorBoundary>
    <ConfigProvider theme={antdTheme}>
      <App>
        <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASE || undefined}>
          <Suspense fallback={<div style={{ padding: 100, textAlign: 'center', fontSize: 18, color: tokens.color.gold }}>Loading console...</div>}>
            <Routes>
              <Route path="/admin/login" element={<Login />} />
              <Route path="/admin/agent/login" element={<AgentLogin />} />
              <Route path="/admin/agent" element={<ProtectedAgentRoute><AgentPortal /></ProtectedAgentRoute>} />
              <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="users" element={<Users />} />
                <Route path="users/view/:userId" element={<UserDetailPage />} />
                <Route path="leads" element={<LeadManager />} />
                <Route path="bots" element={<Bots />} />
                <Route path="finance" element={<Finance />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="notifications-history" element={<NotificationsHistory />} />
                <Route path="games/teen-patti" element={<TeenPatti />} />
                <Route path="games/ludo" element={<Ludo />} />
                <Route path="games/aviator" element={<Aviator />} />
                <Route path="games/matka" element={<Matka />} />
                <Route path="games/lottery" element={<Lottery />} />
                <Route path="games/cricket" element={<Cricket />} />
                <Route path="games/rummy" element={<Rummy />} />
                <Route path="games/color-prediction" element={<ColorPrediction />} />
                <Route path="admin-users" element={<AdminUsers />} />
                <Route path="profile" element={<Profile />} />
                <Route path="risk-center" element={<RiskCenter />} />
                <Route path="ai-control" element={<AIControlCenter />} />
                <Route path="support" element={<Support />} />
                <Route path="leaderboard" element={<Leaderboard />} />
                <Route path="security" element={<Security />} />
                <Route path="changelog" element={<Changelog />} />
                <Route path="app-monitor" element={<AppMonitor />} />
                <Route path="player-tracking" element={<PlayerTracking />} />
                <Route path="banners" element={<Banners />} />
                <Route path="promo-codes" element={<PromoCodes />} />
                <Route path="marketing" element={<Marketing />} />
                <Route path="marketing/cms" element={<CMSManagement />} />
                <Route path="kyc" element={<KYCPage />} />
                <Route path="app-update" element={<AppUpdate />} />
                <Route path="metrics-dashboard" element={<MetricsDashboard />} />
                <Route path="player-anomalies" element={<PlayerAnomaliesPage />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="agents" element={<Agents />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="settings" element={<WebsiteSettings />} />
                <Route path="app-controls" element={<AppControls />} />
                <Route path="missions" element={<Missions />} />
                <Route path="game-rooms" element={<GameRooms />} />
              </Route>
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </App>
    </ConfigProvider>
  </GlobalErrorBoundary>
)
