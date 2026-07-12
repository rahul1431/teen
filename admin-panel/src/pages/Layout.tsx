import { useState } from 'react'
import { Layout, Menu, Typography, Avatar, Dropdown, Button, Grid, Drawer } from 'antd'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined, UserOutlined, PlayCircleOutlined, DollarOutlined,
  BellOutlined, LogoutOutlined, TrophyOutlined, SafetyOutlined,
  TeamOutlined, ProfileOutlined, WarningOutlined, CustomerServiceOutlined,
  FundOutlined, RobotOutlined, HistoryOutlined, GiftOutlined,
  PictureOutlined, TagOutlined, AuditOutlined, MobileOutlined,
  MenuOutlined, GlobalOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useEnvironmentStore } from '../store/environment'
import { ENVIRONMENT_CONFIGS } from '../types/environment'
import EnvironmentSwitcher from '../components/EnvironmentSwitcher'

const { Sider, Header, Content } = Layout

const menuItems: MenuProps['items'] = [
  { key: '/admin', icon: <DashboardOutlined />, label: 'Dashboard' },
  {
    key: 'user_management_group',
    icon: <TeamOutlined />,
    label: 'User Management',
    children: [
      { key: '/admin/users', label: '👥 Players' },
      { key: '/admin/admin-users', label: '🛡️ Admin Users' },
      { key: '/admin/bots', label: '🤖 Bot Profiles' },
    ]
  },
  {
    key: 'games',
    icon: <PlayCircleOutlined />,
    label: 'Games',
    children: [
      { key: '/admin/games/teen-patti', label: '🃏 Teen Patti' },
      { key: '/admin/games/ludo', label: '🎲 Ludo' },
      { key: '/admin/games/aviator', label: '✈️ Aviator' },
      { key: '/admin/games/matka', label: '🎯 Satta Matka' },
      { key: '/admin/games/lottery', label: '🎰 Lottery' },
      { key: '/admin/games/cricket', label: '🏏 Cricket' },
    ]
  },
  {
    key: 'marketing_group',
    icon: <GlobalOutlined />,
    label: 'Marketing & CMS',
    children: [
      { key: '/admin/marketing', label: '📣 SEO & Campaigns' },
      { key: '/admin/promo-codes', label: '🏷️ Promo Codes' },
      { key: '/admin/banners', label: '🖼️ Home Banners' },
      { key: '/admin/daily-bonus', label: '🎁 Daily Bonus' },
      { key: '/admin/marketing/cms', label: '📄 CMS Management' },
    ]
  },
  { key: '/admin/kyc', icon: <AuditOutlined />, label: 'KYC Verification' },
  { key: '/admin/app-update', icon: <MobileOutlined />, label: 'App Update' },
  { key: '/admin/finance', icon: <DollarOutlined />, label: 'Finance' },
  { key: '/admin/notifications', icon: <BellOutlined />, label: 'Notifications' },
  { key: '/admin/risk-center', icon: <WarningOutlined />, label: 'Risk Center' },
  { key: '/admin/ai-control', icon: <FundOutlined />, label: 'AI Control Center' },
  { key: '/admin/support', icon: <CustomerServiceOutlined />, label: 'Support Center' },
  { key: '/admin/leaderboard', icon: <TrophyOutlined />, label: 'Leaderboard' },
  { key: '/admin/security', icon: <SafetyOutlined />, label: 'Security' },
  // App Monitor and Player Tracking live inside the AI Control Center tabs.
  { key: '/admin/changelog', icon: <HistoryOutlined />, label: 'Changelog' },
  { type: 'divider' },
  { key: '/admin/dev-admin', icon: <WarningOutlined />, label: '⚠️ Dev Admin Panel', danger: true },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { admin, logout } = useAuthStore()
  const { currentEnv } = useEnvironmentStore()
  const envConfig = ENVIRONMENT_CONFIGS[currentEnv]
  const screens = Grid.useBreakpoint()
  // Below Ant's `lg` (992px) the fixed sidebar is swapped for a slide-in drawer.
  const isMobile = !screens.lg
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  const brand = (
    <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
      <Typography.Title level={5} style={{ color: '#d4af37', margin: 0 }}>🃏 MyOnlineJoker</Typography.Title>
      <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Admin Panel</Typography.Text>
    </div>
  )

  const nav = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={({ key }) => {
        if (key.startsWith('/')) {
          navigate(key)
          setDrawerOpen(false)
        }
      }}
      style={{ marginTop: 8, borderRight: 0 }}
    />
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider width={220} theme="dark" style={{ position: 'fixed', height: '100vh', zIndex: 10, overflowY: 'auto' }}>
          {brand}
          {nav}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={240}
          closable={false}
          styles={{ body: { padding: 0, background: '#001529' } }}
        >
          {brand}
          {nav}
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : 220 }}>
        <Header
          style={{
            background: `linear-gradient(to bottom, #fff 0%, ${envConfig.bgColor} 100%)`,
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            position: 'sticky',
            top: 0,
            zIndex: 9,
          }}
        >
          {isMobile ? (
            <Button
              type="text"
              icon={<MenuOutlined style={{ fontSize: 18 }} />}
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            />
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <EnvironmentSwitcher />
            <Dropdown menu={{ items: [
              { key: 'profile', icon: <ProfileOutlined />, label: 'Profile & 2FA', onClick: () => navigate('/admin/profile') },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
            ] }}>
              <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: '#d4af37' }} />
                <span>{admin?.username}</span>
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content style={{ margin: isMobile ? 12 : 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
