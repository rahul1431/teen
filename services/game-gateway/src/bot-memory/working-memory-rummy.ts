import { Redis } from 'ioredis'

/**
 * Card representation in Rummy working memory.
 */
export interface RummyMemoryCard {
  suit: string // 'H' | 'D' | 'S' | 'C'
  rank: string // 'A' | '2'..'10' | 'J' | 'Q' | 'K'
}

/**
 * Rummy In-Hand Working Memory
 * 
 * Tracks the live state of cards in circulation during an active 13-card Rummy hand:
 *  1. Open Draws: What specific cards each opponent picked up from the open discard pile.
 *  2. Discards: What cards each player has thrown away (revealing suits/ranks they don't want).
 *  3. Negative Card Counting: Tracks seen duplicates across the 2 decks (104 cards).
 *  4. Danger Evaluation: Computes which cards would feed the next opponent a sequence or set.
 */
export interface RummyWorkingMemoryState {
  roomId: string
  seenDiscards: string[]                       // e.g. ["7H", "KD", "AS"]
  playerPicks: Record<string, string[]>        // userId -> cards picked from open pile
  playerDiscards: Record<string, string[]>     // userId -> cards discarded
  closedDrawCounts: Record<string, number>     // userId -> number of draws from closed deck
}

const REDIS_WORKING_MEM_PREFIX = 'rummy:working_mem:'
const WORKING_MEM_TTL_SECONDS = 3600 // 1 hour per hand

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export class RummyWorkingMemory {
  /**
   * Retrieves or initializes the live working memory state for a Rummy table from Redis.
   */
  static async getState(redis: Redis, roomId: string): Promise<RummyWorkingMemoryState> {
    const key = `${REDIS_WORKING_MEM_PREFIX}${roomId}`
    try {
      if (redis) {
        const data = await redis.get(key)
        if (data) {
          return JSON.parse(data) as RummyWorkingMemoryState
        }
      }
    } catch {
      // Non-blocking
    }

    return {
      roomId,
      seenDiscards: [],
      playerPicks: {},
      playerDiscards: {},
      closedDrawCounts: {},
    }
  }

  /**
   * Saves the working memory state back to Redis with a 1-hour TTL.
   */
  private static async saveState(redis: Redis, roomId: string, state: RummyWorkingMemoryState): Promise<void> {
    if (!redis) return
    const key = `${REDIS_WORKING_MEM_PREFIX}${roomId}`
    try {
      await redis.setex(key, WORKING_MEM_TTL_SECONDS, JSON.stringify(state))
    } catch {
      // Non-blocking
    }
  }

  /**
   * Record when a player draws a card (from open discard pile or closed deck).
   */
  static async recordDraw(
    redis: Redis,
    roomId: string,
    userId: string,
    source: 'open' | 'closed',
    card?: { suit: string; rank: string }
  ): Promise<void> {
    try {
      const state = await this.getState(redis, roomId)

      if (source === 'open' && card && card.rank && card.suit) {
        const cardKey = `${card.rank}${card.suit.toUpperCase()}`
        state.playerPicks[userId] = state.playerPicks[userId] || []
        if (!state.playerPicks[userId].includes(cardKey)) {
          state.playerPicks[userId].push(cardKey)
        }
      } else {
        state.closedDrawCounts[userId] = (state.closedDrawCounts[userId] || 0) + 1
      }

      await this.saveState(redis, roomId, state)
    } catch {
      // Non-blocking
    }
  }

  /**
   * Record when any player (bot or human) discards a card.
   */
  static async recordDiscard(
    redis: Redis,
    roomId: string,
    userId: string,
    card: { suit: string; rank: string }
  ): Promise<void> {
    if (!card || !card.rank || !card.suit) return
    try {
      const state = await this.getState(redis, roomId)
      const cardKey = `${card.rank}${card.suit.toUpperCase()}`

      state.seenDiscards.push(cardKey)

      state.playerDiscards[userId] = state.playerDiscards[userId] || []
      state.playerDiscards[userId].push(cardKey)

      await this.saveState(redis, roomId, state)
    } catch {
      // Non-blocking
    }
  }

  /**
   * Evaluates unsafe cards that bots should avoid discarding.
   * If a target opponent (especially the next player in turn order) has picked
   * cards from the open pile, any adjacent rank in that suit or identical rank in another suit
   * is flagged as high-risk / dangerous.
   * 
   * Returns a list of card strings (e.g. ['7H', '8H', '9H', '8S']) that are dangerous to discard.
   */
  static async getUnsafeDiscards(
    redis: Redis,
    roomId: string,
    targetUserId?: string
  ): Promise<string[]> {
    try {
      const state = await this.getState(redis, roomId)
      const unsafeSet = new Set<string>()

      // Identify target picks
      const targetPicks: string[] = []
      if (targetUserId && state.playerPicks[targetUserId]) {
        targetPicks.push(...state.playerPicks[targetUserId])
      } else {
        // Look across all human players who picked from open pile
        for (const [uid, picks] of Object.entries(state.playerPicks)) {
          if (uid !== targetUserId) {
            targetPicks.push(...picks)
          }
        }
      }

      for (const cardStr of targetPicks) {
        const parsed = this.parseCardString(cardStr)
        if (!parsed) continue

        const { rank, suit } = parsed
        const rankIdx = RANKS.indexOf(rank)
        if (rankIdx === -1) continue

        // 1. Direct sequence neighbors in same suit (e.g. Picked 7H -> 6H and 8H are dangerous)
        if (rankIdx > 0) unsafeSet.add(`${RANKS[rankIdx - 1]}${suit}`)
        if (rankIdx < RANKS.length - 1) unsafeSet.add(`${RANKS[rankIdx + 1]}${suit}`)

        // 2. Second-degree sequence neighbors (e.g. 5H and 9H)
        if (rankIdx > 1) unsafeSet.add(`${RANKS[rankIdx - 2]}${suit}`)
        if (rankIdx < RANKS.length - 2) unsafeSet.add(`${RANKS[rankIdx + 2]}${suit}`)

        // 3. Same rank in all suits (triplet / set formation: 7D, 7S, 7C)
        for (const s of ['H', 'D', 'S', 'C']) {
          if (s !== suit) {
            unsafeSet.add(`${rank}${s}`)
          }
        }
      }

      return Array.from(unsafeSet)
    } catch {
      return []
    }
  }

  /**
   * Check if a specific card has already been seen multiple times in the discard pile.
   * In a 2-deck game, if 2 copies have already been discarded, discarding this card is 100% safe
   * because no opponent can use it to build a pure sequence with unseen copies.
   */
  static async isCardFullyExhausted(redis: Redis, roomId: string, card: { suit: string; rank: string }): Promise<boolean> {
    try {
      const state = await this.getState(redis, roomId)
      const cardKey = `${card.rank}${card.suit.toUpperCase()}`
      const count = state.seenDiscards.filter(c => c === cardKey).length
      return count >= 2
    } catch {
      return false
    }
  }

  /**
   * Helper to parse "7H" or "10S" into { rank, suit }.
   */
  private static parseCardString(cardStr: string): { rank: string; suit: string } | null {
    if (!cardStr || cardStr.length < 2) return null
    const suit = cardStr.slice(-1).toUpperCase()
    const rank = cardStr.slice(0, -1).toUpperCase()
    if (!['H', 'D', 'S', 'C'].includes(suit)) return null
    return { rank, suit }
  }

  /**
   * Clear working memory when hand ends.
   */
  static async clear(redis: Redis, roomId: string): Promise<void> {
    if (!redis) return
    try {
      await redis.del(`${REDIS_WORKING_MEM_PREFIX}${roomId}`)
    } catch {
      // Non-blocking
    }
  }
}

