import { useState, useEffect } from 'react'
import { Layout, Menu, Typography, Avatar, Dropdown, Button, Grid, Drawer, Tag, Modal, Input, Space, Tooltip } from 'antd'
import {
  UserOutlined, LogoutOutlined, ProfileOutlined, MenuOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined, SafetyCertificateOutlined,
  GlobalOutlined, ThunderboltOutlined, ArrowRightOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet, Link } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import NotificationBell from '../components/NotificationBell'
import { buildMenuItems } from './layout/menuConfig'
import { tokens } from '../theme/tokens'

const { Sider, Header, Content } = Layout

const menuItems = buildMenuItems()

// Map routes to friendly page titles for header breadcrumbs
const routeTitles: Record<string, string> = {
  '/admin': 'Dashboard & Overview',
  '/admin/users': 'Player Management',
  '/admin/admin-users': 'Admin Personnel & Permissions',
  '/admin/bots': 'AI Bot Profiles',
  '/admin/games/teen-patti': 'Teen Patti Control',
  '/admin/games/ludo': 'Ludo Rooms',
  '/admin/games/aviator': 'Aviator Crash Control',
  '/admin/games/matka': 'Satta Matka Result Engine',
  '/admin/games/lottery': 'Lottery Pools',
  '/admin/games/cricket': 'Cricket Fantasy Control',
  '/admin/games/rummy': 'Rummy Tables',
  '/admin/marketing': 'SEO & Campaigns',
  '/admin/promo-codes': 'Promo Codes & Bonus Rules',
  '/admin/banners': 'Homepage Banners',
  '/admin/marketing/cms': 'CMS & Static Content',
  '/admin/finance': 'Financial Operations & Deposits',
  '/admin/risk-center': 'Risk & Fraud Shield',
  '/admin/security': 'Security Audit & Logs',
  '/admin/kyc': 'KYC Verification Pipeline',
  '/admin/game-rooms': 'Live Active Game Rooms',
  '/admin/notifications': 'Push Notifications Broadcast',
  '/admin/notifications-history': 'Admin Alert Center',
  '/admin/leaderboard': 'Global Leaderboard',
  '/admin/missions': 'Player Missions & Rewards',
  '/admin/support': 'Support Center & Tickets',
  '/admin/ai-control': 'AI Control Center & ML Models',
  '/admin/app-update': 'Mobile App Over-the-Air Updates',
  '/admin/settings': 'Website Global Settings',
  '/admin/analytics': 'Analytics & BI Insights',
  '/admin/agents': 'Agent Network',
  '/admin/tasks': 'Background Tasks & Jobs',
  '/admin/changelog': 'System Changelog & Versions',
  '/admin/profile': 'Admin Profile & Security 2FA',
}

