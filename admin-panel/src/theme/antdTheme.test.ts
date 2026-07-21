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

  it('gives Card real elevation instead of a flat border', () => {
    expect(antdTheme.components?.Card?.borderRadiusLG).toBe(tokens.radius.card)
    expect(antdTheme.components?.Card?.boxShadowTertiary).toBe(tokens.shadow.card)
  })
})
