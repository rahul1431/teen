// Per-platform URL sanity check for agent-submitted marketing channels. See
// docs/superpowers/specs/2026-07-22-agent-marketing-channels-design.md

export type ChannelPlatform = 'telegram' | 'whatsapp' | 'other'

export function validateChannelUrl(
  platform: ChannelPlatform,
  url: string
): { ok: true } | { ok: false; error: string } {
  if (platform === 'telegram') {
    if (!/^https?:\/\/(t\.me|telegram\.me)\//i.test(url)) {
      return { ok: false, error: 'Telegram link must be a t.me/ or telegram.me/ URL' }
    }
  } else if (platform === 'whatsapp') {
    if (!/^https?:\/\/(wa\.me|chat\.whatsapp\.com)\//i.test(url)) {
      return { ok: false, error: 'WhatsApp link must be a wa.me/ or chat.whatsapp.com/ URL' }
    }
  } else {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Link must start with http:// or https://' }
    }
  }
  return { ok: true }
}
