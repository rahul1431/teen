/**
 * Redis-based session manager for stateless game gateway load balancing.
 *
 * Session storage pattern:
 *   Key: session:{player_id}
 *   Value: JSON { player_id, game_type, current_game_state, joined_at }
 *   TTL: 30 minutes (auto-cleanup on timeout)
 */

import Redis from 'ioredis'

export interface GameSession {
  player_id: string
  game_type?: string
  current_game_state?: Record<string, any>
  joined_at: number
  gateway_instance?: string // Track which gateway instance manages this session
}

const SESSION_TTL = 30 * 60 // 30 minutes in seconds
const SESSION_KEY_PREFIX = 'session:'

export class SessionManager {
  constructor(private redis: Redis) {}

  /**
   * Create or update a session in Redis.
   * @param playerId Unique player identifier
   * @param session Session data
   */
  async setSession(playerId: string, session: Partial<GameSession>): Promise<void> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    const data: GameSession = {
      player_id: playerId,
      joined_at: Date.now(),
      ...session,
    }
    await this.redis.setex(key, SESSION_TTL, JSON.stringify(data))
  }

  /**
   * Retrieve a session from Redis.
   * @param playerId Unique player identifier
   * @returns Session data or null if expired/missing
   */
  async getSession(playerId: string): Promise<GameSession | null> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    const raw = await this.redis.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as GameSession
    } catch (e) {
      console.error(`[session] Failed to parse session for ${playerId}:`, e)
      return null
    }
  }

  /**
   * Update session data (e.g., game_type, game_state).
   * @param playerId Unique player identifier
   * @param updates Partial session updates
   */
  async updateSession(playerId: string, updates: Partial<GameSession>): Promise<void> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    const existing = await this.getSession(playerId)
    if (!existing) return

    const merged = { ...existing, ...updates }
    await this.redis.setex(key, SESSION_TTL, JSON.stringify(merged))
  }

  /**
   * Invalidate/delete a session.
   * @param playerId Unique player identifier
   */
  async invalidateSession(playerId: string): Promise<void> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    await this.redis.del(key)
  }

  /**
   * Extend session TTL (e.g., on heartbeat).
   * @param playerId Unique player identifier
   */
  async refreshSession(playerId: string): Promise<void> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    const ttl = await this.redis.ttl(key)
    if (ttl > 0) {
      await this.redis.expire(key, SESSION_TTL)
    }
  }

  /**
   * Check if a session exists and is not expired.
   * @param playerId Unique player identifier
   */
  async sessionExists(playerId: string): Promise<boolean> {
    const key = `${SESSION_KEY_PREFIX}${playerId}`
    return (await this.redis.exists(key)) === 1
  }

  /**
   * Get all session keys (debug/admin use).
   */
  async getAllSessionKeys(): Promise<string[]> {
    return this.redis.keys(`${SESSION_KEY_PREFIX}*`)
  }

  /**
   * Count active sessions.
   */
  async countActiveSessions(): Promise<number> {
    const keys = await this.getAllSessionKeys()
    return keys.length
  }
}
