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
      'success', 'warning', 'error', 'info', 'textMuted',
    ]
    for (const key of required) {
      expect(tokens.color).toHaveProperty(key)
      expect(tokens.color[key as keyof typeof tokens.color]).toMatch(HEX)
    }
  })

  it('defines the Inter font stack', () => {
    expect(tokens.font.family).toContain('Inter')
  })

  it('defines border radius tokens', () => {
    expect(tokens.radius.base).toBe(10)
    expect(tokens.radius.card).toBe(16)
  })

  it('defines card elevation shadows', () => {
    expect(tokens.shadow.card).toContain('rgba')
    expect(tokens.shadow.cardHover).toContain('rgba')
  })

  it('defines the sidebar gradient and glass header tokens', () => {
    expect(tokens.gradient.sidebar).toContain('linear-gradient')
    expect(tokens.glass.headerBg).toContain('rgba')
    expect(tokens.glass.blur).toBe('12px')
  })
})
