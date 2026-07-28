import { Pool } from 'pg'
import { Redis } from 'ioredis'
import { RealtimeHub } from './realtime'

// Reaps abandoned games: rooms stuck 'waiting'/'active' with no action for
// IDLE_MS get their unconsumed entry-fee locks refunded and are cancelled.
// Gateway restarts, engine outages, and all-players-disconnected games all
// previously left rooms active forever with player money locked.
//
// Liveness signal: `game:lastaction:<roomId>` in Redis, touched on game start
// and on every human/bot action. A room is reaped only when it is older than
// IDLE_MS AND its lastaction key is missing or older than IDLE_MS.
export class GameWatchdog {
  private static readonly IDLE_MS = 15 * 60 * 1000
  private static readonly SWEEP_MS = 5 * 60 * 1000
  // Completed-room reconcile window: skip rooms younger than this (settle-game
  // may still be in flight) and older than this (bound the query; anything
  // this stale has almost certainly already been caught by an earlier sweep).
  private static readonly RECONCILE_MIN_AGE_MS = 2 * 60 * 1000
  private static readonly RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000
  private static readonly LUDO_QUEUE_KEY = 'ludo:reconcile:failed'
  private static readonly LUDO_QUEUE_BATCH = 20

  constructor(private db: Pool, private redis: Redis, private hub: RealtimeHub) {}

  start(): void {
    setInterval(() => {
      this.sweep().catch(err => console.error('[watchdog] sweep failed', err))
      this.reconcileCompletedRooms().catch(err => console.error('[watchdog] reconcile sweep failed', err))
      this.drainLudoReconcileQueue().catch(err => console.error('[watchdog] ludo reconcile drain failed', err))
    }, GameWatchdog.SWEEP_MS)
    console.log('[watchdog] started (idle=15m, sweep=5m, reconcile+ludo-drain on same cadence)')
  }

  static async touch(redis: Redis, roomId: string): Promise<void> {
    try {
      await redis.set(`game:lastaction:${roomId}`, Date.now().toString(), 'EX', 7200)
    } catch { /* liveness marker only — never block gameplay */ }
  }

  private async sweep(): Promise<void> {
    const rooms = await this.db.query(
      `SELECT id, game_type FROM game_rooms
       WHERE status IN ('waiting', 'active')
         AND created_at < NOW() - INTERVAL '15 minutes'`
    )
    for (const room of rooms.rows) {
      const last = await this.redis.get(`game:lastaction:${room.id}`)
      if (last && Date.now() - Number(last) < GameWatchdog.IDLE_MS) continue
      await this.reap(room.id, room.game_type, last)
    }
  }

