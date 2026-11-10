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
  '/admin/games/sports',
  '/admin/games/rummy',
  '/admin/games/color-prediction',
  '/admin/finance',
  '/admin/marketing',
  '/admin/leads',
  '/admin/promo-codes',
  '/admin/banners',
  '/admin/popups',
  '/admin/marketing/cms',
  '/admin/risk-center',
  '/admin/security',
  '/admin/kyc',
  '/admin/game-rooms',
  '/admin/notifications',
  '/admin/notifications-history',
  '/admin/leaderboard',
  '/admin/missions',
  '/admin/support',
  '/admin/ai-company',
  '/admin/bot-arena',
  '/admin/ai-control',
  '/admin/app-controls',
  '/admin/app-update',
  '/admin/settings',
  '/admin/analytics',
  '/admin/agents',
  '/admin/agents/hierarchy',
  '/admin/agents/kyc',
  '/admin/agents/payouts',
  '/admin/agents/channels',
  '/admin/changelog',
  '/admin/server',
  '/admin/tasks',
].sort()

describe('menuConfig', () => {
  it('preserves the exact set of existing navigable route keys', () => {
    const items = buildMenuItems()
    const keys = navigableKeys(items).sort()
    expect(keys).toEqual(EXPECTED_KEYS)
  })

  it('groups items into Operations/Engagement/Platform sections with separate Finance, AI Company, Game Bots, Server, and Task Management', () => {
    const items = buildMenuItems()
    type MenuItem = NonNullable<NonNullable<ReturnType<typeof buildMenuItems>>>[number]
    const hasLabel = (item: MenuItem): item is Extract<MenuItem, { label?: unknown }> =>
      !!item && 'label' in item
    const groupLabels = (items ?? [])
      .filter(hasLabel)
      .map((item) => item!.label)
    expect(groupLabels).toContain('Operations')
    expect(groupLabels).toContain('Engagement')
    expect(groupLabels).toContain('Platform')
    expect(groupLabels).toContain('Agent Network')

    // Top-level direct menus (not nested inside Platform)
    const topLevelKeys = (items ?? []).map((i: any) => i.key)
    expect(topLevelKeys).toContain('/admin')
    expect(topLevelKeys).toContain('/admin/finance')
    expect(topLevelKeys).toContain('/admin/ai-company')
    expect(topLevelKeys).toContain('/admin/bot-arena')
    expect(topLevelKeys).toContain('/admin/server')
    expect(topLevelKeys).toContain('/admin/tasks')

    // Platform sub-items must NOT contain ai-company or bot-arena
    const platformGroup: any = (items ?? []).find((i: any) => i.key === 'platform_group')
    expect(platformGroup).toBeTruthy()
    const platformChildKeys = platformGroup.children.map((c: any) => c.key)
    expect(platformChildKeys).not.toContain('/admin/ai-company')
    expect(platformChildKeys).not.toContain('/admin/bot-arena')
    expect(platformChildKeys).toContain('/admin/ai-control')
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
