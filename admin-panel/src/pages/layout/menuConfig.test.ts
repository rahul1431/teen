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
  '/admin/marketing/cms',
  '/admin/kyc',
  '/admin/app-update',
  '/admin/finance',
  '/admin/notifications',
  '/admin/notifications-history',
  '/admin/risk-center',
  '/admin/game-rooms',
  '/admin/ai-control',
  '/admin/support',
  '/admin/leaderboard',
  '/admin/missions',
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
    type MenuItem = NonNullable<NonNullable<ReturnType<typeof buildMenuItems>>>[number]
    const hasLabel = (item: MenuItem): item is Extract<MenuItem, { label?: unknown }> =>
      !!item && 'label' in item
    const groupLabels = (items ?? [])
      .filter(hasLabel)
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
