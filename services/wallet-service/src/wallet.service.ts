import { Pool, PoolClient } from 'pg'
import crypto from 'crypto'

export type TxnType = 'deposit' | 'withdrawal' | 'game_credit' | 'game_debit' | 'bonus' | 'referral' | 'manual_credit' | 'manual_debit'
export type WalletType = 'real' | 'bonus'

interface CreditDebitOptions {
  userId: string
  amount: number
  type: TxnType
  walletType?: WalletType
  referenceId?: string
  description?: string
  idempotencyKey?: string
}

export class WalletService {
  constructor(private db: Pool) {}

  async getBalance(userId: string) {
    const res = await this.db.query(
      'SELECT real_balance, bonus_balance, locked_balance FROM wallets WHERE user_id = $1',
      [userId]
    )
    if (!res.rows.length) throw new Error('Wallet not found')
    return res.rows[0]
  }

  async credit(opts: CreditDebitOptions, client?: PoolClient): Promise<void> {
    const c = client || await this.db.connect()
    const shouldRelease = !client
    const ikey = opts.idempotencyKey || crypto.randomUUID()

    try {
      if (!client) await c.query('BEGIN')

      // Idempotency: skip if already processed
      const existing = await c.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey])
      if (existing.rows.length > 0) return

      const walletRes = await c.query(
        'SELECT real_balance, bonus_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [opts.userId]
      )
      if (!walletRes.rows.length) throw new Error('Wallet not found')
      const wallet = walletRes.rows[0]

      const col = opts.walletType === 'bonus' ? 'bonus_balance' : 'real_balance'
      const balanceBefore = parseFloat(wallet[col])
      const balanceAfter = balanceBefore + opts.amount

      await c.query(
        `UPDATE wallets SET ${col} = $1, updated_at = NOW() WHERE user_id = $2`,
        [balanceAfter, opts.userId]
      )

      if (opts.type === 'deposit') {
        await c.query(
          'UPDATE wallets SET total_deposited = total_deposited + $1 WHERE user_id = $2',
          [opts.amount, opts.userId]
        )
      }
      if (opts.type === 'game_credit') {
        await c.query(
          'UPDATE wallets SET total_won = total_won + $1 WHERE user_id = $2',
          [opts.amount, opts.userId]
        )
      }

      await c.query(
        `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)`,
        [opts.userId, opts.type, opts.walletType || 'real', opts.amount, balanceBefore, balanceAfter, opts.referenceId, ikey, opts.description]
      )