  private async reap(roomId: string, gameType: string, lastActionAtSweep: string | null): Promise<void> {
    console.log(`[watchdog] reaping idle room=${roomId} (${gameType})`)

    // Re-check liveness before doing anything irreversible — a player may have
    // acted (and refreshed game:lastaction) between sweep() reading it and now.
    // Abort here means zero wallet calls and zero DB writes for this room.
    const lastActionNow = await this.redis.get(`game:lastaction:${roomId}`)
    if (lastActionNow !== lastActionAtSweep) {
      console.log(`[watchdog] intercepted reap for room=${roomId}: lastaction changed since sweep, room is live — aborting`)
      return
    }

    const refunds: Array<{ user_id: string; username: string; is_bot: boolean; amount: number }> = []
    const parts = await this.db.query(
      `SELECT gp.user_id, gp.entry_fee_deducted, gp.is_bot, u.username
       FROM game_participants gp JOIN users u ON u.id = gp.user_id
       WHERE gp.room_id = $1`,
      [roomId]
    )
    for (const p of parts.rows) {
      const fee = parseFloat(p.entry_fee_deducted) || 0
      if (fee <= 0) continue
      // Refund only locks this room never consumed (settled games keep their
      // consume:<room>:<user> transaction; unlock itself is idempotent too).
      const consumed = await this.db.query(
        'SELECT 1 FROM wallet_transactions WHERE idempotency_key = $1',
        [`consume:${roomId}:${p.user_id}`]
      )
      if (consumed.rows.length) continue
      try {
        const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: p.user_id, amount: fee, room_id: roomId }),
        })
        if (!res.ok) {
          console.error(`[watchdog] unlock failed user=${p.user_id} room=${roomId}: ${res.status}`)
          continue
        }
        console.log(`[watchdog] refunded ₹${fee} to user=${p.user_id} room=${roomId}`)
        refunds.push({ user_id: p.user_id, username: p.username, is_bot: p.is_bot, amount: fee })
      } catch (err) {
        console.error(`[watchdog] unlock error user=${p.user_id} room=${roomId}`, err)
        continue
      }
    }
    await this.db.query("UPDATE game_rooms SET status = 'cancelled' WHERE id = $1", [roomId])
    await this.redis.del(`game:room:${roomId}`, `game:lastaction:${roomId}`, `private:room:${roomId}`)
    this.hub.sendToRoom(roomId, 'error', { message: 'Game cancelled due to inactivity — entry fee refunded' })

    // Event log — surfaced in the admin panel's AI Control Center.
    try {
      const total = refunds.reduce((s, r) => s + r.amount, 0)
      await this.db.query(
        `INSERT INTO watchdog_events (room_id, game_type, action, refunds, total_refunded)
         VALUES ($1, $2, 'reaped', $3, $4)`,
        [roomId, gameType, JSON.stringify(refunds), total]
      )
    } catch (err) {
      console.error('[watchdog] failed to log event', err)
    }
  }

  // Completed games settle via POST /internal/wallet/settle-game, which
  // consumes each player's locked stake independently and non-fatally — a
  // transient failure for one player doesn't fail the whole call, so the
  // room finishes 'completed' and the winner gets paid while a loser's stake
  // stays stuck in locked_balance forever with no other recovery path (the
  // idle-room sweep above only scans 'waiting'/'active' rooms, never
  // 'completed' ones). This sweep catches those orphaned locks and retries
  // the consume. See docs/Bugs/failed-settle-game-consume-permanently-strands-locked-funds.md.
  private async reconcileCompletedRooms(): Promise<void> {
    const rooms = await this.db.query(
      `SELECT id, game_type FROM game_rooms
       WHERE status = 'completed'
         AND ended_at < NOW() - INTERVAL '2 minutes'
         AND ended_at > NOW() - INTERVAL '24 hours'`
    )
    for (const room of rooms.rows) {
      await this.reconcileRoom(room.id, room.game_type)
    }
  }

  private async reconcileRoom(roomId: string, gameType: string): Promise<void> {
    const parts = await this.db.query(
      `SELECT gp.user_id, gp.entry_fee_deducted, gp.is_bot, u.username
       FROM game_participants gp JOIN users u ON u.id = gp.user_id
       WHERE gp.room_id = $1`,
      [roomId]
    )
    const stranded: Array<{ user_id: string; username: string; is_bot: boolean; amount: number }> = []
    for (const p of parts.rows) {
      const fee = parseFloat(p.entry_fee_deducted) || 0
      if (fee <= 0) continue
      const consumed = await this.db.query(
        'SELECT 1 FROM wallet_transactions WHERE idempotency_key = $1',
        [`consume:${roomId}:${p.user_id}`]
      )
      if (consumed.rows.length) continue
      stranded.push({ user_id: p.user_id, username: p.username, is_bot: p.is_bot, amount: fee })
    }
    if (!stranded.length) return

    console.error(`[watchdog] RECONCILE: room=${roomId} (${gameType}) has ${stranded.length} stranded locked-fund entr${stranded.length === 1 ? 'y' : 'ies'} — retrying consume`)
    const results: Array<{ user_id: string; username: string; is_bot: boolean; amount: number; ok: boolean }> = []
    for (const s of stranded) {
      let ok = false
      try {
        const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ user_id: s.user_id, amount: s.amount, room_id: roomId }),
        })
        ok = res.ok
        if (ok) console.log(`[watchdog] reconciled stranded consume user=${s.user_id} room=${roomId} amount=${s.amount}`)
        else console.error(`[watchdog] reconcile consume still failing user=${s.user_id} room=${roomId}: ${res.status} — will retry next sweep`)
      } catch (err) {
        console.error(`[watchdog] reconcile consume error user=${s.user_id} room=${roomId}`, err)
      }
      results.push({ ...s, ok })
    }

    try {
      const total = results.filter(r => r.ok).reduce((s, r) => s + r.amount, 0)
      await this.db.query(
        `INSERT INTO watchdog_events (room_id, game_type, action, refunds, total_refunded)
         VALUES ($1, $2, 'reconciled_stranded_consume', $3, $4)`,
        [roomId, gameType, JSON.stringify(results), total]
      )
    } catch (err) {
      console.error('[watchdog] failed to log reconcile event', err)
    }
  }

  // Drains services/game-gateway's own `ludo:reconcile:failed` queue — pushed
  // to (but never read from anywhere) when a whole settle-game call fails for
  // Ludo after its inline retry. Re-derives fresh participant data at drain
  // time rather than trusting the queued snapshot (which may predate a schema
  // change, or lack `players` entirely if the original failure happened
  // before that array was computed). idempotency_key makes re-settling safe.
  private async drainLudoReconcileQueue(): Promise<void> {
    for (let i = 0; i < GameWatchdog.LUDO_QUEUE_BATCH; i++) {
      const raw = await this.redis.lpop(GameWatchdog.LUDO_QUEUE_KEY)
      if (!raw) return

      let entry: { room_id: string; winner_id: string | null; prize: number; reason?: string }
      try {
        entry = JSON.parse(raw)
      } catch {
        console.error('[watchdog] ludo reconcile: unparseable queue entry, dropping:', raw)
        continue
      }
      const { room_id, winner_id, prize, reason } = entry

      try {
        const parts = await this.db.query(
          'SELECT user_id, entry_fee_deducted FROM game_participants WHERE room_id = $1',
          [room_id]
        )
        if (!parts.rows.length) {
          console.error(`[watchdog] ludo reconcile: room=${room_id} has no participants — dropping stale entry (reason: ${reason})`)
          continue
        }
        const players = parts.rows.map(r => ({ user_id: r.user_id, entry_fee: parseFloat(r.entry_fee_deducted) || 0 }))
        const res = await fetch(`${process.env.WALLET_SERVICE_URL}/internal/wallet/settle-game`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY! },
          body: JSON.stringify({ room_id, winner_id: winner_id ?? null, prize: Number(prize) || 0, players, idempotency_key: `settle_${room_id}` }),
        })
        if (res.ok) {
          const body = await res.json().catch(() => null) as { consume_errors?: string[] } | null
          if (body?.consume_errors?.length) {
            console.error(`[watchdog] ludo reconcile: room=${room_id} settled but consume still failing for [${body.consume_errors.join(', ')}] — the completed-room reconcile sweep will retry those`)
          } else {
            console.log(`[watchdog] ludo reconcile: room=${room_id} settled successfully (was queued: ${reason})`)
          }
        } else {
          console.error(`[watchdog] ludo reconcile: room=${room_id} still failing (${res.status}) — re-queueing for next sweep`)
          await this.redis.rpush(GameWatchdog.LUDO_QUEUE_KEY, raw)
          return // stop this cycle rather than hot-looping on a persistently-broken entry
        }
      } catch (err) {
        console.error(`[watchdog] ludo reconcile: error processing room=${room_id}`, err)
        await this.redis.rpush(GameWatchdog.LUDO_QUEUE_KEY, raw)
        return
      }
    }
  }
}
