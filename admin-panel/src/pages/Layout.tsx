import { Layout, Menu, Typography, Avatar, Dropdown, Button } from 'antd'
import {
  DashboardOutlined, UserOutlined, PlayCircleOutlined, DollarOutlined,
  BellOutlined, SettingOutlined, LogoutOutlined, TrophyOutlined, SafetyOutlined,
  TeamOutlined, ProfileOutlined, WarningOutlined, CustomerServiceOutlined,
  FundOutlined, RobotOutlined, HistoryOutlined, MonitorOutlined, GiftOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

const { Sider, Header, Content } = Layout

const menuItems = [
  { key: '/admin', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/admin/users', icon: <UserOutlined />, label: 'Users' },
  { key: '/admin/bots', icon: <RobotOutlined />, label: 'Bot Management' },
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
  { key: '/admin/daily-bonus', icon: <GiftOutlined />, label: 'Daily Bonus' },
  { key: '/admin/finance', icon: <DollarOutlined />, label: 'Finance' },
  { key: '/admin/notifications', icon: <BellOutlined />, label: 'Notifications' },
  { key: '/admin/admin-users', icon: <TeamOutlined />, label: 'Admin Users' },
  { key: '/admin/risk-center', icon: <WarningOutlined />, label: 'Risk Center' },
  { key: '/admin/ai-control', icon: <FundOutlined />, label: 'AI Control Center' },
  { key: '/admin/support', icon: <CustomerServiceOutlined />, label: 'Support & CMS' },
  { key: '/admin/leaderboard', icon: <TrophyOutlined />, label: 'Leaderboard' },
  { key: '/admin/security', icon: <SafetyOutlined />, label: 'Security' },
  { key: '/admin/changelog', icon: <HistoryOutlined />, label: 'Changelog' },
  { key: '/admin/app-monitor', icon: <MonitorOutlined />, label: 'App Monitor' },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { admin, logout } = useAuthStore()

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" style={{ position: 'fixed', height: '100vh', zIndex: 10 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Typography.Title level={5} style={{ color: '#d4af37', margin: 0 }}>🃏 MyOnlineJoker</Typography.Title>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Admin Panel</Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) {
              navigate(key)
            }
          }}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout style={{ marginLeft: 220 }}>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
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
        </Header>
        <Content style={{ margin: 24, minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
