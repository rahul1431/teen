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

  constructor(private db: Pool, private redis: Redis, private hub: RealtimeHub) {}

  start(): void {
    setInterval(() => {
      this.sweep().catch(err => console.error('[watchdog] sweep failed', err))
    }, GameWatchdog.SWEEP_MS)
    console.log('[watchdog] started (idle=15m, sweep=5m)')
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
      await this.reap(room.id, room.game_type)
    }
  }

  private async reap(roomId: string, gameType: string): Promise<void> {
    console.log(`[watchdog] reaping idle room=${roomId} (${gameType})`)
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
}