      if (!client) await c.query('COMMIT')
    } catch (err) {
      if (!client) await c.query('ROLLBACK')
      throw err
    } finally {
      if (shouldRelease) c.release()
    }
  }

  async debit(opts: CreditDebitOptions, client?: PoolClient): Promise<void> {
    const c = client || await this.db.connect()
    const shouldRelease = !client
    const ikey = opts.idempotencyKey || crypto.randomUUID()

    try {
      if (!client) await c.query('BEGIN')

      const existing = await c.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey])
      if (existing.rows.length > 0) return

      const walletRes = await c.query(
        'SELECT real_balance, bonus_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [opts.userId]
      )
      if (!walletRes.rows.length) throw new Error('Wallet not found')
      const wallet = walletRes.rows[0]

      const col = opts.walletType === 'bonus' ? 'bonus_balance' : 'real_balance'
      const balanceBefore = parseFloat(wallet[col])
      if (balanceBefore < opts.amount) throw new Error('Insufficient balance')
      const balanceAfter = balanceBefore - opts.amount

      await c.query(
        `UPDATE wallets SET ${col} = $1, updated_at = NOW() WHERE user_id = $2`,
        [balanceAfter, opts.userId]
      )

      if (opts.type === 'withdrawal') {
        await c.query(
          'UPDATE wallets SET total_withdrawn = total_withdrawn + $1 WHERE user_id = $2',
          [opts.amount, opts.userId]
        )
      }

      await c.query(
        `INSERT INTO wallet_transactions (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)`,
        [opts.userId, opts.type, opts.walletType || 'real', opts.amount, balanceBefore, balanceAfter, opts.referenceId, ikey, opts.description]
      )

      if (!client) await c.query('COMMIT')
    } catch (err) {
      if (!client) await c.query('ROLLBACK')
      throw err
    } finally {
      if (shouldRelease) c.release()
    }
  }

  // Lock funds before game starts (moves real_balance → locked_balance).
  // Idempotent: same roomId+userId+betSeq combo is a no-op on retry.
  async lockForGame(userId: string, amount: number, roomId: string, betSeq = 0): Promise<void> {
    const ikey = `lock:${roomId}:${userId}:${betSeq}`
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')

      // Idempotency: skip if already locked for this bet in this room
      const existing = await client.query(
        'SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey]
      )
      if (existing.rows.length > 0) { await client.query('COMMIT'); return }

      const res = await client.query(
        'SELECT real_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      )
      if (!res.rows.length) throw new Error('Wallet not found')
      const balanceBefore = parseFloat(res.rows[0].real_balance)
      if (balanceBefore < amount) throw new Error('Insufficient balance')
      const balanceAfter = balanceBefore - amount

      await client.query(
        'UPDATE wallets SET real_balance = real_balance - $1, locked_balance = locked_balance + $1 WHERE user_id = $2',
        [amount, userId]
      )

      // Log every lock in wallet_transactions for full audit trail
      await client.query(
        `INSERT INTO wallet_transactions
           (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, 'game_debit', 'real', $2, $3, $4, $5, $6, 'pending', 'Funds locked for game')`,
        [userId, amount, balanceBefore, balanceAfter, roomId, ikey]
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // Release locked funds back to real_balance (game cancelled / player disconnected).
  // Idempotent: roomId+userId key means safe to retry.
  async unlockFunds(userId: string, amount: number, roomId: string, client?: PoolClient): Promise<void> {
    const c = client || await this.db.connect()
    const shouldRelease = !client
    const ikey = `unlock:${roomId}:${userId}`
    try {
      if (!client) await c.query('BEGIN')

      // Idempotency check
      const existing = await c.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey])
      if (existing.rows.length > 0) { if (!client) await c.query('COMMIT'); return }

      const walletRes = await c.query(
        'SELECT locked_balance, real_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      )
      if (!walletRes.rows.length) throw new Error('Wallet not found')
      const wallet = walletRes.rows[0]
      const locked = parseFloat(wallet.locked_balance)

      // Clamp — avoid throwing on minor rounding discrepancies
      const toUnlock = Math.min(locked, amount)
      if (toUnlock <= 0) { if (!client) await c.query('COMMIT'); return }

      if (locked < amount) {
        console.warn(`[wallet] unlockFunds: user=${userId} locked=${locked} < amount=${amount} — unlocking ${toUnlock} (clamped)`)
      }

      const balanceBefore = parseFloat(wallet.real_balance)
      const balanceAfter = balanceBefore + toUnlock

      await c.query(
        'UPDATE wallets SET real_balance = real_balance + $1, locked_balance = locked_balance - $2, updated_at = NOW() WHERE user_id = $3',
        [toUnlock, toUnlock, userId]
      )

      await c.query(
        `INSERT INTO wallet_transactions
           (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, 'game_credit', 'real', $2, $3, $4, $5, $6, 'completed', 'Locked funds unlocked/refunded')`,
        [userId, toUnlock, balanceBefore, balanceAfter, roomId, ikey]
      )

      if (!client) await c.query('COMMIT')
    } catch (err) {
      if (!client) await c.query('ROLLBACK')
      throw err
    } finally {
      if (shouldRelease) c.release()
    }
  }

  // Consume locked funds when a game is settled (locked_balance -= totalBet, money is lost/spent).
  // roomId makes the key deterministic so retries are safe.
  async consumeLockedFunds(userId: string, amount: number, client?: PoolClient, roomId?: string): Promise<void> {
    const c = client || await this.db.connect()
    const shouldRelease = !client
    const ikey = roomId ? `consume:${roomId}:${userId}` : crypto.randomUUID()
    try {
      if (!client) await c.query('BEGIN')

      // Idempotency check
      const existing = await c.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey])
      if (existing.rows.length > 0) { if (!client) await c.query('COMMIT'); return }

      const walletRes = await c.query(
        'SELECT locked_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      )
      if (!walletRes.rows.length) throw new Error('Wallet not found')
      const locked = parseFloat(walletRes.rows[0].locked_balance)

      // Clamp — handles edge-case discrepancies without crashing settlement
      const toConsume = Math.min(locked, amount)
      if (toConsume <= 0) { if (!client) await c.query('COMMIT'); return }

      if (locked < amount) {
        console.warn(`[wallet] consumeLockedFunds: user=${userId} locked=${locked} < amount=${amount} — consuming ${toConsume} (clamped)`)
      }

      await c.query(
        'UPDATE wallets SET locked_balance = locked_balance - $1, updated_at = NOW() WHERE user_id = $2',
        [toConsume, userId]
      )

      await c.query(
        `INSERT INTO wallet_transactions
           (user_id, type, wallet_type, amount, balance_before, balance_after, reference_id, idempotency_key, status, description)
         VALUES ($1, 'game_debit', 'real', $2, $3, $4, $5, $6, 'completed', 'Locked funds consumed by gameplay')`,
        [userId, toConsume, locked, locked - toConsume, roomId ?? null, ikey]
      )

      if (!client) await c.query('COMMIT')
    } catch (err) {
      if (!client) await c.query('ROLLBACK')
      throw err
    } finally {
      if (shouldRelease) c.release()
    }
  }

  async getTransactions(userId: string, limit = 20, offset = 0) {
    const res = await this.db.query(
      `SELECT id, type, wallet_type, amount, balance_before, balance_after, reference_id, description, status, created_at
       FROM wallet_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
    return res.rows
  }
}
