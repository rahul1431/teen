# Admin Panel UI Redesign — Phase 1: Foundation + Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared design-token foundation and redesign the admin panel shell (`Layout.tsx` sidebar/header/navigation), so every subsequent page-batch inherits consistent theming without per-page rewrites.

**Architecture:** A pure-data token module (`src/theme/tokens.ts`) feeds an Ant Design v5 `ConfigProvider` theme builder (`src/theme/antdTheme.ts`), wired into `main.tsx`. Sidebar navigation moves from an inline array in `Layout.tsx` into a pure function (`src/pages/layout/menuConfig.ts`) that regroups the *existing* 29 route keys into new sections — a snapshot test locks that the set of navigable route keys is byte-for-byte unchanged, since this phase must not alter any route or behavior.

**Tech Stack:** React 18, Vite, Ant Design v5 (`antd`, `@ant-design/icons`), TypeScript, Vitest + jsdom (existing test setup, no new dependencies).

## Global Constraints

- No route path changes — every `/admin/...` path in `main.tsx` stays identical.
- No behavior/logic changes to any page — this phase touches only `theme/`, `Layout.tsx`, `main.tsx`, `index.html`, `index.css`.
- No new npm dependencies — use `antd`, `@ant-design/icons`, and the existing Vitest setup only.
- Brand accent gold `#D4AF37` is retained (evolved, not replaced) per the approved spec.
- Locked-feature pages (Teen Patti/Ludo/Aviator/Lottery, App Update, KYC, AI Control Center) are in scope for this shell/nav work since it changes no route or logic — see `docs/superpowers/specs/2026-07-21-admin-panel-ui-redesign-design.md`.

---

## File Structure

- Create: `admin-panel/src/theme/tokens.ts` — primitive + semantic design tokens (colors, font, radius).
- Create: `admin-panel/src/theme/tokens.test.ts` — validates token shape/format.
- Create: `admin-panel/src/theme/antdTheme.ts` — builds the antd `ThemeConfig` object from tokens.
- Create: `admin-panel/src/theme/antdTheme.test.ts` — validates the built theme config.
- Create: `admin-panel/src/pages/layout/menuConfig.ts` — pure function building the regrouped `Menu` items.
- Create: `admin-panel/src/pages/layout/menuConfig.test.ts` — locks the navigable route-key set.
- Modify: `admin-panel/src/main.tsx` — use `antdTheme` instead of the inline theme object.
- Modify: `admin-panel/src/pages/Layout.tsx` — use `menuConfig`, restyle sider/header.
- Modify: `admin-panel/index.html` — load Inter from Google Fonts.
- Modify: `admin-panel/src/index.css` — base `font-family`.

---

### Task 1: Design tokens module

**Files:**
- Create: `admin-panel/src/theme/tokens.ts`
- Test: `admin-panel/src/theme/tokens.test.ts`

