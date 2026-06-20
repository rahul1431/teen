import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { Server } from 'socket.io'
import { v4 as uuid } from 'uuid'

export interface MatchmakingEntry {
  userId: string
  username: string
  socketId: string
}

export class MatchmakingService {
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private redis: Redis,
    private db: Pool,
    private io: Server,
  ) {}

  async joinQueue(gameType: string, stake: number, entry: MatchmakingEntry): Promise<void> {
    const key = `matchmaking:${gameType}:${stake}`
    const member = JSON.stringify(entry)
    await this.redis.zadd(key, Date.now(), member)

    const configRes = await this.db.query(
      'SELECT min_players, max_players, bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio FROM game_configs WHERE game_type = $1',
      [gameType]
    )
    const config = configRes.rows[0] || { min_players: 2, max_players: 6, bot_fill_enabled: true, bot_fill_delay_seconds: 10, max_bot_ratio: 0.6 }

    await this.tryCreateRoom(gameType, stake, config)

    if (config.bot_fill_enabled) {
      const timerKey = `${gameType}:${stake}`
      if (!this.timers.has(timerKey)) {
        const timer = setTimeout(async () => {
          this.timers.delete(timerKey)
          await this.botFillRoom(gameType, stake, config)
        }, config.bot_fill_delay_seconds * 1000)
        this.timers.set(timerKey, timer)
      }
    }
  }

  async leaveQueue(gameType: string, stake: number, userId: string): Promise<void> {
    const key = `matchmaking:${gameType}:${stake}`
    const members = await this.redis.zrange(key, 0, -1)
    for (const m of members) {
      if (JSON.parse(m).userId === userId) {
        await this.redis.zrem(key, m)
        break
      }
    }
  }

  private async tryCreateRoom(gameType: string, stake: number, config: any): Promise<void> {
    const key = `matchmaking:${gameType}:${stake}`
    const members = await this.redis.zrange(key, 0, config.max_players - 1)
    if (members.length < config.min_players) return

    const players: MatchmakingEntry[] = members.map(m => JSON.parse(m))
    await this.redis.zrem(key, ...members)
    await this.startGame(gameType, stake, players, [])
  }

  private async botFillRoom(gameType: string, stake: number, config: any): Promise<void> {
    const key = `matchmaking:${gameType}:${stake}`
    const members = await this.redis.zrange(key, 0, -1)
    if (!members.length) return

    const realPlayers: MatchmakingEntry[] = members.map(m => JSON.parse(m))
    await this.redis.zrem(key, ...members)

    const maxBots = Math.floor(config.max_players * config.max_bot_ratio)
    const botsNeeded = Math.min(config.max_players - realPlayers.length, maxBots)
    const bots = await this.getBots(gameType, botsNeeded)

    await this.startGame(gameType, stake, realPlayers, bots)
  }

  private async getBots(gameType: string, count: number): Promise<MatchmakingEntry[]> {
    const botRes = await this.db.query(
      `SELECT id, username FROM users WHERE is_bot = true AND status = 'active' ORDER BY RANDOM() LIMIT $1`,
      [count]
    )
    return botRes.rows.map(b => ({ userId: b.id, username: b.username, socketId: `bot_${b.id}` }))
  }

  private async startGame(gameType: string, stake: number, realPlayers: MatchmakingEntry[], bots: MatchmakingEntry[]): Promise<void> {
    const roomId = uuid()
    const allPlayers = [...realPlayers, ...bots]

    const client = await this.db.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO game_rooms (id, game_type, status, min_players, max_players, entry_fee, platform_fee_pct)
         VALUES ($1, $2, 'waiting', $3, $4, $5, 5)`,
        [roomId, gameType, 2, allPlayers.length, stake]
      )

      for (let i = 0; i < allPlayers.length; i++) {
        const p = allPlayers[i]
        const isBot = bots.some(b => b.userId === p.userId)

        if (!isBot && stake > 0) {
          await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: p.userId, amount: stake, room_id: roomId }),
          })
        }

        await client.query(
          `INSERT INTO game_participants (room_id, user_id, seat_number, entry_fee_deducted, is_bot)
           VALUES ($1, $2, $3, $4, $5)`,
          [roomId, p.userId, i + 1, isBot ? 0 : stake, isBot]
        )
      }

      await client.query("UPDATE game_rooms SET status = 'active', started_at = NOW() WHERE id = $1", [roomId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      console.error('Failed to start game room', err)
      return
    } finally {
      client.release()
    }

    // Store game state in Redis
    const gameState = {
      roomId,
      gameType,
      stake,
      players: allPlayers.map((p, i) => ({
        userId: p.userId,
        username: p.username,
        seat: i + 1,
        isBot: bots.some(b => b.userId === p.userId),
        status: 'active',
      })),
      status: 'active',
      currentTurn: 0,
      pot: allPlayers.filter(p => !bots.some(b => b.userId === p.userId)).length * stake,
      round: 1,
      createdAt: Date.now(),
    }
    await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(gameState))

    // Notify real players
    for (const p of realPlayers) {
      this.io.to(p.socketId).emit('room:joined', {
        room_id: roomId,
        players: gameState.players,
        your_seat: gameState.players.find(pl => pl.userId === p.userId)?.seat,
        game_type: gameType,
        stake,
      })
    }
  }
}
