// admin-panel/src/pages/layout/menuConfig.ts
//
// Note: implemented with React.createElement instead of JSX because this
// file uses the `.ts` extension (not `.tsx`), and TypeScript only permits
// JSX syntax in `.tsx` files.
import { createElement } from 'react'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined, TeamOutlined, PlayCircleOutlined, GlobalOutlined,
  ControlOutlined, ThunderboltOutlined, AppstoreOutlined,
  UserOutlined, SafetyCertificateOutlined, ExperimentOutlined,
  IdcardOutlined, BlockOutlined, RocketOutlined, NumberOutlined,
  CrownOutlined, AimOutlined,
  SoundOutlined, TagOutlined, PictureOutlined, GiftOutlined, FileTextOutlined,
  DollarOutlined, WarningOutlined, SafetyOutlined, AuditOutlined,
  BellOutlined, TrophyOutlined, CustomerServiceOutlined,
  FundOutlined, MobileOutlined, SettingOutlined, LineChartOutlined,
  RobotOutlined, ProfileOutlined, HistoryOutlined,
} from '@ant-design/icons'

// Regroups the panel's existing 29 route keys into clearer top-level
// sections. This function must never add, remove, or rename a route key —
// see menuConfig.test.ts for the locked set.
export function buildMenuItems(): MenuProps['items'] {
  return [
    { key: '/admin', icon: createElement(DashboardOutlined), label: 'Dashboard' },
    {
      key: 'user_management_group',
      icon: createElement(TeamOutlined),
      label: 'User Management',
      children: [
        { key: '/admin/users', icon: createElement(UserOutlined), label: 'Players' },
        { key: '/admin/admin-users', icon: createElement(SafetyCertificateOutlined), label: 'Admin Users' },
        { key: '/admin/bots', icon: createElement(ExperimentOutlined), label: 'Bot Profiles' },
      ],
    },
    {
      key: 'games_group',
      icon: createElement(PlayCircleOutlined),
      label: 'Games',
      children: [
        { key: '/admin/games/teen-patti', icon: createElement(IdcardOutlined), label: 'Teen Patti' },
        { key: '/admin/games/ludo', icon: createElement(BlockOutlined), label: 'Ludo' },
        { key: '/admin/games/aviator', icon: createElement(RocketOutlined), label: 'Aviator' },
        { key: '/admin/games/matka', icon: createElement(NumberOutlined), label: 'Satta Matka' },
        { key: '/admin/games/lottery', icon: createElement(CrownOutlined), label: 'Lottery' },
        { key: '/admin/games/cricket', icon: createElement(AimOutlined), label: 'Cricket' },
      ],
    },
    {
      key: 'marketing_group',
      icon: createElement(GlobalOutlined),
      label: 'Marketing & CMS',
      children: [
        { key: '/admin/marketing', icon: createElement(SoundOutlined), label: 'SEO & Campaigns' },
        { key: '/admin/promo-codes', icon: createElement(TagOutlined), label: 'Promo Codes' },
        { key: '/admin/banners', icon: createElement(PictureOutlined), label: 'Home Banners' },
        { key: '/admin/daily-bonus', icon: createElement(GiftOutlined), label: 'Daily Bonus' },
        { key: '/admin/marketing/cms', icon: createElement(FileTextOutlined), label: 'CMS Management' },
      ],
    },
    {
      key: 'operations_group',
      icon: createElement(ControlOutlined),
      label: 'Operations',
      children: [
        { key: '/admin/finance', icon: createElement(DollarOutlined), label: 'Finance' },
        { key: '/admin/risk-center', icon: createElement(WarningOutlined), label: 'Risk Center' },
        { key: '/admin/security', icon: createElement(SafetyOutlined), label: 'Security' },
        { key: '/admin/kyc', icon: createElement(AuditOutlined), label: 'KYC Verification' },
      ],
    },
    {
      key: 'engagement_group',
      icon: createElement(ThunderboltOutlined),
      label: 'Engagement',
      children: [
        { key: '/admin/notifications', icon: createElement(BellOutlined), label: 'Notifications' },
        { key: '/admin/leaderboard', icon: createElement(TrophyOutlined), label: 'Leaderboard' },
        { key: '/admin/support', icon: createElement(CustomerServiceOutlined), label: 'Support Center' },
      ],
    },
    {
      key: 'platform_group',
      icon: createElement(AppstoreOutlined),
      label: 'Platform',
      children: [
        { key: '/admin/ai-control', icon: createElement(FundOutlined), label: 'AI Control Center' },
        { key: '/admin/app-update', icon: createElement(MobileOutlined), label: 'App Update' },
        { key: '/admin/settings', icon: createElement(SettingOutlined), label: 'Website Settings' },
        { key: '/admin/analytics', icon: createElement(LineChartOutlined), label: 'Analytics' },
        { key: '/admin/agents', icon: createElement(RobotOutlined), label: 'Agents' },
        { key: '/admin/tasks', icon: createElement(ProfileOutlined), label: 'Tasks' },
        { key: '/admin/changelog', icon: createElement(HistoryOutlined), label: 'Changelog' },
      ],
    },
  ]
}

// Flattens a Menu items tree to the leaf keys that are actual routes
// (i.e. start with '/'). Group keys like 'games_group' are excluded.
export function navigableKeys(items: MenuProps['items']): string[] {
  const keys: string[] = []
  const walk = (list: MenuProps['items']) => {
    for (const item of list ?? []) {
      if (!item) continue
      if ('children' in item && item.children) {
        walk(item.children as MenuProps['items'])
      } else if ('key' in item && typeof item.key === 'string' && item.key.startsWith('/')) {
        keys.push(item.key)
      }
    }
  }
  walk(items)
  return keys
}
