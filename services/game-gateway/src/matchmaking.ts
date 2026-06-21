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

    // Build initial state for gateway Redis (engine keeps its own state)
    const gatewayPlayers = allPlayers.map((p, i) => ({
      userId: p.userId,
      username: p.username,
      seat: i + 1,
      isBot: bots.some(b => b.userId === p.userId),
      status: 'active',
    }))

    const fallbackState = {
      roomId,
      gameType,
      stake,
      players: gatewayPlayers,
      status: 'active',
      currentTurn: 0,
      pot: allPlayers.filter(p => !bots.some(b => b.userId === p.userId)).length * stake,
      round: 1,
      createdAt: Date.now(),
    }

    let engineState: any = null

    // Call Teen Patti Go engine to deal cards
    if (gameType === 'teen_patti') {
      const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
      try {
        const res = await fetch(`${engineUrl}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            stake,
            players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot, status: 'active', bet: 0, is_seen: false })),
          }),
        })
        if (res.ok) engineState = await res.json()
      } catch (e) {
        console.error('Teen Patti engine unavailable, using fallback state', e)
      }
    }

    const gameState = engineState || fallbackState
    // Always cache in gateway key so game:action handler can find the room
    await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify({
      ...fallbackState,
      // Include engine players (with cards) if available, but strip private cards from shared state
      players: engineState ? engineState.players.map((p: any) => ({
        ...p,
        userId: p.user_id ?? p.userId,
        cards: undefined, // don't leak cards into shared Redis key
      })) : fallbackState.players,
      currentTurn: engineState?.current_turn ?? 0,
    }))

    // Notify real players — send each player their own private cards
    for (const p of realPlayers) {
      const myPlayerData = engineState?.players?.find((ep: any) => (ep.user_id ?? ep.userId) === p.userId)
      this.io.to(p.socketId).emit('room:joined', {
        room_id: roomId,
        players: (engineState?.players ?? gatewayPlayers).map((ep: any) => ({
          ...ep,
          userId: ep.user_id ?? ep.userId,
          cards: undefined, // opponents' cards hidden
        })),
        my_cards: myPlayerData?.cards ?? [],
        your_seat: gatewayPlayers.find(pl => pl.userId === p.userId)?.seat,
        game_type: gameType,
        stake,
        pot: gameState.pot ?? gameState.Pot,
        current_turn: gameState.current_turn ?? gameState.CurrentTurn ?? 0,
        min_bet: engineState?.min_bet ?? stake,
      })
    }

    // Auto-play bot turns if it's a bot's turn first
    if (engineState && gameType === 'teen_patti') {
      this.scheduleBotTurn(roomId, engineState, realPlayers, bots)
    }
  }

  async scheduleBotTurn(roomId: string, state: any, realPlayers: MatchmakingEntry[], bots: MatchmakingEntry[]): Promise<void> {
    const currentIdx = state.current_turn ?? state.CurrentTurn ?? 0
    const currentPlayer = state.players?.[currentIdx]
    if (!currentPlayer) return

    const isBot = bots.some(b => b.userId === (currentPlayer.user_id ?? currentPlayer.userId))
    if (!isBot) return

    // Bot acts after a short delay
    setTimeout(async () => {
      const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
      try {
        const action = Math.random() > 0.3 ? 'call' : 'fold'
        const res = await fetch(`${engineUrl}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            user_id: currentPlayer.user_id ?? currentPlayer.userId,
            action,
            amount: state.min_bet ?? state.MinBet ?? state.stake,
            sequence_num: 0,
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        const newState = data.state ?? data

        // Broadcast updated state to real players
        for (const p of realPlayers) {
          this.io.to(p.socketId).emit('game:state_update', {
            room_id: roomId,
            state: { ...newState, players: newState.players?.map((ep: any) => ({ ...ep, cards: undefined })) },
            last_action: { user_id: currentPlayer.user_id ?? currentPlayer.userId, action },
            result: data.result ?? null,
          })
        }

        if (newState.status !== 'completed') {
          await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(newState))
          this.scheduleBotTurn(roomId, newState, realPlayers, bots)
        } else {
          await this.handleGameEnd(roomId, data.result, realPlayers, newState)
        }
      } catch (e) {
        console.error('Bot turn error', e)
      }
    }, 1500 + Math.random() * 1500)
  }

  async handleGameEnd(roomId: string, result: any, realPlayers: MatchmakingEntry[], state: any): Promise<void> {
    if (!result) return

    // Credit winner via wallet service
    if (result.winner_id) {
      try {
        await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/credit-game-win`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: result.winner_id, amount: result.prize, room_id: roomId }),
        })
      } catch (e) {
        console.error('Failed to credit game win', e)
      }
    }

    // Notify all real players of result
    for (const p of realPlayers) {
      this.io.to(p.socketId).emit('game:result', {
        room_id: roomId,
        winner_id: result.winner_id,
        prize: result.prize,
        hand_rank: result.hand_rank,
        all_hands: result.all_hands ?? [],
      })
    }
  }
}
