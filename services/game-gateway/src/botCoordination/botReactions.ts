import type { RealtimeHub } from '../realtime'
import { BanterEngine, BanterTriggerContext } from '../bot-persona/banter-engine'

export type BotReactionContext =
  | 'win'
  | 'bad_beat'
  | 'capture'
  | 'declare'
  | 'bluff_show'
  | 'near_miss'
  | 'table_greeting'
  | 'comeback'

const EMOJI_PALETTES: Record<BotReactionContext, string[]> = {
  win: ['😎', '🔥', '🎉', '💪', '🤑', '🏆', '🥳'],
  bad_beat: ['😅', '🙈', '💔', '🤔', '👀', '🤐'],
  capture: ['🎯', '😈', '⚡', '🚀', '💥'],
  declare: ['🃏', '✨', '🥳', '😎', '👑'],
  bluff_show: ['🤫', '😏', '🪄', '🎩'],
  near_miss: ['😱', '⚡', '⭐', '😅', '🚀'],
  table_greeting: ['👋', '🙏', '🎲', '✨', '🔥'],
  comeback: ['🔥', '💪', '⚡', '😎', '🏆'],
}

// Probability of a bot reacting (human-like, not spammy)
const REACTION_PROBABILITY: Record<BotReactionContext, number> = {
  win: 0.40,
  bad_beat: 0.30,
  capture: 0.45,
  declare: 0.50,
  bluff_show: 0.35,
  near_miss: 0.45,
  table_greeting: 0.40,
  comeback: 0.50,
}

export function pickReactionEmoji(context: BotReactionContext): string {
  const list = EMOJI_PALETTES[context] || EMOJI_PALETTES.win
  const idx = Math.floor(Math.random() * list.length)
  return list[idx]
}

export function triggerBotReaction(
  hub: RealtimeHub,
  roomId: string,
  bot: { userId: string; username: string },
  context: BotReactionContext,
  customProbability?: number
): void {
  if (!hub || !roomId || !bot?.userId) return

  // 50% of the time, bots express themselves through contextual verbal table banter!
  if (Math.random() < 0.50) {
    BanterEngine.triggerBanter(hub, roomId, bot, context as BanterTriggerContext, customProbability)
    return
  }

  const p = typeof customProbability === 'number' ? customProbability : (REACTION_PROBABILITY[context] ?? 0.35)
  if (Math.random() > p) return // Bot chooses to stay silent this round

  const emoji = pickReactionEmoji(context)
  // Cognitive delay: 800ms - 2400ms
  const delay = Math.floor(Math.random() * 1600) + 800

  setTimeout(() => {
    try {
      hub.sendToRoom(roomId, 'room:chat', {
        user_id: bot.userId,
        username: bot.username || 'Player',
        message: emoji,
        type: 'emoji',
        timestamp: Date.now(),
      })
    } catch {
      // Ignored
    }
  }, delay)
}
