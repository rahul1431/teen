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
