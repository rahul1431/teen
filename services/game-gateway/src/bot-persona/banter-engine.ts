import type { RealtimeHub } from '../realtime'

export type BanterTriggerContext =
  | 'win'
  | 'bad_beat'
  | 'near_miss'
  | 'capture'
  | 'declare'
  | 'bluff_show'
  | 'table_greeting'
  | 'comeback'

export type BotPersonality =
  | 'witty_chatter'
  | 'cool_grinder'
  | 'hype_beast'
  | 'calm_veteran'

export interface BotPersona {
  userId: string
  username: string
  personality: BotPersonality
}

// Culturally authentic dialogues tailored to Indian gaming culture (Hinglish & English)
const BANTER_LINES: Record<BanterTriggerContext, string[]> = {
  win: [
    'Table mera hai aaj! 😎💰',
    'Bada pot, maza aa gaya! 🔥',
    'GG guys! Well played! 🏆',
    'Kismat aur dimag dono sath hain aaj! 💪',
    'Kya card aye the yaar! 🃏✨',
    'Pocket me chala gaya pot! 🤑',
    'Chalo ek aur game ho jaye? 🥳',
  ],
  bad_beat: [
    'Arre yaar, last card ne dhoka de diya 😅',
    'Bach gaye bhai, pure sequence ready tha mera 💔',
    'Nice bluff yaar, pakad nahi paya 👀',
    'Bhai kya kismat hai teri! 🙈',
    'Koi nahi, next round dekhte hain! 😤',
    'Thoda sa reh gaya yaar... 🤐',
  ],
  near_miss: [
    'Oof! Baal baal bache! ⚡',
    'Dil ki dhadkan badh gayi thi bhai! 😱',
    'Safe star zindabad! Bach gaya! ⭐',
    'Close call! Miracle escape ho gaya! 🚀',
    'Kismat ne bacha liya is baar! 😅',
  ],
  capture: [
    'Gotcha! Seedha base wapas! 🎯',
    'Sorry bhai, raste me aa gaye the! 😈⚡',
    'Target locked & executed! 💥',
    'Boom! Nice catch! 🚀',
  ],
  declare: [
    'Showdown! Game finished! 🃏👑',
    'Pure sequence locked! GG! ✨',
    'Done deal! Badhai ho! 🥳',
    'Clean declare! Maza aaya! 😎',
  ],
  bluff_show: [
    'Caught you! Pakad liya! 🤫🎩',
    'Chaal samajh aa gayi thi bhai! 😏',
    'Risk liya par reward mil gaya! 🪄',
  ],
  table_greeting: [
    'Namaste dosto, good luck all! 🙏🎲',
    'Chalo dekhte hain aaj kiska din hai! 🔥',
    'Hey all, let us play a clean game! 👋',
  ],
  comeback: [
    'Comeback is real! Ab dekhna! 🔥💪',
    'Table badal diya poora! ⚡😎',
    'Never give up bhai! 🏆',
  ],
}

// Probability of a bot sending banter on a trigger event (human-like, not spammy)
const TRIGGER_PROBABILITIES: Record<BanterTriggerContext, number> = {
  win: 0.35,
  bad_beat: 0.30,
  near_miss: 0.45,
  capture: 0.40,
  declare: 0.45,
  bluff_show: 0.35,
  table_greeting: 0.25,
  comeback: 0.50,
}

// Cooldown tracker per bot to prevent chat flooding (at least 20s between lines per bot)
const botChatCooldowns = new Map<string, number>()
const MIN_COOLDOWN_MS = 20000

export class BanterEngine {
  /**
   * Deterministically or randomly assign a personality trait to a bot based on their ID.
   */
  static getBotPersonality(userId: string): BotPersonality {
    const personalities: BotPersonality[] = [
      'witty_chatter',
      'cool_grinder',
      'hype_beast',
      'calm_veteran',
    ]
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i)
      hash |= 0
    }
    const idx = Math.abs(hash) % personalities.length
    return personalities[idx]
  }

  /**
   * Pick a contextual banter dialogue.
   */
  static pickBanterLine(context: BanterTriggerContext): string {
    const list = BANTER_LINES[context] || BANTER_LINES.win
    const idx = Math.floor(Math.random() * list.length)
    return list[idx]
  }

  /**
   * Trigger natural, delayed human-like table banter from a bot.
   */
  static triggerBanter(
    hub: RealtimeHub,
    roomId: string,
    bot: { userId: string; username: string },
    context: BanterTriggerContext,
    customProbability?: number
  ): void {
    if (!hub || !roomId || !bot?.userId) return

    // Cooldown check
    const now = Date.now()
    const lastTime = botChatCooldowns.get(bot.userId) || 0
    if (now - lastTime < MIN_COOLDOWN_MS) return

    const p = typeof customProbability === 'number'
      ? customProbability
      : (TRIGGER_PROBABILITIES[context] ?? 0.35)

    if (Math.random() > p) return // Bot chooses to stay silent

    const line = this.pickBanterLine(context)

    // Realistic human typing delay: 1500ms baseline + 35ms per character
    const typingDelay = Math.min(4500, Math.max(1600, 1500 + line.length * 35 + Math.floor(Math.random() * 800)))

    // Update cooldown
    botChatCooldowns.set(bot.userId, now + typingDelay)

    setTimeout(() => {
      try {
        hub.sendToRoom(roomId, 'room:chat', {
          user_id: bot.userId,
          username: bot.username || 'Player',
          message: line,
          type: 'emoji', // Using 'emoji' ensures mobile clients render it as a floating seat reaction
          timestamp: Date.now(),
        })
      } catch {
        // Ignored
      }
    }, typingDelay)
  }
}

