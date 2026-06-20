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

      // Check idempotency
      const existing = await c.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [ikey])
      if (existing.rows.length > 0) return

      // Lock wallet row
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

  // Lock funds before game starts (moves to locked_balance)
  async lockForGame(userId: string, amount: number, roomId: string): Promise<void> {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query(
        'SELECT real_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      )
      if (!res.rows.length) throw new Error('Wallet not found')
      const balance = parseFloat(res.rows[0].real_balance)
      if (balance < amount) throw new Error('Insufficient balance')

      await client.query(
        'UPDATE wallets SET real_balance = real_balance - $1, locked_balance = locked_balance + $1 WHERE user_id = $2',
        [amount, userId]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // Release locked funds back (on game cancel / player exit)
  async unlockFunds(userId: string, amount: number): Promise<void> {
    await this.db.query(
      'UPDATE wallets SET real_balance = real_balance + $1, locked_balance = locked_balance - $1 WHERE user_id = $2',
      [amount, userId]
    )
  }

  async getTransactions(userId: string, limit = 20, offset = 0) {
    const res = await this.db.query(
      `SELECT id, type, wallet_type, amount, balance_after, reference_id, description, created_at
       FROM wallet_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
    return res.rows
  }
}
