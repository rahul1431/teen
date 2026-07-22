import { useState } from 'react'
import { Layout, Menu, Typography, Avatar, Dropdown, Button, Grid, Drawer } from 'antd'
import {
  UserOutlined, LogoutOutlined, ProfileOutlined, MenuOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import NotificationBell from '../components/NotificationBell'
import { buildMenuItems } from './layout/menuConfig'
import { tokens } from '../theme/tokens'

const { Sider, Header, Content } = Layout

const menuItems = buildMenuItems()

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { admin, logout } = useAuthStore()
  const screens = Grid.useBreakpoint()
  // Below Ant's `lg` (992px) the fixed sidebar is swapped for a slide-in drawer.
  const isMobile = !screens.lg
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  const brand = (
    <div style={{ padding: '18px 24px', borderBottom: `1px solid ${tokens.color.inkBorder}` }}>
      <Typography.Title level={5} style={{ color: tokens.color.gold, margin: 0, fontWeight: 700 }}>🃏 MyOnlineJoker</Typography.Title>
      <Typography.Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Admin Panel</Typography.Text>
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
        <Sider width={220} theme="dark" style={{ position: 'fixed', height: '100vh', zIndex: 10, overflowY: 'auto', background: tokens.gradient.sidebar }}>
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
          styles={{ body: { padding: 0, background: tokens.gradient.sidebar } }}
        >
          {brand}
          {nav}
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : 220 }}>
        <Header
          className="admin-glass-header"
          style={{
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
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
            <NotificationBell />
            <Dropdown menu={{ items: [
              { key: 'profile', icon: <ProfileOutlined />, label: 'Profile & 2FA', onClick: () => navigate('/admin/profile') },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
            ] }}>
              <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ background: tokens.color.gold }} />
                <span>{admin?.username}</span>
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content style={{ margin: isMobile ? 12 : 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>

      <style>{`
        .ant-menu-dark .ant-menu-submenu-selected > .ant-menu-submenu-title {
          background-color: #d4af37 !important;
          color: #000 !important;
        }
        .ant-menu-dark .ant-menu-submenu-selected > .ant-menu-submenu-title .anticon {
          color: #000 !important;
        }
      `}</style>
    </Layout>
  )
}
