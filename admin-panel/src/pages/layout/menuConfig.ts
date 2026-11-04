// admin-panel/src/pages/layout/menuConfig.ts
//
// Note: implemented with React.createElement instead of JSX because this
// file uses the `.ts` extension (not `.tsx`), and TypeScript only permits
// JSX syntax in `.tsx` files.
import { createElement } from 'react'
import { Link } from 'react-router-dom'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined, TeamOutlined, PlayCircleOutlined, GlobalOutlined,
  ControlOutlined, ThunderboltOutlined, AppstoreOutlined,
  UserOutlined, SafetyCertificateOutlined, ExperimentOutlined,
  IdcardOutlined, BlockOutlined, RocketOutlined, NumberOutlined,
  CrownOutlined, AimOutlined, EyeOutlined,
  SoundOutlined, TagOutlined, PictureOutlined, FileTextOutlined,
  DollarOutlined, WarningOutlined, SafetyOutlined, AuditOutlined,
  BellOutlined, TrophyOutlined, CustomerServiceOutlined,
  FundOutlined, MobileOutlined, SettingOutlined, LineChartOutlined,
  RobotOutlined, ProfileOutlined, HistoryOutlined, AlertOutlined, BgColorsOutlined,
  PoweroffOutlined, CloudServerOutlined, NotificationOutlined,
} from '@ant-design/icons'

// Wraps a leaf item's label in a real <Link>, so the sidebar renders actual
// anchor tags. Without this, antd's Menu fires navigation only via a JS
// onClick — there's no href for the browser to see, so Ctrl+click/middle-click
// "open in new tab" and the right-click "open in new tab" context menu entry
// silently do nothing. Layout.tsx's Menu onClick still runs for the drawer-close
// side effect, but no longer calls navigate() itself — the Link owns routing.
function link(path: string, label: string) {
  return createElement(Link, { to: path }, label)
}

