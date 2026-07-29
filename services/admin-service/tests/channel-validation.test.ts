import { describe, it, expect } from 'vitest'
import { validateChannelUrl } from '../src/channel-validation'

describe('validateChannelUrl', () => {
  it('accepts a valid t.me Telegram URL', () => {
    expect(validateChannelUrl('telegram', 'https://t.me/myonlinejoker_group')).toEqual({ ok: true })
  })

  it('accepts a valid telegram.me Telegram URL', () => {
    expect(validateChannelUrl('telegram', 'https://telegram.me/myonlinejoker_group')).toEqual({ ok: true })
  })

  it('rejects a non-Telegram URL for platform telegram', () => {
    const result = validateChannelUrl('telegram', 'https://wa.me/1234567890')
    expect(result.ok).toBe(false)
  })

  it('accepts a valid wa.me WhatsApp URL', () => {
    expect(validateChannelUrl('whatsapp', 'https://wa.me/1234567890')).toEqual({ ok: true })
  })

  it('accepts a valid chat.whatsapp.com WhatsApp URL', () => {
    expect(validateChannelUrl('whatsapp', 'https://chat.whatsapp.com/ABC123')).toEqual({ ok: true })
  })

  it('rejects a non-WhatsApp URL for platform whatsapp', () => {
    const result = validateChannelUrl('whatsapp', 'https://t.me/somegroup')
    expect(result.ok).toBe(false)
  })

  it('accepts any http(s) URL for platform other', () => {
    expect(validateChannelUrl('other', 'https://instagram.com/myonlinejoker')).toEqual({ ok: true })
  })

  it('rejects a non-http(s) URL for platform other', () => {
    const result = validateChannelUrl('other', 'ftp://example.com')
    expect(result.ok).toBe(false)
  })
})
