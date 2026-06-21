import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import Login from './pages/Login'
import AdminLayout from './pages/Layout'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import GameRooms from './pages/GameRooms'
import Finance from './pages/Finance'
import Notifications from './pages/Notifications'
import GameConfig from './pages/GameConfig'
import AdminUsers from './pages/AdminUsers'
import Profile from './pages/Profile'
import RiskCenter from './pages/RiskCenter'
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
          <Route path="game-rooms" element={<GameRooms />} />
          <Route path="finance" element={<Finance />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="game-config" element={<GameConfig />} />
          <Route path="admin-users" element={<AdminUsers />} />
          <Route path="profile" element={<Profile />} />
          <Route path="risk-center" element={<RiskCenter />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  </ConfigProvider>
)