const quickPages = [
  { path: '/admin', title: 'Dashboard', icon: '📊' },
  { path: '/admin/users', title: 'Players List', icon: '👥' },
  { path: '/admin/finance', title: 'Finance & Wallet Log', icon: '💳' },
  { path: '/admin/risk-center', title: 'Risk & Fraud Center', icon: '🛡️' },
  { path: '/admin/game-rooms', title: 'Live Game Rooms', icon: '🎰' },
  { path: '/admin/ai-control', title: 'AI Control Center', icon: '🤖' },
  { path: '/admin/kyc', title: 'KYC Verification', icon: '🆔' },
  { path: '/admin/support', title: 'Customer Support', icon: '💬' },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { admin, logout } = useAuthStore()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.lg

  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Listen for Ctrl+K / Cmd+K to open search shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  const currentTitle = routeTitles[location.pathname] || 'Admin Console'

  const brand = (
    <div style={{
      padding: collapsed && !isMobile ? '16px 8px' : '18px 20px',
      borderBottom: `1px solid ${tokens.color.inkBorder}`,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'rgba(0,0,0,0.2)',
      justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: tokens.gradient.goldButton,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        boxShadow: tokens.shadow.gold,
        flexShrink: 0,
      }}>
        🃏
      </div>
      {(!collapsed || isMobile) && (
        <div style={{ overflow: 'hidden' }}>
          <Typography.Title level={5} style={{ color: tokens.color.gold, margin: 0, fontWeight: 800, fontSize: 16, lineHeight: 1.2, letterSpacing: -0.3 }}>
            MyOnlineJoker
          </Typography.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span className="status-pulse-green" />
            <Typography.Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11, fontWeight: 500 }}>
              Super Admin
            </Typography.Text>
          </div>
        </div>
      )}
    </div>
  )

  const nav = (
    <Menu
      theme="dark"
      mode="inline"
      inlineCollapsed={collapsed && !isMobile}
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={({ key }) => {
        if (key.startsWith('/')) {
          setDrawerOpen(false)
        }
      }}
      style={{ marginTop: 8, borderRight: 0 }}
    />
  )

  const filteredQuickPages = quickPages.filter(p =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.path.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          width={240}
          collapsedWidth={76}
          collapsible
          collapsed={collapsed}
          trigger={null}
          theme="dark"
          style={{
            position: 'fixed',
            height: '100vh',
            zIndex: 100,
            overflowY: 'auto',
            background: tokens.gradient.sidebar,
            boxShadow: '4px 0 24px rgba(0,0,0,0.15)',
          }}
        >
          {brand}
          {nav}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={260}
          closable={false}
          styles={{ body: { padding: 0, background: tokens.gradient.sidebar } }}
        >
          {brand}
          {nav}
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : (collapsed ? 76 : 240), transition: 'margin-left 0.2s ease-in-out' }}>
        <Header
          className="admin-glass-header"
          style={{
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 90,
            height: 64,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined style={{ fontSize: 18 }} />}
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
              />
            ) : (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />}
                onClick={() => setCollapsed(!collapsed)}
                aria-label="Toggle sidebar"
                style={{ color: tokens.color.textSecondary }}
              />
            )}

            {!isMobile && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Typography.Text style={{ fontSize: 16, fontWeight: 700, color: tokens.color.textPrimary, lineHeight: 1.2 }}>
                  {currentTitle}
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <Tag color="success" style={{ margin: 0, borderRadius: 10, fontSize: 10, padding: '0 8px', border: 0, background: 'rgba(16, 185, 129, 0.12)', color: '#059669', fontWeight: 600 }}>
                    🟢 Production Connected
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    game.myonlinejoker.com
                  </Typography.Text>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              type="text"
              icon={<SearchOutlined style={{ fontSize: 16, color: tokens.color.textMuted }} />}
              onClick={() => setSearchOpen(true)}
              style={{
                background: 'rgba(241, 245, 249, 0.8)',
                border: '1px solid #E2E8F0',
                borderRadius: 20,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 36,
              }}
            >
              {!isMobile && <span style={{ fontSize: 13, color: tokens.color.textMuted }}>Search routes...</span>}
              <span className="kbd-badge">⌘K</span>
            </Button>

            <NotificationBell />

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'header',
                    label: (
                      <div style={{ padding: '4px 0' }}>
                        <Typography.Text strong style={{ display: 'block' }}>{admin?.username || 'Administrator'}</Typography.Text>
                        <Tag color="gold" style={{ marginTop: 4, borderRadius: 10, fontSize: 10 }}>SUPER ADMIN</Tag>
                      </div>
                    ),
                    disabled: true,
                  },
                  { type: 'divider' },
                  {
                    key: 'profile',
                    icon: <ProfileOutlined />,
                    label: 'Profile & 2FA Security',
                    onClick: () => navigate('/admin/profile'),
                  },
                  {
                    key: 'security',
                    icon: <SafetyCertificateOutlined />,
                    label: 'Security Audit',
                    onClick: () => navigate('/admin/security'),
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined style={{ color: tokens.color.error }} />,
                    label: <span style={{ color: tokens.color.error, fontWeight: 600 }}>Logout</span>,
                    onClick: handleLogout,
                  },
                ],
              }}
              placement="bottomRight"
            >
              <Button
                type="text"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 42,
                  padding: '0 8px',
                  borderRadius: 20,
                  border: '1px solid #E2E8F0',
                  background: '#FFFFFF',
                }}
              >
                <Avatar
                  size="small"
                  icon={<UserOutlined />}
                  style={{
                    background: tokens.gradient.goldButton,
                    color: '#000000',
                    fontWeight: 'bold',
                  }}
                />
                {!isMobile && (
                  <div style={{ textAlign: 'left', lineHeight: 1.1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: tokens.color.textPrimary }}>
                      {admin?.username || 'Admin'}
                    </div>
                    <div style={{ fontSize: 10, color: tokens.color.textMuted }}>
                      Root Administrator
                    </div>
                  </div>
                )}
              </Button>
            </Dropdown>
          </div>
        </Header>

        <Content style={{ margin: isMobile ? 12 : 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>

      {/* Quick Search Modal */}
      <Modal
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
        closable={false}
        width={520}
        styles={{ body: { padding: 16 } }}
      >
        <Input
          prefix={<SearchOutlined style={{ color: tokens.color.gold, fontSize: 18 }} />}
          placeholder="Search admin pages (e.g. Users, Risk, Finance, AI Control)..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          autoFocus
          allowClear
          size="large"
          style={{ borderRadius: 12, marginBottom: 16 }}
        />

        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
            Quick Navigation
          </Typography.Text>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredQuickPages.map(page => (
              <div
                key={page.path}
                onClick={() => {
                  navigate(page.path)
                  setSearchOpen(false)
                  setSearchQuery('')
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(212, 175, 55, 0.08)'
                  e.currentTarget.style.borderColor = tokens.color.gold
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#F8FAFC'
                  e.currentTarget.style.borderColor = '#E2E8F0'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{page.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: tokens.color.textPrimary }}>{page.title}</div>
                    <div style={{ fontSize: 11, color: tokens.color.textMuted }}>{page.path}</div>
                  </div>
                </div>
                <ArrowRightOutlined style={{ color: tokens.color.gold }} />
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <style>{`
        .ant-menu-dark .ant-menu-submenu-selected > .ant-menu-submenu-title {
          background-color: rgba(212, 175, 55, 0.15) !important;
          color: #D4AF37 !important;
        }
        .ant-menu-dark .ant-menu-submenu-selected > .ant-menu-submenu-title .anticon {
          color: #D4AF37 !important;
        }
      `}</style>
    </Layout>
  )
}

