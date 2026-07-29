// services/core-api-service/src/helpers/mission-metrics.test.ts
import { pool } from '../db/pool'
import crypto from 'crypto'
import { getDepositSum, getReferralCount, getGamePlayedCount } from './mission-metrics'

async function createTestUser(): Promise<string> {
  const phone = `9${crypto.randomInt(100000000, 999999999)}`
  const res = await pool.query(
    `INSERT INTO users (phone, username, referral_code) VALUES ($1, $2, $3) RETURNING id`,
    [phone, `test_${phone}`, `REF${phone.slice(-6)}`],
  )
  return res.rows[0].id
}

describe('getDepositSum', () => {
  it('sums only completed deposits within the window', async () => {
    const userId = await createTestUser()
    await pool.query(
      `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status)
       VALUES
       ($1, 'deposit', 'real', 500, 0, 500, $2, 'completed'),
       ($1, 'deposit', 'real', 600, 500, 1100, $3, 'pending'),
       ($1, 'withdrawal', 'real', 200, 1100, 900, $4, 'completed')`,
      [userId, `dep1_${userId}`, `dep2_${userId}`, `wd1_${userId}`],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    const sum = await getDepositSum(userId, start, end)
    expect(sum).toBe(500) // pending deposit and the withdrawal are excluded
  })

  it('excludes deposits outside the window', async () => {
    const userId = await createTestUser()
    await pool.query(
      `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, idempotency_key, status, created_at)
       VALUES ($1, 'deposit', 'real', 1000, 0, 1000, $2, 'completed', NOW() - INTERVAL '10 days')`,
      [userId, `old_dep_${userId}`],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getDepositSum(userId, start, end)).toBe(0)
  })
})

describe('getReferralCount', () => {
  it('counts only qualified/rewarded referrals in the window', async () => {
    const referrer = await createTestUser()
    const rewarded = await createTestUser()
    const pending = await createTestUser()
    await pool.query(
      `INSERT INTO referrals (referrer_id, referee_id, status, qualified_at) VALUES ($1, $2, 'rewarded', NOW())`,
      [referrer, rewarded],
    )
    await pool.query(
      `INSERT INTO referrals (referrer_id, referee_id, status) VALUES ($1, $2, 'pending')`,
      [referrer, pending],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getReferralCount(referrer, start, end)).toBe(1)
  })
})

describe('getGamePlayedCount', () => {
  it('counts non-bot games of the given type with stake >= minStake in the window', async () => {
    const userId = await createTestUser()
    const highStakeRoom = (await pool.query(
      `INSERT INTO game_rooms (game_type, entry_fee) VALUES ('ludo', 50) RETURNING id`,
    )).rows[0].id
    const lowStakeRoom = (await pool.query(
      `INSERT INTO game_rooms (game_type, entry_fee) VALUES ('ludo', 10) RETURNING id`,
    )).rows[0].id
    await pool.query(
      `INSERT INTO game_participants (room_id, user_id, seat_number, is_bot) VALUES ($1, $2, 0, false)`,
      [highStakeRoom, userId],
    )
    await pool.query(
      `INSERT INTO game_participants (room_id, user_id, seat_number, is_bot) VALUES ($1, $2, 0, false)`,
      [lowStakeRoom, userId],
    )
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    expect(await getGamePlayedCount(userId, 'ludo', 50, start, end)).toBe(1)
    expect(await getGamePlayedCount(userId, 'ludo', null, start, end)).toBe(2)
  })
})
