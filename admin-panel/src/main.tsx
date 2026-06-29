import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import Login from './pages/Login'
import AdminLayout from './pages/Layout'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import Bots from './pages/Bots'
import Finance from './pages/Finance'
import Notifications from './pages/Notifications'
import AdminUsers from './pages/AdminUsers'
import Profile from './pages/Profile'
import RiskCenter from './pages/RiskCenter'
import Support from './pages/Support'
import TeenPatti from './pages/games/TeenPatti'
import Ludo from './pages/games/Ludo'
import Aviator from './pages/games/Aviator'
import Matka from './pages/games/Matka'
import Lottery from './pages/games/Lottery'
import Cricket from './pages/games/Cricket'
import Leaderboard from './pages/Leaderboard'
import Security from './pages/Security'
import Changelog from './pages/Changelog'
import { AIControlCenter } from './pages/AIControlCenter'
import AppMonitor from './pages/AppMonitor'
import { useAuthStore } from './store/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#d4af37', borderRadius: 8 } }}>
    <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASE || undefined}>
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
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  </ConfigProvider>
)