export function buildMenuItems(): MenuProps['items'] {
  return [
    { key: '/admin', icon: createElement(DashboardOutlined), label: link('/admin', 'Dashboard') },
    { key: '/admin/agents', icon: createElement(TeamOutlined), label: link('/admin/agents', 'Agents') },
    {
      key: 'user_management_group',
      icon: createElement(TeamOutlined),
      label: 'User Management',
      children: [
        { key: '/admin/users', icon: createElement(UserOutlined), label: link('/admin/users', 'Players') },
        { key: '/admin/admin-users', icon: createElement(SafetyCertificateOutlined), label: link('/admin/admin-users', 'Admin Users') },
        { key: '/admin/bots', icon: createElement(RobotOutlined), label: link('/admin/bots', 'Bot Accounts') },
      ],
    },
    {
      key: 'games_group',
      icon: createElement(PlayCircleOutlined),
      label: 'Games',
      children: [
        { key: '/admin/games/teen-patti', icon: createElement(IdcardOutlined), label: link('/admin/games/teen-patti', 'Teen Patti') },
        { key: '/admin/games/ludo', icon: createElement(BlockOutlined), label: link('/admin/games/ludo', 'Ludo') },
        { key: '/admin/games/aviator', icon: createElement(RocketOutlined), label: link('/admin/games/aviator', 'Aviator') },
        { key: '/admin/games/matka', icon: createElement(NumberOutlined), label: link('/admin/games/matka', 'Satta Matka') },
        { key: '/admin/games/lottery', icon: createElement(CrownOutlined), label: link('/admin/games/lottery', 'Lottery') },
        { key: '/admin/games/sports', icon: createElement(TrophyOutlined), label: link('/admin/games/sports', 'Sports Betting') },
        { key: '/admin/games/rummy', icon: createElement(IdcardOutlined), label: link('/admin/games/rummy', 'Rummy') },
        { key: '/admin/games/color-prediction', icon: createElement(BgColorsOutlined), label: link('/admin/games/color-prediction', 'Color Prediction') },
      ],
    },
    { key: '/admin/finance', icon: createElement(DollarOutlined), label: link('/admin/finance', 'Finance') },
    {
      key: 'marketing_group',
      icon: createElement(GlobalOutlined),
      label: 'Marketing & CMS',
      children: [
        { key: '/admin/leads', icon: createElement(TeamOutlined), label: link('/admin/leads', 'Lead Manager') },
        { key: '/admin/marketing', icon: createElement(SoundOutlined), label: link('/admin/marketing', 'SEO & Campaigns') },
        { key: '/admin/promo-codes', icon: createElement(TagOutlined), label: link('/admin/promo-codes', 'Promo Codes') },
        { key: '/admin/banners', icon: createElement(PictureOutlined), label: link('/admin/banners', 'Home Banners') },
        { key: '/admin/popups', icon: createElement(NotificationOutlined), label: link('/admin/popups', 'App Popups') },
        { key: '/admin/marketing/cms', icon: createElement(FileTextOutlined), label: link('/admin/marketing/cms', 'CMS Management') },
      ],
    },
    {
      key: 'operations_group',
      icon: createElement(ControlOutlined),
      label: 'Operations',
      children: [
        { key: '/admin/risk-center', icon: createElement(WarningOutlined), label: link('/admin/risk-center', 'Risk Center') },
        { key: '/admin/security', icon: createElement(SafetyOutlined), label: link('/admin/security', 'Security') },
        { key: '/admin/kyc', icon: createElement(AuditOutlined), label: link('/admin/kyc', 'KYC Verification') },
        { key: '/admin/game-rooms', icon: createElement(EyeOutlined), label: link('/admin/game-rooms', 'Live Game Rooms') },
      ],
    },
    {
      key: 'engagement_group',
      icon: createElement(ThunderboltOutlined),
      label: 'Engagement',
      children: [
        { key: '/admin/notifications', icon: createElement(BellOutlined), label: link('/admin/notifications', 'Notifications') },
        { key: '/admin/notifications-history', icon: createElement(AlertOutlined), label: link('/admin/notifications-history', 'Admin Alerts') },
        { key: '/admin/leaderboard', icon: createElement(TrophyOutlined), label: link('/admin/leaderboard', 'Leaderboard') },
        { key: '/admin/missions', icon: createElement(TrophyOutlined), label: link('/admin/missions', 'Missions') },
        { key: '/admin/support', icon: createElement(CustomerServiceOutlined), label: link('/admin/support', 'Support Center') },
      ],
    },
    { key: '/admin/bot-arena', icon: createElement(ThunderboltOutlined), label: link('/admin/bot-arena', 'Game Bots & AI Arena') },
    { key: '/admin/ai-company', icon: createElement(RobotOutlined), label: link('/admin/ai-company', 'AI Company') },
    {
      key: 'platform_group',
      icon: createElement(AppstoreOutlined),
      label: 'Platform',
      children: [
        { key: '/admin/ai-control', icon: createElement(FundOutlined), label: link('/admin/ai-control', 'AI Control Center') },
        { key: '/admin/app-controls', icon: createElement(PoweroffOutlined), label: link('/admin/app-controls', 'App Controls') },
        { key: '/admin/app-update', icon: createElement(MobileOutlined), label: link('/admin/app-update', 'App Update') },
        { key: '/admin/settings', icon: createElement(SettingOutlined), label: link('/admin/settings', 'Website Settings') },
        { key: '/admin/analytics', icon: createElement(LineChartOutlined), label: link('/admin/analytics', 'Analytics') },
        { key: '/admin/changelog', icon: createElement(HistoryOutlined), label: link('/admin/changelog', 'Changelog') },
      ],
    },
    { key: '/admin/server', icon: createElement(CloudServerOutlined), label: link('/admin/server', 'Server & Gateway') },
    { key: '/admin/tasks', icon: createElement(ProfileOutlined), label: link('/admin/tasks', 'Task Management') },
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