**Interfaces:**
- Produces: `export const tokens = { color: {...}, font: {...}, radius: {...} }` — a plain object, `color.*` values are `#RRGGBB` hex strings, consumed by Task 2 (`antdTheme.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// admin-panel/src/theme/tokens.test.ts
import { describe, it, expect } from 'vitest'
import { tokens } from './tokens'

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('tokens', () => {
  it('defines all required color tokens as valid 6-digit hex', () => {
    const required = [
      'gold', 'goldHover', 'goldActive',
      'inkBase', 'inkRaised', 'inkBorder',
      'bgLayout', 'bgCard',
      'textOnDark', 'textOnDarkMuted',
      'success', 'warning', 'error', 'info',
    ]
    for (const key of required) {
      expect(tokens.color).toHaveProperty(key)
      expect(tokens.color[key as keyof typeof tokens.color]).toMatch(HEX)
    }
  })

  it('defines the Inter font stack', () => {
    expect(tokens.font.family).toContain('Inter')
  })

  it('defines a border radius token', () => {
    expect(tokens.radius.base).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run src/theme/tokens.test.ts`
Expected: FAIL with "Cannot find module './tokens'"

- [ ] **Step 3: Write the implementation**

```typescript
// admin-panel/src/theme/tokens.ts
// Design tokens for the admin panel redesign. Single source of truth,
// consumed by antdTheme.ts (ConfigProvider) and any component needing
// a raw value outside antd's token system (e.g. inline sidebar styles).

export const tokens = {
  color: {
    // Brand gold — kept from the existing brand identity, not replaced.
    gold: '#D4AF37',
    goldHover: '#E4C558',
    goldActive: '#B4922A',

    // Warm near-black sidebar surfaces, replacing the flat navy (#001529).
    inkBase: '#14110D',
    inkRaised: '#1D1811',
    inkBorder: '#2A231A',

    // Content-area surfaces.
    bgLayout: '#F7F5F1',
    bgCard: '#FFFFFF',

    // Text on dark (sidebar) surfaces.
    textOnDark: '#EDE9E2',
    textOnDarkMuted: '#8C8579',

    // Semantic status colors, WCAG-AA on both light and dark surfaces.
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    info: '#2563EB',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: {
    base: 10,
  },
} as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run src/theme/tokens.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/theme/tokens.ts admin-panel/src/theme/tokens.test.ts
git commit -m "feat(admin-panel): add design token module for UI redesign"
```

---

### Task 2: Ant Design theme builder

**Files:**
- Create: `admin-panel/src/theme/antdTheme.ts`
- Test: `admin-panel/src/theme/antdTheme.test.ts`

**Interfaces:**
- Consumes: `tokens` from `./tokens` (Task 1).
- Produces: `export const antdTheme: ThemeConfig` — passed directly to antd's `<ConfigProvider theme={antdTheme}>` in `main.tsx` (Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// admin-panel/src/theme/antdTheme.test.ts
import { describe, it, expect } from 'vitest'
import { antdTheme } from './antdTheme'
import { tokens } from './tokens'

describe('antdTheme', () => {
  it('sets the seed token colors from tokens.ts', () => {
    expect(antdTheme.token?.colorPrimary).toBe(tokens.color.gold)
    expect(antdTheme.token?.colorSuccess).toBe(tokens.color.success)
    expect(antdTheme.token?.colorWarning).toBe(tokens.color.warning)
    expect(antdTheme.token?.colorError).toBe(tokens.color.error)
    expect(antdTheme.token?.colorInfo).toBe(tokens.color.info)
  })

  it('sets font family and border radius', () => {
    expect(antdTheme.token?.fontFamily).toBe(tokens.font.family)
    expect(antdTheme.token?.borderRadius).toBe(tokens.radius.base)
  })

  it('sets Layout component sider/header surfaces', () => {
    expect(antdTheme.components?.Layout?.siderBg).toBe(tokens.color.inkBase)
    expect(antdTheme.components?.Layout?.headerBg).toBe(tokens.color.bgCard)
    expect(antdTheme.components?.Layout?.bodyBg).toBe(tokens.color.bgLayout)
  })

  it('sets dark Menu component surfaces distinct from the flat default', () => {
    expect(antdTheme.components?.Menu?.darkItemBg).toBe('transparent')
    expect(antdTheme.components?.Menu?.darkItemSelectedBg).toBe(tokens.color.goldActive)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run src/theme/antdTheme.test.ts`
Expected: FAIL with "Cannot find module './antdTheme'"

- [ ] **Step 3: Write the implementation**

```typescript
// admin-panel/src/theme/antdTheme.ts
import { theme, type ThemeConfig } from 'antd'
import { tokens } from './tokens'

export const antdTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: tokens.color.gold,
    colorSuccess: tokens.color.success,
    colorWarning: tokens.color.warning,
    colorError: tokens.color.error,
    colorInfo: tokens.color.info,
    colorBgLayout: tokens.color.bgLayout,
    fontFamily: tokens.font.family,
    borderRadius: tokens.radius.base,
  },
  components: {
    Layout: {
      siderBg: tokens.color.inkBase,
      headerBg: tokens.color.bgCard,
      bodyBg: tokens.color.bgLayout,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemColor: tokens.color.textOnDark,
      darkItemHoverColor: tokens.color.gold,
      darkItemSelectedBg: tokens.color.goldActive,
      darkItemSelectedColor: tokens.color.inkBase,
      darkSubMenuItemBg: 'transparent',
    },
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run src/theme/antdTheme.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/theme/antdTheme.ts admin-panel/src/theme/antdTheme.test.ts
git commit -m "feat(admin-panel): add antd ConfigProvider theme builder"
```

---

### Task 3: Wire the new theme + Inter font into the app shell

**Files:**
- Modify: `admin-panel/index.html`
- Modify: `admin-panel/src/main.tsx:1-5,63`
- Modify: `admin-panel/src/index.css:1-6`

**Interfaces:**
- Consumes: `antdTheme` from `./theme/antdTheme` (Task 2).

- [ ] **Step 1: Add Inter font loading to `index.html`**

Edit `admin-panel/index.html`, adding font preconnect/link tags inside `<head>` after the existing `<link rel="icon" ...>` line:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Set base font-family in `index.css`**

Add to the top of `admin-panel/src/index.css` (before the existing `html, body, #root` rule):

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

- [ ] **Step 3: Replace the inline theme object in `main.tsx`**

In `admin-panel/src/main.tsx`, change the import on line 4 from:

```typescript
import { ConfigProvider, theme } from 'antd'
```

to:

```typescript
import { ConfigProvider } from 'antd'
import { antdTheme } from './theme/antdTheme'
```

Then change line 63 from:

```typescript
  <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#d4af37', borderRadius: 8 } }}>
```

to:

```typescript
  <ConfigProvider theme={antdTheme}>
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual visual check**

Run: `cd admin-panel && npm run dev`, open the printed local URL, log in, and confirm:
- Page renders without console errors
- Body text now renders in Inter (compare via browser devtools computed font-family)
- Sidebar is now a warm near-black instead of navy, gold accent still present

- [ ] **Step 6: Commit**

```bash
git add admin-panel/index.html admin-panel/src/index.css admin-panel/src/main.tsx
git commit -m "feat(admin-panel): wire new design tokens and Inter font into app shell"
```

---

### Task 4: Regrouped navigation menu config

**Files:**
- Create: `admin-panel/src/pages/layout/menuConfig.ts`
- Test: `admin-panel/src/pages/layout/menuConfig.test.ts`

**Interfaces:**
- Produces: `export function buildMenuItems(): MenuProps['items']` — consumed by `Layout.tsx` (Task 5) in place of its current inline `menuItems` array.
- Produces (test-only helper, exported for the regression test): `export function navigableKeys(items: MenuProps['items']): string[]` — flattens a `Menu` items tree to the list of leaf `key`s that start with `/`.

**Existing route keys this task MUST preserve exactly** (from the current `admin-panel/src/pages/Layout.tsx` `menuItems` array — do not add, remove, or rename any of these):

```
/admin
/admin/users
/admin/admin-users
/admin/bots
/admin/games/teen-patti
/admin/games/ludo
/admin/games/aviator
/admin/games/matka
/admin/games/lottery
/admin/games/cricket
/admin/marketing
/admin/promo-codes
/admin/banners
/admin/daily-bonus
/admin/marketing/cms
/admin/kyc
/admin/app-update
/admin/finance
/admin/notifications
/admin/risk-center
/admin/ai-control
/admin/support
/admin/leaderboard
/admin/security
/admin/settings
/admin/tasks
/admin/agents
/admin/analytics
/admin/changelog
```

- [ ] **Step 1: Write the failing test**

```typescript
// admin-panel/src/pages/layout/menuConfig.test.ts
import { describe, it, expect } from 'vitest'
import { buildMenuItems, navigableKeys } from './menuConfig'

const EXPECTED_KEYS = [
  '/admin',
  '/admin/users',
  '/admin/admin-users',
  '/admin/bots',
  '/admin/games/teen-patti',
  '/admin/games/ludo',
  '/admin/games/aviator',
  '/admin/games/matka',
  '/admin/games/lottery',
  '/admin/games/cricket',
  '/admin/marketing',
  '/admin/promo-codes',
  '/admin/banners',
  '/admin/daily-bonus',
  '/admin/marketing/cms',
  '/admin/kyc',
  '/admin/app-update',
  '/admin/finance',
  '/admin/notifications',
  '/admin/risk-center',
  '/admin/ai-control',
  '/admin/support',
  '/admin/leaderboard',
  '/admin/security',
  '/admin/settings',
  '/admin/tasks',
  '/admin/agents',
  '/admin/analytics',
  '/admin/changelog',
].sort()

describe('menuConfig', () => {
  it('preserves the exact set of existing navigable route keys', () => {
    const items = buildMenuItems()
    const keys = navigableKeys(items).sort()
    expect(keys).toEqual(EXPECTED_KEYS)
  })

  it('groups items into the new Operations/Engagement/Platform sections', () => {
    const items = buildMenuItems()
    const groupLabels = (items ?? [])
      .filter((item): item is Extract<typeof item, { label: unknown }> => !!item && 'label' in item)
      .map((item) => item!.label)
    expect(groupLabels).toContain('Operations')
    expect(groupLabels).toContain('Engagement')
    expect(groupLabels).toContain('Platform')
  })

  it('every leaf item has an icon (no bare emoji-prefixed labels)', () => {
    const items = buildMenuItems()
    const leaves: any[] = []
    const walk = (list: any[]) => {
      for (const item of list) {
        if (!item) continue
        if (item.children) walk(item.children)
        else leaves.push(item)
      }
    }
    walk(items as any[])
    for (const leaf of leaves) {
      expect(leaf.icon).toBeTruthy()
      expect(String(leaf.label)).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin-panel && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: FAIL with "Cannot find module './menuConfig'"

- [ ] **Step 3: Write the implementation**

```typescript
// admin-panel/src/pages/layout/menuConfig.ts
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
    { key: '/admin', icon: <DashboardOutlined />, label: 'Dashboard' },
    {
      key: 'user_management_group',
      icon: <TeamOutlined />,
      label: 'User Management',
      children: [
        { key: '/admin/users', icon: <UserOutlined />, label: 'Players' },
        { key: '/admin/admin-users', icon: <SafetyCertificateOutlined />, label: 'Admin Users' },
        { key: '/admin/bots', icon: <ExperimentOutlined />, label: 'Bot Profiles' },
      ],
    },
    {
      key: 'games_group',
      icon: <PlayCircleOutlined />,
      label: 'Games',
      children: [
        { key: '/admin/games/teen-patti', icon: <IdcardOutlined />, label: 'Teen Patti' },
        { key: '/admin/games/ludo', icon: <BlockOutlined />, label: 'Ludo' },
        { key: '/admin/games/aviator', icon: <RocketOutlined />, label: 'Aviator' },
        { key: '/admin/games/matka', icon: <NumberOutlined />, label: 'Satta Matka' },
        { key: '/admin/games/lottery', icon: <CrownOutlined />, label: 'Lottery' },
        { key: '/admin/games/cricket', icon: <AimOutlined />, label: 'Cricket' },
      ],
    },
    {
      key: 'marketing_group',
      icon: <GlobalOutlined />,
      label: 'Marketing & CMS',
      children: [
        { key: '/admin/marketing', icon: <SoundOutlined />, label: 'SEO & Campaigns' },
        { key: '/admin/promo-codes', icon: <TagOutlined />, label: 'Promo Codes' },
        { key: '/admin/banners', icon: <PictureOutlined />, label: 'Home Banners' },
        { key: '/admin/daily-bonus', icon: <GiftOutlined />, label: 'Daily Bonus' },
        { key: '/admin/marketing/cms', icon: <FileTextOutlined />, label: 'CMS Management' },
      ],
    },
    {
      key: 'operations_group',
      icon: <ControlOutlined />,
      label: 'Operations',
      children: [
        { key: '/admin/finance', icon: <DollarOutlined />, label: 'Finance' },
        { key: '/admin/risk-center', icon: <WarningOutlined />, label: 'Risk Center' },
        { key: '/admin/security', icon: <SafetyOutlined />, label: 'Security' },
        { key: '/admin/kyc', icon: <AuditOutlined />, label: 'KYC Verification' },
      ],
    },
    {
      key: 'engagement_group',
      icon: <ThunderboltOutlined />,
      label: 'Engagement',
      children: [
        { key: '/admin/notifications', icon: <BellOutlined />, label: 'Notifications' },
        { key: '/admin/leaderboard', icon: <TrophyOutlined />, label: 'Leaderboard' },
        { key: '/admin/support', icon: <CustomerServiceOutlined />, label: 'Support Center' },
      ],
    },
    {
      key: 'platform_group',
      icon: <AppstoreOutlined />,
      label: 'Platform',
      children: [
        { key: '/admin/ai-control', icon: <FundOutlined />, label: 'AI Control Center' },
        { key: '/admin/app-update', icon: <MobileOutlined />, label: 'App Update' },
        { key: '/admin/settings', icon: <SettingOutlined />, label: 'Website Settings' },
        { key: '/admin/analytics', icon: <LineChartOutlined />, label: 'Analytics' },
        { key: '/admin/agents', icon: <RobotOutlined />, label: 'Agents' },
        { key: '/admin/tasks', icon: <ProfileOutlined />, label: 'Tasks' },
        { key: '/admin/changelog', icon: <HistoryOutlined />, label: 'Changelog' },
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin-panel && npx vitest run src/pages/layout/menuConfig.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/layout/menuConfig.ts admin-panel/src/pages/layout/menuConfig.test.ts
git commit -m "feat(admin-panel): add regrouped nav menu config with route-key regression test"
```

---

### Task 5: Integrate the new menu config and restyle the shell

**Files:**
- Modify: `admin-panel/src/pages/Layout.tsx`

**Interfaces:**
- Consumes: `buildMenuItems` from `./layout/menuConfig` (Task 4), `tokens` from `../theme/tokens` (Task 1).

- [ ] **Step 1: Replace the icon imports and inline `menuItems` array**

In `admin-panel/src/pages/Layout.tsx`, replace lines 1–70 (imports through the `menuItems` array) with:

```typescript
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
```

(This drops every icon import that moved into `menuConfig.ts`, keeping only the four still used directly in `Layout.tsx`: `UserOutlined` for the avatar, `LogoutOutlined`/`ProfileOutlined` for the dropdown, `MenuOutlined` for the mobile drawer toggle.)

- [ ] **Step 2: Restyle the brand header block**

Replace the `brand` block (previously around line 86-91) with:

```typescript
  const brand = (
    <div style={{ padding: '18px 24px', borderBottom: `1px solid ${tokens.color.inkBorder}` }}>
      <Typography.Title level={5} style={{ color: tokens.color.gold, margin: 0, fontWeight: 700 }}>🃏 MyOnlineJoker</Typography.Title>
      <Typography.Text style={{ color: tokens.color.textOnDarkMuted, fontSize: 11 }}>Admin Panel</Typography.Text>
    </div>
  )
```

- [ ] **Step 3: Update the Sider/Drawer background to the new ink token**

Replace `theme="dark"` `Sider` block's inline background: find

```typescript
        <Sider width={220} theme="dark" style={{ position: 'fixed', height: '100vh', zIndex: 10, overflowY: 'auto' }}>
```

and the `Drawer` `styles={{ body: { padding: 0, background: '#001529' } }}` line, replacing both `#001529` references with `tokens.color.inkBase`:

```typescript
        <Sider width={220} theme="dark" style={{ position: 'fixed', height: '100vh', zIndex: 10, overflowY: 'auto', background: tokens.color.inkBase }}>
```

```typescript
          styles={{ body: { padding: 0, background: tokens.color.inkBase } }}
```

- [ ] **Step 4: Verify the build compiles and app renders**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors

Run: `cd admin-panel && npm run dev`, open the app, log in, and manually verify:
- Sidebar shows 7 groups in order: Dashboard, User Management, Games, Marketing & CMS, Operations, Engagement, Platform
- Every submenu item has an icon and no emoji in its label
- Clicking each of the 29 nav items still navigates to the same page as before (spot-check at least one item per group)
- Mobile drawer (resize below ~992px) opens/closes and shows the same regrouped menu
- No console errors

- [ ] **Step 5: Run the full test suite**

Run: `cd admin-panel && npx vitest run`
Expected: all tests pass (existing 2 test files + 3 new ones from Tasks 1, 2, 4)

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/pages/Layout.tsx
git commit -m "feat(admin-panel): integrate regrouped nav menu and restyle shell with design tokens"
```

---

## Self-Review Notes

- **Spec coverage:** Theme token foundation (Task 1-2), shell wiring incl. Inter font (Task 3), sidebar/header reskin + emoji→icon replacement + nav regroup (Task 4-5) — all map to spec sections 1-3. Component-pattern standardization (spec section 4) and page-by-page rollout (spec section 5) are explicitly out of scope for this phase and will be separate plans per the spec's phasing.
- **Placeholder scan:** none found — every step has real code/commands.
- **Type consistency:** `buildMenuItems(): MenuProps['items']` (Task 4) matches its consumption in `Layout.tsx` (Task 5, `const menuItems = buildMenuItems()`, same as the original inline `MenuProps['items']`-typed array). `tokens.color.*` keys used in Task 5 (`inkBorder`, `gold`, `textOnDarkMuted`, `inkBase`) all match keys defined in Task 1.

## Next Phases

Once this phase is reviewed and merged, each subsequent batch from the spec's Delivery Phasing (Dashboard+Analytics, User Management pages, Games pages, Marketing & CMS pages, Operations pages, Engagement pages, Platform pages, Auth/standalone pages) gets its own implementation plan following this same task structure, consuming `tokens.ts` / `antdTheme.ts` from this phase.
