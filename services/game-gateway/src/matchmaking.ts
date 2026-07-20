import { Redis } from 'ioredis'
import { Pool } from 'pg'
import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { RealtimeHub } from './realtime'
import { GameWatchdog } from './watchdog'
import { getBotProfile, pickBotAction, pickBotDelay } from './bot-profile'
import { monitorEmitter } from './monitor-emitter'
import { isInPersonalizationCanary, getPersonalizedDifficulty } from './personalized-difficulty-client'

export interface MatchmakingEntry {
  userId: string
  username: string
  // Ludo colour choice: preferred 1-based seat (1=red, 2=green, 3=yellow,
  // 4=blue), matching the client board's seat→colour order. Optional — other
  // games (and players who don't pick) leave it undefined and keep join order.
  preferredSeat?: number
  // Set once a "waiting for more players" notice has been sent for this queue
  // stint, so high-stake (humans-only) tables with no partner don't re-fire
  // the same error toast every bot_fill_delay_seconds forever.
  waitNotified?: boolean
}

// Teen Patti seat floor: low-stake tables top up with bots to this many seats.
export const TEEN_PATTI_BOT_FLOOR = 4

export interface TeenPattiSeatPlan {
  start: boolean    // true → seat these players and start the hand
  reals: number     // real players to seat
  bots: number      // bots to seat
  requeue: boolean  // true → too few players; put reals back and keep waiting
}

// Pure seat planner for a Teen Patti table once the gather window closes.
//   Low stakes  (< ₹100): fill with bots up to a 4-seat floor, but allow up to
//                         `maxPlayers` real players — 5RP / 6RP tables get no
//                         bots. Yields 1RP+3B, 2RP+2B, 3RP+1B, 4RP, 5RP, 6RP.
//   High stakes (≥ ₹100): real players only, never bots. Needs ≥2 reals to
//                         start; a lone real player keeps waiting for a human.
export function planTeenPattiSeats(
  realCount: number,
  stake: number,
  maxPlayers = 6,
): TeenPattiSeatPlan {
  const allowBots = stake < 100
  const reals = Math.min(Math.max(0, realCount), maxPlayers)
  if (allowBots) {
    if (reals < 1) return { start: false, reals: 0, bots: 0, requeue: false }
    const bots = Math.max(0, TEEN_PATTI_BOT_FLOOR - reals)
    return { start: true, reals, bots, requeue: false }
  }
  // High stakes — humans only.
  if (reals >= 2) return { start: true, reals, bots: 0, requeue: false }
  return { start: false, reals, bots: 0, requeue: true }
}

export class MatchmakingService {
  private timers = new Map<string, NodeJS.Timeout>()
  private botTimers = new Map<string, { timer: NodeJS.Timeout; turnIdx: number }>()
  private ludoAfkTimers = new Map<string, NodeJS.Timeout>()
  private static readonly LUDO_TURN_TIMEOUT_MS = 30000
  private teenPattiAfkTimers = new Map<string, NodeJS.Timeout>()
  // Match client's 30s self-fold countdown (mobile/lib/features/games/teen_patti/game_page.dart
  // _startTurnTimer). The Redis-backed deadline (2026-07-19) prevents cross-instance
  // phantom-folds from stale timers. This server-side timeout is purely a backstop
  // for when the client can't send that fold itself (dropped connection, backgrounded
  // app, crash). In normal cases, the client folds first and the server timeout never fires.
  private static readonly TEEN_PATTI_TURN_TIMEOUT_MS = 30000

  constructor(
    private redis: Redis,
    private db: Pool,
    private hub: RealtimeHub,
  ) {}

  // Room-state helpers used by the gateway's game:action handler.
  async getRoomState(roomId: string): Promise<any | null> {
    const raw = await this.redis.get(`game:room:${roomId}`)
    return raw ? JSON.parse(raw) : null
  }

