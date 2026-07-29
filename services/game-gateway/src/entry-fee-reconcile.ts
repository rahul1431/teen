import { Pool } from 'pg'
import Redis from 'ioredis'

// Wallet lock succeeds, then this bookkeeping UPDATE is supposed to mirror
// it in game_participants.entry_fee_deducted — the column the idle-room
// watchdog and admin terminate endpoint both use to decide refund amounts.
// A transient DB failure here used to just get logged and ignored, silently
// under-reporting locked funds with no path to ever reconcile the gap (see
// docs/Bugs/entry-fee-deducted-update-silently-swallowed.md). This retries
// once, then durably records the discrepancy for an out-of-band sweep,
// mirroring the ludo:reconcile:failed pattern already used for settlement
// failures.
export async function applyEntryFeeDelta(
  db: Pool,
  redis: Redis,
  params: { room_id: string; user_id: string; delta: number; isBot: boolean },
): Promise<void> {
  const { room_id, user_id, delta, isBot } = params
  const run = () =>
    db.query(
      'UPDATE game_participants SET entry_fee_deducted = entry_fee_deducted + $1 WHERE room_id = $2 AND user_id = $3',
      [delta, room_id, user_id],
    )

  try {
    await run()
    return
  } catch (firstErr) {
    console.error(`[gateway] Failed to update entry_fee_deducted for room=${room_id} user=${user_id}, retrying once`, firstErr)
  }

  try {
    await new Promise(r => setTimeout(r, 250))
    await run()
    return
  } catch (secondErr) {
    console.error(`[gateway] entry_fee_deducted update failed again for room=${room_id} user=${user_id}`, secondErr)
    try {
      await redis.rpush('gateway:reconcile:entry_fee_deducted', JSON.stringify({
        room_id,
        user_id,
        delta,
        is_bot: isBot,
        failed_at: Date.now(),
        reason: secondErr instanceof Error ? secondErr.message : String(secondErr),
      }))
    } catch (redisErr) {
      console.error(`[RECONCILE-NEEDED] Could not record entry_fee_deducted failure for room=${room_id} user=${user_id} delta=${delta}`, redisErr)
    }
  }
}
