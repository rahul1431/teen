import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import './index.css'
import { useAuthStore } from './store/auth'

const Login = React.lazy(() => import('./pages/Login'))
const AdminLayout = React.lazy(() => import('./pages/Layout'))
const Dashboard = React.lazy(() => import('./pages/Dashboard'))
const Users = React.lazy(() => import('./pages/Users'))
const Bots = React.lazy(() => import('./pages/Bots'))
const Finance = React.lazy(() => import('./pages/Finance'))
const Notifications = React.lazy(() => import('./pages/Notifications'))
const AdminUsers = React.lazy(() => import('./pages/AdminUsers'))
const Profile = React.lazy(() => import('./pages/Profile'))
const RiskCenter = React.lazy(() => import('./pages/RiskCenter'))
const Support = React.lazy(() => import('./pages/Support'))
const TeenPatti = React.lazy(() => import('./pages/games/TeenPatti'))
const Ludo = React.lazy(() => import('./pages/games/Ludo'))
const Aviator = React.lazy(() => import('./pages/games/Aviator'))
const Matka = React.lazy(() => import('./pages/games/Matka'))
const Lottery = React.lazy(() => import('./pages/games/Lottery'))
const Cricket = React.lazy(() => import('./pages/games/Cricket'))
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'))
const Security = React.lazy(() => import('./pages/Security'))
const Changelog = React.lazy(() => import('./pages/Changelog'))
const AIControlCenter = React.lazy(() => import('./pages/AIControlCenter').then(module => ({ default: module.AIControlCenter })))
const AppMonitor = React.lazy(() => import('./pages/AppMonitor'))
const PlayerTracking = React.lazy(() => import('./pages/PlayerTracking'))
const DailyBonus = React.lazy(() => import('./pages/DailyBonus'))
const Banners = React.lazy(() => import('./pages/Banners'))
const PromoCodes = React.lazy(() => import('./pages/PromoCodes'))
const KYCPage = React.lazy(() => import('./pages/KYC'))
const AppUpdate = React.lazy(() => import('./pages/AppUpdate'))
const Marketing = React.lazy(() => import('./pages/Marketing'))
const CMSManagement = React.lazy(() => import('./pages/CMSManagement'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#d4af37', borderRadius: 8 } }}>
    <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASE || undefined}>
      <Suspense fallback={<div style={{ padding: 100, textAlign: 'center', fontSize: 18, color: '#d4af37' }}>Loading page...</div>}>
        <Routes>
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="bots" element={<Bots />} />
            <Route path="finance" element={<Finance />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="games/teen-patti" element={<TeenPatti />} />
            <Route path="games/ludo" element={<Ludo />} />
            <Route path="games/aviator" element={<Aviator />} />
            <Route path="games/matka" element={<Matka />} />
            <Route path="games/lottery" element={<Lottery />} />
            <Route path="games/cricket" element={<Cricket />} />
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
            <Route path="daily-bonus" element={<DailyBonus />} />
            <Route path="banners" element={<Banners />} />
            <Route path="promo-codes" element={<PromoCodes />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="marketing/cms" element={<CMSManagement />} />
            <Route path="kyc" element={<KYCPage />} />
            <Route path="app-update" element={<AppUpdate />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </ConfigProvider>
)