  async setRoomState(roomId: string, state: any): Promise<void> {
    await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(state))
  }

  // Variations (classic / ak47 / no_limit) queue separately so e.g. players
  // choosing a No Limit table only ever match with other No Limit players.
  private queueKey(gameType: string, stake: number, variation: string): string {
    return variation === 'classic'
      ? `matchmaking:${gameType}:${stake}`
      : `matchmaking:${gameType}:${variation}:${stake}`
  }

  // Ludo-only guard: find a room this user is already a live participant of
  // (status hasn't reached completed/cancelled yet). Nothing in this codebase
  // ever sets game_participants.left_at — a disconnect-without-leave (crash,
  // network drop, or an abandoned test client) leaves the row exactly as it
  // was at join, still pointing at a room that keeps running server-side via
  // bot-fill/AFK-autoplay. Without this check, join_matchmaking would happily
  // queue the same user into a SECOND room while the first is still live —
  // confirmed live: same user_id active in two Ludo rooms simultaneously,
  // stake locked twice, one hand played entirely by auto-play with the human
  // never seeing it. Scoped to game_type='ludo' only — other game types are
  // under a separate lockdown and this shared handler must not change their
  // behavior.
  async findActiveLudoRoomForUser(userId: string): Promise<string | null> {
    const res = await this.db.query(
      `SELECT gp.room_id FROM game_participants gp
       JOIN game_rooms gr ON gr.id = gp.room_id
       WHERE gp.user_id = $1 AND gp.is_bot = false
         AND gr.game_type = 'ludo' AND gr.status = 'active'
       ORDER BY gp.joined_at DESC LIMIT 1`,
      [userId],
    )
    return res.rows[0]?.room_id ?? null
  }

  // Re-send room:joined from already-live Redis state instead of starting a
  // new room — lets a reconnecting player resume the game they're already
  // in. Returns false (caller should fall through to normal queueing) if the
  // Postgres row was stale — e.g. the room finished naturally between the
  // DB query above and this call, self-healing instead of blocking the user.
  async rejoinActiveLudoRoom(userId: string, roomId: string): Promise<boolean> {
    const state = await this.getRoomState(roomId)
    if (!state || state.status === 'completed' || state.status === 'cancelled') return false
    const players = state.players || []
    const me = players.find((p: any) => (p.user_id ?? p.userId) === userId)
    if (!me) return false

    this.hub.joinRoom(userId, roomId)
    this.hub.sendToUser(userId, 'room:joined', {
      room_id: roomId,
      game_type: 'ludo',
      stake: state.stake,
      state,
      players,
      your_seat: me.seat,
      current_turn: state.current_turn ?? state.currentTurn ?? 0,
      pot: (state.stake ?? 0) * players.length,
    })
    return true
  }

  async joinQueue(gameType: string, stake: number, entry: MatchmakingEntry, variation = 'classic'): Promise<void> {
    const key = this.queueKey(gameType, stake, variation)
    const member = JSON.stringify(entry)
    await this.redis.zadd(key, Date.now(), member)

    const configRes = await this.db.query(
      'SELECT min_players, max_players, bot_fill_enabled, bot_fill_delay_seconds, max_bot_ratio, bot_fill_table_size FROM game_configs WHERE game_type = $1',
      [gameType]
    )
    const config = configRes.rows[0] || { min_players: 2, max_players: 6, bot_fill_enabled: true, bot_fill_delay_seconds: 5, max_bot_ratio: 0.6, bot_fill_table_size: null }

    // Teen Patti table composition is decided by planTeenPattiSeats() when the
    // gather window closes, NOT by an instant start at the minimum. Both stake
    // tiers therefore need the gather timer armed:
    //   • Low stakes  (< ₹100): fill with bots up to a 4-seat floor, but let up
    //     to max_players real players accumulate first → 1RP+3B … 4RP/5RP/6RP.
    //   • High stakes (≥ ₹100): real players only, never bots (2RP … 6RP); a
    //     lone player keeps waiting for a second human.
    // The window itself is `bot_fill_delay_seconds` (10s in prod). Keeping
    // bot_fill_enabled=true for every teen_patti stake ensures the timer arms;
    // the no-bots rule for high stakes is enforced inside planTeenPattiSeats.
    if (gameType === 'teen_patti') {
      config.bot_fill_enabled = true
      config.bot_fill_table_size = config.bot_fill_table_size || TEEN_PATTI_BOT_FLOOR
    }

    await this.tryCreateRoom(gameType, stake, config, variation)

    if (config.bot_fill_enabled) {
      const timerKey = `${gameType}:${variation}:${stake}`
      if (!this.timers.has(timerKey)) {
        const timer = setTimeout(async () => {
          this.timers.delete(timerKey)
          await this.botFillRoom(gameType, stake, config, variation)
        }, config.bot_fill_delay_seconds * 1000)
        this.timers.set(timerKey, timer)
      }
    }
  }

  async leaveQueue(gameType: string, stake: number, userId: string, variation = 'classic'): Promise<void> {
    const key = this.queueKey(gameType, stake, variation)
    const members = await this.redis.zrange(key, 0, -1)
    for (const m of members) {
      if (JSON.parse(m).userId === userId) {
        await this.redis.zrem(key, m)
        break
      }
    }
  }

  private async tryCreateRoom(gameType: string, stake: number, config: any, variation = 'classic'): Promise<void> {
    const key = this.queueKey(gameType, stake, variation)

    // Games with a fixed bot-fill table size (e.g. Teen Patti's 4) shouldn't
    // instant-start on the bare min_players threshold — that's how you end up
    // with e.g. two real players locked into a 2-real/0-bot table the moment
    // they both happen to be queued, instead of waiting to see if enough real
    // players show up to skip bots entirely. Only start immediately once
    // there are enough real players that no bots are needed at all; anything
    // short of that waits for the bot-fill timer in joinQueue.
    // With bot-fill disabled there is no timer to top the table up, so waiting
    // for bot_fill_table_size would strand 2-3 real players in the queue —
    // fall back to min_players and start as soon as enough real players exist.
    // Teen Patti gathers real players for the whole window (see joinQueue), so
    // it only instant-starts when a FULL human table is ready — anything short
    // of max_players waits for the timer, which then seats the accumulated
    // reals (+ bots for low stakes) via planTeenPattiSeats. Other games keep
    // the legacy threshold.
    const noBotThreshold = gameType === 'teen_patti'
      ? (config.max_players || 6)
      : config.bot_fill_enabled
        ? (config.bot_fill_table_size || config.min_players)
        : (config.min_players || 2)

    // Atomically check if enough players are ready, and if so pop them
    const members = await this.redis.eval(
      `
      local key = KEYS[1]
      local no_bot_threshold = tonumber(ARGV[1])
      local max_players = tonumber(ARGV[2])
      local members = redis.call('zrange', key, 0, max_players - 1)
      if #members < no_bot_threshold then
        return {}
      end
      for _, m in ipairs(members) do
        redis.call('zrem', key, m)
      end
      return members
      `,
      1,
      key,
      noBotThreshold,
      config.max_players
    ) as string[]

    if (!members || members.length < noBotThreshold) return

    console.log(`[matchmaking] tryCreateRoom: ${members.length} players ready for ${gameType}:${variation}:${stake} — starting game`)
    const players: MatchmakingEntry[] = members.map(m => JSON.parse(m))
    await this.startGame(gameType, stake, players, [], variation)
  }

  private async botFillRoom(gameType: string, stake: number, config: any, variation = 'classic'): Promise<void> {
    const key = this.queueKey(gameType, stake, variation)
    
    // Atomically pop all waiting players from the queue
    const members = await this.redis.eval(
      `
      local key = KEYS[1]
      local members = redis.call('zrange', key, 0, -1)
      if #members > 0 then
        for _, m in ipairs(members) do
          redis.call('zrem', key, m)
        end
      end
      return members
      `,
      1,
      key
    ) as string[]

    if (!members || !members.length) return

    const realPlayers: MatchmakingEntry[] = members.map(m => JSON.parse(m))
    console.log(`[matchmaking] botFillRoom: ${realPlayers.length} real players for ${gameType}:${stake} — filling with bots`)

    // Teen Patti: seat composition follows the explicit per-tier spec via
    // planTeenPattiSeats (low stakes bot-fill to 4-seat floor, up to 6 reals;
    // high stakes humans-only, ≥2 to start). This replaces the generic bot math
    // below for teen_patti only.
    if (gameType === 'teen_patti') {
      const maxPlayers = config.max_players || 6
      const requeue = async (players: MatchmakingEntry[], notify: boolean) => {
        for (const p of players) {
          const alreadyNotified = p.waitNotified === true
          if (notify && !alreadyNotified) p.waitNotified = true
          await this.redis.zadd(key, Date.now(), JSON.stringify(p))
          if (notify && !alreadyNotified) {
            this.hub.sendToUser(p.userId, 'error', { message: 'Still searching for an opponent at this stake…' })
          }
        }
        const timer = setTimeout(async () => {
          this.timers.delete(`${gameType}:${variation}:${stake}`)
          await this.botFillRoom(gameType, stake, config, variation)
        }, (config.bot_fill_delay_seconds || 10) * 1000)
        this.timers.set(`${gameType}:${variation}:${stake}`, timer)
      }

      // More than a full table queued at once → seat the first 6, re-queue rest.
      const seated = realPlayers.slice(0, maxPlayers)
      const overflow = realPlayers.slice(maxPlayers)

      const plan = planTeenPattiSeats(seated.length, stake, maxPlayers)
      if (!plan.start) {
        // Too few players (lone high-stakes player) — keep everyone waiting.
        await requeue([...seated, ...overflow], plan.requeue)
        return
      }

      const bots = plan.bots > 0 ? await this.getBots(gameType, plan.bots, stake) : []
      // Bots may be scarce; still start if the table is playable (≥2 total),
      // otherwise wait for more (a lone real with no bots available).
      if (seated.length + bots.length < 2) {
        await requeue([...seated, ...overflow], true)
        return
      }
      if (overflow.length) await requeue(overflow, false)
      await this.startGame(gameType, stake, seated, bots, variation)
      return
    }

    let botsNeeded: number
    if (config.bot_fill_table_size) {
      // Fixed target size (e.g. Teen Patti's 4): top up to exactly that many
      // seats with bots. If enough real players already showed up to hit or
      // exceed the target (a race with tryCreateRoom), no bots are needed —
      // just seat the real players, capped at max_players.
      botsNeeded = Math.max(0, Math.min(config.max_players, config.bot_fill_table_size) - realPlayers.length)
    } else {
      const maxBots = Math.floor(config.max_players * config.max_bot_ratio)
      // Ensure at least min_players total (fill gap with bots)
      const minBotsNeeded = Math.max(0, (config.min_players || 2) - realPlayers.length)
      botsNeeded = Math.min(config.max_players - realPlayers.length, Math.max(maxBots, minBotsNeeded))
    }
    const bots = await this.getBots(gameType, botsNeeded, stake)

    // If no bots in DB and real players alone don't meet min_players, re-queue them
    if (realPlayers.length + bots.length < (config.min_players || 2)) {
      console.warn(`[matchmaking] botFillRoom: only ${realPlayers.length} real + ${bots.length} bots — re-queuing (min=${config.min_players})`)
      for (const p of realPlayers) {
        await this.redis.zadd(key, Date.now(), JSON.stringify(p))
        this.hub.sendToUser(p.userId, 'error', { message: 'No opponents available yet. Still searching…' })
      }
      // Retry bot fill after another delay
      const timer = setTimeout(async () => {
        this.timers.delete(`${gameType}:${variation}:${stake}`)
        await this.botFillRoom(gameType, stake, config, variation)
      }, (config.bot_fill_delay_seconds || 10) * 1000)
      this.timers.set(`${gameType}:${variation}:${stake}`, timer)
      return
    }

    await this.startGame(gameType, stake, realPlayers, bots, variation)
  }

  // Friends tables: start a game for an explicit player list, never bots.
  // Returns the roomId so the caller can map it back to the table code
  // (null when the start failed and wallets were rolled back).
  async startPrivateGame(gameType: string, stake: number, players: MatchmakingEntry[], privateCode?: string): Promise<string | null> {
    return this.startGame(gameType, stake, players, [], 'classic', privateCode)
  }

  // Set by index.ts: called after every settled game so private (friends)
  // tables can re-open their lobby and auto-start the next hand.
  onGameEnd?: (roomId: string) => void

  private async autoRefillBots(minRequired: number): Promise<void> {
    try {
      const lowBots = await this.db.query(
        `SELECT u.id, u.username, w.real_balance
         FROM users u
         JOIN wallets w ON w.user_id = u.id
         WHERE u.is_bot = true AND w.real_balance < $1`,
        [minRequired]
      )
      for (const bot of lowBots.rows) {
        const topUpAmount = 10000 - parseFloat(bot.real_balance)
        if (topUpAmount <= 0) continue

        const client = await this.db.connect()
        try {
          await client.query('BEGIN')
          const ikey = `autorefill:${bot.id}:${Date.now()}`
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status, description)
             VALUES ($1, 'manual_credit', 'real', $2, $3, 10000, $4, 'completed', 'Auto-refill due to low balance')`,
            [bot.id, topUpAmount, bot.real_balance, ikey]
          )
          await client.query(
            `UPDATE wallets SET real_balance = 10000, updated_at = NOW() WHERE user_id = $1`,
            [bot.id]
          )
          await client.query('COMMIT')
          console.log(`[matchmaking] Auto-refilled bot ${bot.username} with ₹${topUpAmount}`)
        } catch (err) {
          await client.query('ROLLBACK')
          console.error(`[matchmaking] Failed to auto-refill bot ${bot.username}:`, err)
        } finally {
          client.release()
        }
      }
    } catch (globalErr) {
      console.error('[matchmaking] autoRefillBots failed globally', globalErr)
    }
  }

  private async getBots(gameType: string, count: number, stake: number): Promise<MatchmakingEntry[]> {
    await this.autoRefillBots(stake)

    const botRes = await this.db.query(
      `SELECT u.id, u.username
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.is_bot = true AND u.status = 'active' AND w.real_balance >= $1
       ORDER BY RANDOM() LIMIT $2`,
      [stake, count]
    )
    return botRes.rows.map(b => ({ userId: b.id, username: b.username }))
  }

  // Seat order = board colour. When any real player expressed a colour
  // preference (Ludo), place each at the array index matching their chosen
  // seat (FCFS by queue order; conflicts fall through to the next free seat),
  // then fill the rest with the remaining real players and bots. Games without
  // a preference keep the legacy [...real, ...bots] order untouched.
  private orderBySeatPreference(
    realPlayers: MatchmakingEntry[],
    bots: MatchmakingEntry[],
  ): MatchmakingEntry[] {
    const total = realPlayers.length + bots.length
    const anyPref = realPlayers.some(
      p => p.preferredSeat && p.preferredSeat >= 1 && p.preferredSeat <= total,
    )
    if (!anyPref) return [...realPlayers, ...bots]

    const slots: (MatchmakingEntry | null)[] = new Array(total).fill(null)
    const leftover: MatchmakingEntry[] = []
    for (const p of realPlayers) {
      const idx = (p.preferredSeat ?? 0) - 1
      if (idx >= 0 && idx < total && slots[idx] === null) {
        slots[idx] = p
      } else {
        leftover.push(p) // no pick, or their colour was already taken
      }
    }
    const fillers = [...leftover, ...bots]
    let fi = 0
    for (let i = 0; i < total; i++) {
      if (slots[i] === null) slots[i] = fillers[fi++]
    }
    return slots as MatchmakingEntry[]
  }

  private async startGame(gameType: string, stake: number, realPlayers: MatchmakingEntry[], bots: MatchmakingEntry[], variation = 'classic', privateCode?: string): Promise<string | null> {
    const roomId = uuid()
    void GameWatchdog.touch(this.redis, roomId) // liveness for the idle-game reaper
    const allPlayers = this.orderBySeatPreference(realPlayers, bots)
    console.log(`[matchmaking] startGame room=${roomId} ${gameType}:${stake} real=${realPlayers.length} bots=${bots.length}`)

    let botDifficulty = 'medium'
    try {
      const configRes = await this.db.query(
        'SELECT bot_difficulty FROM game_configs WHERE game_type = $1',
        [gameType]
      )
      if (configRes.rows.length > 0 && configRes.rows[0].bot_difficulty) {
        botDifficulty = configRes.rows[0].bot_difficulty
      }
    } catch (configErr) {
      console.error('[matchmaking] Failed to query bot_difficulty from game_configs', configErr)
    }

    // Personalized-difficulty canary (Task 18/19): the engines take one
    // difficulty per room, so this only applies cleanly to the common
    // "one real player + bot fill" case — not multi-real-player rooms.
    let botDifficultySource: 'standard' | 'personalized' = 'standard'
    if (realPlayers.length === 1 && isInPersonalizationCanary(realPlayers[0].userId)) {
      const prediction = await getPersonalizedDifficulty(realPlayers[0].userId, gameType)
      if (prediction) {
        botDifficulty = prediction.recommended_difficulty
        botDifficultySource = 'personalized'
      }
    }

    const client = await this.db.connect()
    const lockedUserIds: string[] = []
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO game_rooms (id, game_type, status, min_players, max_players, entry_fee, platform_fee_pct, bot_difficulty_source)
         VALUES ($1, $2, 'waiting', $3, $4, $5, 5, $6)`,
        [roomId, gameType, 2, allPlayers.length, stake, botDifficultySource]
      )

      for (let i = 0; i < allPlayers.length; i++) {
        const p = allPlayers[i]
        const isBot = bots.some(b => b.userId === p.userId)

        if (stake > 0) {
          const lockRes = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: p.userId, amount: stake, room_id: roomId, lock_id: crypto.randomUUID() }),
          })
          if (!lockRes.ok) {
            const msg = await lockRes.text()
            throw new Error(`Wallet lock failed for ${p.username}: ${msg}`)
          }
          lockedUserIds.push(p.userId)
        }

        await client.query(
          `INSERT INTO game_participants (room_id, user_id, seat_number, entry_fee_deducted, is_bot)
           VALUES ($1, $2, $3, $4, $5)`,
          [roomId, p.userId, i + 1, stake, isBot]
        )
      }

      await client.query("UPDATE game_rooms SET status = 'active', started_at = NOW() WHERE id = $1", [roomId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      console.error('Failed to start game room', err)
      
      // Unlock/refund any players whose wallets were successfully locked before this failure occurred
      for (const uid of lockedUserIds) {
        try {
          await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
            body: JSON.stringify({ user_id: uid, amount: stake, room_id: roomId }),
          })
          console.log(`Rollback-unlocked user=${uid} amount=${stake} due to game start failure`)
        } catch (unlockErr) {
          console.error(`Failed to unlock wallet for user=${uid} during rollback:`, unlockErr)
        }
      }

      // Notify real players so they don't wait forever
      for (const p of realPlayers) {
        this.hub.sendToUser(p.userId, 'error', { message: `Failed to start game: ${(err as Error).message || err}` })
      }
      return null
    } finally {
      client.release()
    }

    // Feed the fraud/analytics pipeline — one room_joined per real player so
    // per-user rules (co-location, velocity) see each participant.
    const monitorPlayerIds = allPlayers.map(p => p.userId)
    for (const p of realPlayers) {
      monitorEmitter.emit('room_joined', {
        game_type: gameType,
        room_id: roomId,
        user_id: p.userId,
        players: monitorPlayerIds,
        stake,
      })
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
      variation,
      no_limit: variation === 'no_limit',
      players: gatewayPlayers,
      status: 'active',
      currentTurn: 0,
      pot: allPlayers.length * stake,
      round: 1,
      createdAt: Date.now(),
      botDifficulty: botDifficulty,  // I3: default bot difficulty written into room state
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
            bot_difficulty: botDifficulty,
            no_limit: variation === 'no_limit',
            variation,
            players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot, status: 'active', bet: 0, is_seen: false })),
          }),
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) engineState = await res.json()
      } catch (e) {
        console.error('Teen Patti engine unavailable, using fallback state', e)
      }
    }

    // Ludo runs on its own engine (roll/move turns, no cards). It uses a
    // different state shape, so it gets a dedicated cache + room:joined branch.
    if (gameType === 'ludo') {
      const engineUrl = process.env.LUDO_ENGINE_URL || 'http://127.0.0.1:3011'
      const callLudoStart = () => fetch(`${engineUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          stake,
          bot_difficulty: botDifficulty,
          players: gatewayPlayers.map(p => ({ user_id: p.userId, username: p.username, seat: p.seat, is_bot: p.isBot })),
        }),
        signal: AbortSignal.timeout(5000),
      })
      try {
        const res = await callLudoStart()
        if (res.ok) engineState = await res.json()
        else console.error(`Ludo engine /start returned ${res.status}`)
      } catch (e) {
        console.error('Ludo engine unavailable, will retry once', e)
      }

      // Retry once (mirrors the bot-turn retry pattern elsewhere in this file)
      // before giving up. Without a confirmed engine response there is no real
      // ludo:game:<roomId> state in Redis, so every future roll/move would 404
      // forever and the player is left staring at a dead, unresponsive board
      // (reproduced live) until the 15-min idle watchdog eventually refunds them.
      if (!engineState) {
        await new Promise(r => setTimeout(r, 1500))
        try {
          const res = await callLudoStart()
          if (res.ok) engineState = await res.json()
          else console.error(`Ludo engine /start retry returned ${res.status}`)
        } catch (e) {
          console.error('Ludo engine still unavailable after retry', e)
        }
      }

      if (!engineState) {
        // Give up immediately instead of handing players a broken table:
        // unlock stakes, mark the room cancelled, and tell real players so
        // they aren't left waiting on a room that can never accept an action.
        if (stake > 0) {
          for (const p of allPlayers) {
            try {
              await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
                body: JSON.stringify({ user_id: p.userId, amount: stake, room_id: roomId }),
              })
            } catch (unlockErr) {
              console.error(`Failed to unlock wallet for user=${p.userId} after Ludo engine start failure:`, unlockErr)
            }
          }
        }
        await this.db.query("UPDATE game_rooms SET status = 'cancelled' WHERE id = $1", [roomId])
          .catch(e => console.error('Failed to mark cancelled Ludo room', e))
        for (const p of realPlayers) {
          this.hub.sendToUser(p.userId, 'error', {
            message: 'Could not start the Ludo table — your stake has been refunded. Please try again.',
          })
        }
        return roomId
      }

      const ludoState = engineState
      await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify({ ...ludoState, gameType: 'ludo', stake }))

      console.log(`[matchmaking] emitting room:joined (ludo) to ${realPlayers.length} players for room=${roomId}`)
      for (const p of realPlayers) {
        this.hub.joinRoom(p.userId, roomId)
        this.hub.sendToUser(p.userId, 'room:joined', {
          room_id: roomId,
          game_type: 'ludo',
          stake,
          state: ludoState,
          players: ludoState.players,
          your_seat: gatewayPlayers.find(pl => pl.userId === p.userId)?.seat,
          current_turn: ludoState.current_turn ?? 0,
          pot: stake * allPlayers.length,
        })
      }

      // If a bot holds the opening turn, start driving bot turns immediately.
      void this.driveLudoBots(roomId)
      return roomId
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

    // Notify real players — send each player their own private cards.
    // Emit to the persistent user:{userId} room so delivery works even if
    // the socket reconnected (changing socket.id) since matchmaking started.
    console.log(`[matchmaking] emitting room:joined to ${realPlayers.length} players for room=${roomId} (engine=${engineState ? 'ok' : 'fallback'})`)
    for (const p of realPlayers) {
      const myPlayerData = engineState?.players?.find((ep: any) => (ep.user_id ?? ep.userId) === p.userId)
      // Auto-join the player's connections to the game room BEFORE emitting, so
      // subsequent sendToRoom(room_id) broadcasts reach them.
      this.hub.joinRoom(p.userId, roomId)
      this.hub.sendToUser(p.userId, 'room:joined', {
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
        dealer_id: engineState?.dealer_id ?? engineState?.DealerID,
        min_bet: engineState?.min_bet ?? stake,
        variation,
        joker_rank: engineState?.joker_rank,
        joker_value: engineState?.joker_value,
        // Friends tables: lets the client offer "Same Table" after the hand.
        private_code: privateCode,
      })
    }

    // Auto-play bot turns if it's a bot's turn first
    if (engineState && gameType === 'teen_patti') {
      this.scheduleBotTurn(roomId, engineState, realPlayers, bots)
    }

    return roomId
  }

  async scheduleBotTurn(roomId: string, state: any, realPlayers: MatchmakingEntry[], bots: MatchmakingEntry[]): Promise<void> {
    const currentIdx = state.current_turn ?? state.CurrentTurn ?? 0
    const currentPlayer = state.players?.[currentIdx]

    // Clear existing timer if turn changed, or prevent duplicate scheduling if same turn
    const existing = this.botTimers.get(roomId)
    if (existing) {
      if (!currentPlayer || existing.turnIdx !== currentIdx) {
        clearTimeout(existing.timer)
        this.botTimers.delete(roomId)
      } else {
        // Already scheduled for this turn
        return
      }
    }

    if (!currentPlayer) return

    const isBot = bots.some(b => b.userId === (currentPlayer.user_id ?? currentPlayer.userId))
    if (!isBot) {
      // Connected human's turn — arm the AFK backstop timer (see
      // scheduleTeenPattiAfkTimer) instead of leaving the table with no
      // server-side path forward if their client can't self-fold.
      void this.scheduleTeenPattiAfkTimer(roomId, currentIdx)
      return
    }

    // A bot's turn is being driven — any AFK timer from a previous human turn
    // is stale now, clear it (local + shared deadline).
    const staleAfkTimer = this.teenPattiAfkTimers.get(roomId)
    if (staleAfkTimer) { clearTimeout(staleAfkTimer); this.teenPattiAfkTimers.delete(roomId) }
    this.redis.del(this.teenPattiAfkRedisKey(roomId)).catch(() => {})

    // Bot acts after a profile-driven delay
    const gameType = state.gameType ?? state.game_type ?? 'teen_patti'
    // I3: Ensure botDifficulty always resolves to a typed string before reaching getBotProfile
    const botDifficulty = (state.botDifficulty ?? state.bot_difficulty ?? 'medium') as 'easy' | 'medium' | 'hard'
    const botProfile = await getBotProfile(this.redis, gameType, botDifficulty)
    const botAction = pickBotAction(botProfile)
    const botDelay = pickBotDelay(botProfile)

    const timer = setTimeout(async () => {
      this.botTimers.delete(roomId)
      void GameWatchdog.touch(this.redis, roomId) // liveness for the idle-game reaper
      const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'

      // Hoist action/amount so the catch block can use them in the retry (I5)
      let action: any = botAction
      const minBet = state.min_bet ?? state.MinBet ?? state.stake
      let amount = action === 'raise' ? minBet * 2 : minBet

      // I5: Extract the engine call + state-broadcast into a reusable closure so we can retry once
      const doAction = async () => {
        const isSeen = currentPlayer.isSeen || currentPlayer.is_seen || false
        let extraBet = 0
        if (action === 'call') {
          extraBet = isSeen ? minBet * 2 : minBet
        } else if (action === 'raise') {
          extraBet = amount
        } else if (action === 'show') {
          extraBet = isSeen ? minBet * 2 : minBet
        } else if (action === 'sideshow') {
          extraBet = minBet * 2
        }

        let locked = false
        const lockId = crypto.randomUUID()
        const userId = currentPlayer.user_id ?? currentPlayer.userId

        if (extraBet > 0) {
          try {
            const lockRes = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/lock`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
              body: JSON.stringify({ user_id: userId, amount: extraBet, room_id: roomId, lock_id: lockId }),
            })
            if (!lockRes.ok) {
              const msg = await lockRes.text()
              console.warn(`[gateway] Bot wallet lock failed: ${msg}. Forcing bot to fold.`)
              action = 'fold'
              amount = 0
              extraBet = 0
            } else {
              locked = true
            }
          } catch (err) {
            console.error('[gateway] Bot wallet lock failed with exception. Forcing bot to fold.', err)
            action = 'fold'
            amount = 0
            extraBet = 0
          }
        }

        if (locked) {
          await this.db.query(
            'UPDATE game_participants SET entry_fee_deducted = entry_fee_deducted + $1 WHERE room_id = $2 AND user_id = $3',
            [extraBet, roomId, userId]
          ).catch(e => console.error('[gateway] Failed to update bot entry_fee_deducted in DB', e))
        }

        const res = await fetch(`${engineUrl}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            user_id: userId,
            action,
            amount,
            sequence_num: 0,
          }),
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          if (locked) {
            await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
              body: JSON.stringify({ user_id: userId, amount: extraBet, room_id: roomId }),
            }).catch(e => console.error('[gateway] Bot unlock rollback failed', e))

            await this.db.query(
              'UPDATE game_participants SET entry_fee_deducted = entry_fee_deducted - $1 WHERE room_id = $2 AND user_id = $3',
              [extraBet, roomId, userId]
            ).catch(e => console.error('[gateway] Failed to rollback bot entry_fee_deducted in DB', e))
          }
          throw new Error(`Bot engine returned ${res.status}`)
        }
        const data = await res.json()
        const newState = data.state ?? data

        // Broadcast updated state to real players
        for (const p of realPlayers) {
          this.hub.sendToUser(p.userId, 'game:state_update', {
            room_id: roomId,
            state: { ...newState, players: newState.players?.map((ep: any) => ({ ...ep, cards: undefined })) },
            last_action: { user_id: userId, action },
            result: data.result ?? null,
          })
        }

        if (newState.status !== 'completed') {
          await this.redis.setex(`game:room:${roomId}`, 3600, JSON.stringify(newState))
          this.scheduleBotTurn(roomId, newState, realPlayers, bots)
        } else {
          await this.handleGameEnd(roomId, data.result, realPlayers, newState)
        }
      }

      try {
        await doAction()
      } catch (e) {
        console.error('Bot turn error', e)
        // I5: Retry once after 2 s; on second failure settle/refund all players so they're not stuck
        await new Promise(r => setTimeout(r, 2000))
        try {
          await doAction()
        } catch (retryErr) {
          console.error('Bot turn error on retry — ending game to unblock players', retryErr)
          await this.handleGameEnd(roomId, { winner_id: null, prize: 0 }, realPlayers, state)
        }
      }
    }, botDelay)

    this.botTimers.set(roomId, { timer, turnIdx: currentIdx })
  }

  // Cancel a room's pending AFK backstop without re-arming a new one. Called
  // the instant a real action is RECEIVED and passes the turn-ownership
  // check — before the slow wallet-lock + engine round trip that follows.
  // Without this, the timer set for the player's turn kept running for the
  // whole duration of that processing chain, only getting cleared and
  // replaced afterward via scheduleBotTurn. If that chain took long enough
  // (wallet-lock latency, engine latency) to run past the timer's remaining
  // budget, the AFK auto-fold could fire WHILE the player's real action was
  // still in flight — both hitting the engine's /action endpoint for the
  // same room with no per-room lock on the Go side, a genuine race that
  // could fold a player who acted in time. Clearing here closes that window;
  // scheduleBotTurn re-arms a fresh timer for the new turn once it's known.
  clearTeenPattiAfkTimer(roomId: string): void {
    const existing = this.teenPattiAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.teenPattiAfkTimers.delete(roomId)
    // Best-effort: also clear the shared deadline so a stale timer on another
    // instance — mid-fire during this request's wallet-lock/engine round trip
    // — sees a mismatch (or nothing) instead of a deadline that still matches
    // and wrongly proceeds. scheduleBotTurn re-arms a fresh one once the new
    // turn state is known, on whatever instance processes that response.
    this.redis.del(this.teenPattiAfkRedisKey(roomId)).catch(() => {})
  }

  private teenPattiAfkRedisKey(roomId: string): string {
    return `tp:afk:${roomId}`
  }

  // Arm a per-turn AFK backstop for a connected-but-idle Teen Patti player.
  // Re-arms on every call (each new turn/action clears and replaces the
  // previous room timer) — mirrors scheduleLudoAfkTimer below.
  //
  // game-gateway runs as 3 separate PM2 processes behind nginx, and nginx
  // hashes WebSocket connections by TOKEN (per-player), not per-room — so two
  // players at the same table, or the same player across a reconnect, can
  // easily land on different instances. This timer used to live only in this
  // process's local `teenPattiAfkTimers` map: if a turn-holding action (e.g.
  // 'see', which doesn't advance current_turn) got processed by a DIFFERENT
  // instance than the one that armed the original timer, that instance had no
  // way to know and never re-armed it — the stale original timer fired
  // exactly 40s after the turn STARTED regardless of the player having acted
  // in the meantime, wrongly auto-folding them. Confirmed live: a player who
  // sent 'see' via one instance at T+20s and was about to 'call' via another
  // instance at T+45s got folded at T+40.004s — the original instance's timer,
  // completely blind to the 'see' it never saw.
  //
  // Fix: the deadline is now authoritative in Redis (shared across all
  // instances, same pattern as GameWatchdog's liveness key). Every instance
  // still runs its own local setTimeout as a wake-up mechanism, but the
  // callback re-reads Redis and only acts if the deadline it's holding is
  // still the one currently in force for this exact turn index.
  private async scheduleTeenPattiAfkTimer(roomId: string, turnIdx: number): Promise<void> {
    const existing = this.teenPattiAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.teenPattiAfkTimers.delete(roomId)

    const deadline = Date.now() + MatchmakingService.TEEN_PATTI_TURN_TIMEOUT_MS
    try {
      await this.redis.setex(
        this.teenPattiAfkRedisKey(roomId),
        90,
        JSON.stringify({ turnIdx, deadline }),
      )
    } catch { /* Redis hiccup — local timer below still provides a backstop */ }

    const timer = setTimeout(() => {
      this.teenPattiAfkTimers.delete(roomId)
      void this.autoFoldIdleTeenPattiTurn(roomId, turnIdx, deadline)
    }, MatchmakingService.TEEN_PATTI_TURN_TIMEOUT_MS)
    this.teenPattiAfkTimers.set(roomId, timer)
  }

  // Fires when a human's Teen Patti turn has sat idle past the timeout.
  // Re-checks state immediately before acting (the player may have just acted)
  // and folds on their behalf — fold is always legal and free (no wallet call),
  // so this can never double-charge or move money without the action the
  // player would have taken anyway via their own client-side fold timer.
  //
  // expectedTurnIdx/expectedDeadline identify the specific arming that led to
  // THIS local timer's firing. Before acting, re-check the authoritative
  // Redis deadline: if another instance re-armed for the same turn index
  // (e.g. the player sent a turn-holding action like 'see' through a
  // different gateway process), the shared deadline will have moved past
  // this timer's expectedDeadline — abort and let that instance's own timer
  // fire at the correct time instead.
  private async autoFoldIdleTeenPattiTurn(roomId: string, expectedTurnIdx: number, expectedDeadline: number): Promise<void> {
    try {
      const raw = await this.redis.get(this.teenPattiAfkRedisKey(roomId))
      if (raw) {
        const current = JSON.parse(raw) as { turnIdx: number; deadline: number }
        if (current.turnIdx !== expectedTurnIdx || current.deadline !== expectedDeadline) return
      }
    } catch { /* Redis unreachable — fall through to the local-only check below */ }

    const state = await this.getRoomState(roomId)
    if (!state || state.status === 'completed') return
    const turnIdx = state.current_turn ?? state.CurrentTurn ?? 0
    if (turnIdx !== expectedTurnIdx) return
    const cur = state.players?.[turnIdx]
    if (!cur) return
    if (cur.isBot || cur.is_bot) return // bot turns are driven elsewhere
    const userId = cur.user_id ?? cur.userId

    const engineUrl = process.env.TEEN_PATTI_ENGINE_URL || 'http://127.0.0.1:3010'
    try {
      const res = await fetch(`${engineUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, user_id: userId, action: 'fold', amount: 0, sequence_num: 0 }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return
      const data = await res.json() as any
      const newState = data.state ?? data
      const sanitized = { ...newState, players: newState.players?.map((p: any) => ({ ...p, cards: undefined })) }
      await this.setRoomState(roomId, sanitized)
      this.redis.del(this.teenPattiAfkRedisKey(roomId)).catch(() => {})

      this.hub.sendToUser(userId, 'error', {
        message: 'You took too long — you were folded automatically.',
      })
      this.hub.sendToRoom(roomId, 'game:state_update', {
        room_id: roomId,
        state: sanitized,
        last_action: { user_id: userId, action: 'fold' },
        result: data.result ?? null,
      })

      const realPlayers = (newState.players ?? []).filter((p: any) => !(p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))
      const bots = (newState.players ?? []).filter((p: any) => (p.isBot || p.is_bot)).map((p: any) => ({ userId: p.userId ?? p.user_id, username: p.username }))

      if (newState.status === 'completed' && data.result) {
        await this.handleGameEnd(roomId, data.result, realPlayers, newState)
      } else {
        void this.scheduleBotTurn(roomId, newState, realPlayers, bots)
      }
    } catch (e) {
      console.error('[gateway] Teen Patti AFK auto-fold failed', e)
    }
  }

  // Drive consecutive bot turns for a Ludo room until it's a human's turn or
  // the game ends. Each bot turn is broadcast so clients animate the dice/move.
  async driveLudoBots(roomId: string): Promise<void> {
    const engineUrl = process.env.LUDO_ENGINE_URL || 'http://127.0.0.1:3011'
    for (let guard = 0; guard < 400; guard++) {
      void GameWatchdog.touch(this.redis, roomId) // liveness for the idle-game reaper
      const state = await this.getRoomState(roomId)
      if (!state || state.status === 'completed') return
      const turnIdx = state.current_turn ?? state.currentTurn ?? 0
      const cur = state.players?.[turnIdx]
      if (!cur || !cur.is_bot) {
        // It's a connected human's turn now — arm the per-turn AFK timer so a
        // stalling player doesn't tie up the whole table (previously only a
        // whole-room 15-minute idle watchdog existed; see GameWatchdog).
        void this.scheduleLudoAfkTimer(roomId, turnIdx)
        return
      }

      await new Promise(r => setTimeout(r, 1200)) // pacing so the table feels live
      try {
        const res = await fetch(`${engineUrl}/bot-turn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id: roomId, user_id: cur.user_id }),
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return
        const data = await res.json() as any
        const newState = data.state
        await this.setRoomState(roomId, { ...newState, gameType: 'ludo' })
        this.hub.sendToRoom(roomId, 'game:state_update', {
          room_id: roomId,
          state: newState,
          last_action: { user_id: cur.user_id, action: 'bot', dice: data.dice, moved_token: data.moved_token },
          result: data.result ?? null,
        })
        if (data.result) { await this.handleLudoEnd(roomId, data.result); return }
      } catch (e) {
        console.error('Ludo bot turn error', e)
        return
      }
    }
  }

  // Cancel a room's pending AFK backstop without re-arming a new one. Called
  // the instant a real Ludo action is RECEIVED — before the engine round
  // trip. Mirrors clearTeenPattiAfkTimer: without this, a timer armed for
  // this turn kept running for the whole duration of the engine call, and a
  // stale timer on a DIFFERENT gateway instance (nginx hashes WS connections
  // by player token, not by room) never saw the action at all, firing on
  // schedule regardless. scheduleLudoAfkTimer re-arms a fresh one once the
  // new turn state is known.
  clearLudoAfkTimer(roomId: string): void {
    const existing = this.ludoAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.ludoAfkTimers.delete(roomId)
    this.redis.del(this.ludoAfkRedisKey(roomId)).catch(() => {})
  }

  private ludoAfkRedisKey(roomId: string): string {
    return `ludo:afk:${roomId}`
  }

  private ludoTurnClaimKey(roomId: string, turnIdx: number): string {
    return `ludo:turnclaim:${roomId}:${turnIdx}`
  }

  // Marks "a real player action is in flight for this turn" so the AFK
  // auto-play backstop (autoPlayIdleLudoTurn) can back off instead of racing
  // it to the engine — see the call site in index.ts's handleLudoAction for
  // the full race this closes. Best-effort: a missed claim just means the
  // pre-existing (rarer) race window reopens for that one action, same as
  // before this fix existed.
  async claimLudoTurn(roomId: string, turnIdx: number): Promise<void> {
    try {
      await this.redis.set(this.ludoTurnClaimKey(roomId, turnIdx), '1', 'PX', 4000)
    } catch { /* best effort */ }
  }

  private async isLudoTurnClaimed(roomId: string, turnIdx: number): Promise<boolean> {
    try {
      return (await this.redis.get(this.ludoTurnClaimKey(roomId, turnIdx))) !== null
    } catch {
      return false
    }
  }

  // Arm a per-turn timeout for a connected-but-idle human player. Only a
  // whole-room 15-min idle watchdog existed before (GameWatchdog), so a
  // player who stayed connected but simply never acted could stall a live,
  // real-money table for the full 15 minutes. Re-arms on every call (each new
  // turn/action clears and replaces the previous room timer).
  //
  // Same cross-instance hazard as Teen Patti's AFK timer (see
  // scheduleTeenPattiAfkTimer for the full writeup): game-gateway runs as 3
  // processes behind nginx, hashed by player token, not by room. A timer
  // armed in this process's local map is invisible to whichever instance
  // actually handles the player's next action, so the deadline is now
  // authoritative in Redis (shared, same pattern as GameWatchdog) — every
  // instance's local setTimeout is just a wake-up mechanism that re-checks
  // Redis before acting.
  private async scheduleLudoAfkTimer(roomId: string, turnIdx: number): Promise<void> {
    const existing = this.ludoAfkTimers.get(roomId)
    if (existing) clearTimeout(existing)
    this.ludoAfkTimers.delete(roomId)

    const deadline = Date.now() + MatchmakingService.LUDO_TURN_TIMEOUT_MS
    try {
      await this.redis.setex(
        this.ludoAfkRedisKey(roomId),
        90,
        JSON.stringify({ turnIdx, deadline }),
      )
    } catch { /* Redis hiccup — local timer below still provides a backstop */ }

    const timer = setTimeout(() => {
      this.ludoAfkTimers.delete(roomId)
      void this.autoPlayIdleLudoTurn(roomId, turnIdx, deadline)
    }, MatchmakingService.LUDO_TURN_TIMEOUT_MS)
    this.ludoAfkTimers.set(roomId, timer)
  }

  // Fires when a human's turn has sat idle past the timeout. Re-checks the
  // authoritative Redis deadline first — if another instance re-armed for
  // this room (the player acted via a different gateway process), abort and
  // let that instance's own timer fire at the correct time instead. Then
  // re-checks state immediately before acting (the player may have acted in
  // the last instant) and plays the minimum legal action on their behalf:
  // roll if a roll is owed, or the first legal token if a move is owed (no
  // strategy needed — this only exists to unstick the table, not to play
  // well for them).
  private async autoPlayIdleLudoTurn(roomId: string, expectedTurnIdx: number, expectedDeadline: number): Promise<void> {
    try {
      const raw = await this.redis.get(this.ludoAfkRedisKey(roomId))
      if (raw) {
        const current = JSON.parse(raw) as { turnIdx: number; deadline: number }
        if (current.turnIdx !== expectedTurnIdx || current.deadline !== expectedDeadline) return
      }
    } catch { /* Redis unreachable — fall through to the local-only check below */ }

    const engineUrl = process.env.LUDO_ENGINE_URL || 'http://127.0.0.1:3011'
    const state = await this.getRoomState(roomId)
    if (!state || state.status === 'completed') return
    const turnIdx = state.current_turn ?? state.currentTurn ?? 0
    const cur = state.players?.[turnIdx]
    if (!cur || cur.is_bot) return // already handled elsewhere, or turn moved on

    // A real action for this exact turn is already in flight (it claimed the
    // instant the gateway received it — see handleLudoAction) — back off and
    // let that action's own result stand instead of racing it to the engine.
    if (await this.isLudoTurnClaimed(roomId, turnIdx)) return

    try {
      const awaiting = state.awaiting
      const res = awaiting === 'move'
        ? await fetch(`${engineUrl}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              room_id: roomId,
              user_id: cur.user_id,
              action: 'move_token',
              token_index: (state.movable_tokens ?? [])[0] ?? 0,
            }),
            signal: AbortSignal.timeout(5000),
          })
        : await fetch(`${engineUrl}/bot-turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId, user_id: cur.user_id }),
            signal: AbortSignal.timeout(5000),
          })
      if (!res.ok) return
      const data = await res.json() as any
      const newState = data.state
      await this.setRoomState(roomId, { ...newState, gameType: 'ludo' })
      this.hub.sendToUser(cur.user_id, 'error', {
        message: 'You took too long — your turn was played automatically.',
      })
      this.hub.sendToRoom(roomId, 'game:state_update', {
        room_id: roomId,
        state: newState,
        last_action: { user_id: cur.user_id, action: 'auto_afk', dice: data.dice ?? newState.dice, moved_token: data.moved_token },
        result: data.result ?? null,
      })
      if (data.result) { await this.handleLudoEnd(roomId, data.result); return }
      void this.driveLudoBots(roomId)
    } catch (e) {
      console.error('Ludo AFK auto-play failed', e)
    }
  }

  // Credit the Ludo winner and broadcast the final result to the room.
  async handleLudoEnd(roomId: string, result: any): Promise<void> {
    const afkTimer = this.ludoAfkTimers.get(roomId)
    if (afkTimer) { clearTimeout(afkTimer); this.ludoAfkTimers.delete(roomId) }
    this.redis.del(this.ludoAfkRedisKey(roomId)).catch(() => {})
    try {
      const parts = await this.db.query(
        'SELECT user_id, entry_fee_deducted, is_bot FROM game_participants WHERE room_id = $1',
        [roomId]
      )
      const players = parts.rows.map(r => ({
        user_id: r.user_id,
        entry_fee: parseFloat(r.entry_fee_deducted) || 0
      }))

      const effectiveWinnerId = result?.winner_id || null
      const effectivePrize    = effectiveWinnerId ? Number(result.prize) : 0

      console.log(`[gateway] handleLudoEnd room=${roomId} winner=${result?.winner_id} prize=${effectivePrize}`)

      // idempotency_key makes a retry safe (settle-game won't double-credit).
      // Previously a single failure here was only console.error'd with no
      // retry or record — a partial settlement failure (e.g. one loser's
      // locked stake failing to consume) went unnoticed and un-reconciled.
      const settlePayload = JSON.stringify({
        room_id: roomId,
        winner_id: effectiveWinnerId,
        prize: effectivePrize,
        players,
        idempotency_key: `settle_${roomId}`,
      })
      const callSettle = () => fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/settle-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: settlePayload,
      })

      let settleRes = await callSettle()
      let errBody = ''
      if (!settleRes.ok) {
        errBody = await settleRes.text().catch(() => '(unreadable)')
        console.error(`[gateway] settle-game failed ${settleRes.status} for Ludo room ${roomId}, retrying once:`, errBody)
        await new Promise(r => setTimeout(r, 2000))
        settleRes = await callSettle()
        if (!settleRes.ok) errBody = await settleRes.text().catch(() => '(unreadable)')
      }
      if (!settleRes.ok) {
        console.error(`[gateway] settle-game failed again ${settleRes.status} for Ludo room ${roomId}:`, errBody)
        try {
          await this.redis.rpush('ludo:reconcile:failed', JSON.stringify({
            room_id: roomId,
            winner_id: effectiveWinnerId,
            prize: effectivePrize,
            players,
            failed_at: Date.now(),
            reason: `settle-game HTTP ${settleRes.status}: ${errBody}`,
          }))
        } catch (redisErr) {
          console.error(`[RECONCILE-NEEDED] Could not record settle-game failure for room=${roomId}`, redisErr)
        }
      }
    } catch (e) {
      console.error('Failed to settle Ludo game', e)
      try {
        await this.redis.rpush('ludo:reconcile:failed', JSON.stringify({
          room_id: roomId,
          winner_id: result?.winner_id ?? null,
          prize: Number(result?.prize) || 0,
          failed_at: Date.now(),
          reason: `settle-game threw: ${e instanceof Error ? e.message : String(e)}`,
        }))
      } catch (redisErr) {
        console.error(`[RECONCILE-NEEDED] Could not record settle-game exception for room=${roomId}`, redisErr)
      }
    }

    monitorEmitter.emit('game_result', {
      game_type: 'ludo',
      room_id: roomId,
      winner_id: result?.winner_id,
      prize_amount: Number(result?.prize) || 0,
    })

    this.hub.sendToRoom(roomId, 'game:result', {
      room_id: roomId,
      winner_id: result.winner_id,
      prize: result.prize,
      rankings: result.rankings ?? [],
    })
  }

  async handleGameEnd(roomId: string, result: any, realPlayers: MatchmakingEntry[], state: any): Promise<void> {
    if (!result) return
    // Cancel any pending bot action / AFK timer for this room
    const bt = this.botTimers.get(roomId)
    if (bt) { clearTimeout(bt.timer); this.botTimers.delete(roomId) }
    const afk = this.teenPattiAfkTimers.get(roomId)
    if (afk) { clearTimeout(afk); this.teenPattiAfkTimers.delete(roomId) }
    this.redis.del(this.teenPattiAfkRedisKey(roomId)).catch(() => {})

    // Settle game via wallet service (consumes locked balance for all players, pays winner)
    try {
      const parts = await this.db.query(
        'SELECT user_id, entry_fee_deducted, is_bot FROM game_participants WHERE room_id = $1',
        [roomId]
      )

      const players = parts.rows.map(r => ({
        user_id: r.user_id,
        entry_fee: parseFloat(r.entry_fee_deducted) || 0,
      }))

      const effectiveWinnerId = result.winner_id || null
      const effectivePrize    = effectiveWinnerId ? Number(result.prize) : 0

      console.log(`[gateway] handleGameEnd room=${roomId} winner=${result.winner_id} prize=${effectivePrize}`)

      const walletUrl = process.env.WALLET_SERVICE_URL || 'http://localhost:3003'
      const settleRes = await fetch(`${walletUrl}/internal/wallet/settle-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
        body: JSON.stringify({
          room_id: roomId,
          winner_id: effectiveWinnerId,
          prize: effectivePrize,
          players,
          idempotency_key: `settle_${roomId}`,
        }),
      })
      if (!settleRes.ok) {
        const errBody = await settleRes.text().catch(() => '(unreadable)')
        console.error(`[gateway] settle-game failed ${settleRes.status} for room ${roomId}:`, errBody)
      } else {
        console.log(`[gateway] settle-game succeeded for room=${roomId} winner=${effectiveWinnerId} prize=${effectivePrize}`)
      }
    } catch (e) {
      console.error('[gateway] Failed to settle Teen Patti game', e)
    }

    monitorEmitter.emit('game_result', {
      game_type: state?.gameType ?? state?.game_type ?? 'teen_patti',
      room_id: roomId,
      winner_id: result.winner_id,
      prize_amount: Number(result.prize) || 0,
    })

    const winner = state.players?.find((p: any) => (p.userId ?? p.user_id ?? p.id) === result.winner_id)
    const winnerUsername = winner ? (winner.username ?? 'Player') : 'Unknown'

    // Ensure hand_rank has a fallback value
    const handRank = result.hand_rank || 'High Card'

    // Notify all real players of result
    for (const p of realPlayers) {
      try {
        this.hub.sendToUser(p.userId, 'game:result', {
          room_id: roomId,
          winner_id: result.winner_id,
          winner_username: winnerUsername,
          prize: result.prize,
          hand_rank: handRank,
          all_hands: result.all_hands ?? [],
        })
      } catch (e) {
        console.error(`[gateway] Failed to send game:result to user ${p.userId} for room ${roomId}:`, e)
      }
    }

    // Friends tables: re-open the private lobby / auto-start the next hand.
    this.onGameEnd?.(roomId)
  }
}
