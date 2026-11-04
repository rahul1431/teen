import { Pool } from 'pg'
import { FinancialMetrics, PendingWithdrawal } from './types'

export class FinanceAnalytics {
  constructor(private db: Pool) {}

  public async getDailyMetrics(): Promise<FinancialMetrics> {
    try {
      // 1. Deposits today
      const depRes = await this.db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) AS total,
          COUNT(*) AS count
        FROM payment_orders
        WHERE type = 'deposit'
          AND status = 'completed'
          AND created_at >= CURRENT_DATE
      `)

      // 2. Withdrawals today (completed)
      const wthRes = await this.db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) AS total,
          COUNT(*) AS count
        FROM payment_orders
        WHERE type = 'withdrawal'
          AND status = 'completed'
          AND created_at >= CURRENT_DATE
      `)

      // 3. Pending Withdrawals
      const pendingRes = await this.db.query(`
        SELECT 
          COALESCE(SUM(amount), 0) AS total,
          COUNT(*) AS count
        FROM payment_orders
        WHERE type = 'withdrawal'
          AND status IN ('pending', 'created')
      `)

      // 4. Active players today
      const activeRes = await this.db.query(`
        SELECT COUNT(DISTINCT user_id) AS active_count
        FROM wallet_transactions
        WHERE created_at >= CURRENT_DATE
      `)

      const totalDeposits = parseFloat(depRes.rows[0]?.total || '0')
      const depositsCount = parseInt(depRes.rows[0]?.count || '0', 10)
      const totalWithdrawals = parseFloat(wthRes.rows[0]?.total || '0')
      const withdrawalsCount = parseInt(wthRes.rows[0]?.count || '0', 10)
      const pendingWithdrawalsSum = parseFloat(pendingRes.rows[0]?.total || '0')
      const pendingWithdrawalsCount = parseInt(pendingRes.rows[0]?.count || '0', 10)
      const activePlayersToday = parseInt(activeRes.rows[0]?.active_count || '0', 10)

      return {
        period: new Date().toISOString().split('T')[0],
        totalDeposits,
        depositsCount,
        totalWithdrawals,
        withdrawalsCount,
        netMargin: totalDeposits - totalWithdrawals,
        activePlayersToday,
        pendingWithdrawalsCount,
        pendingWithdrawalsSum
      }
    } catch (err: any) {
      console.error('[FinanceAnalytics] Query error:', err.message)
      return {
        period: new Date().toISOString().split('T')[0],
        totalDeposits: 0,
        depositsCount: 0,
        totalWithdrawals: 0,
        withdrawalsCount: 0,
        netMargin: 0,
        activePlayersToday: 0,
        pendingWithdrawalsCount: 0,
        pendingWithdrawalsSum: 0
      }
    }
  }

  public async getPendingWithdrawals(limit = 5): Promise<PendingWithdrawal[]> {
    try {
      const res = await this.db.query(
        `
        SELECT 
          p.id,
          p.user_id,
          u.username,
          u.phone,
          p.amount,
          p.created_at,
          COALESCE(
            (SELECT COUNT(*) FROM fraud_events f WHERE f.user_id::text = p.user_id::text), 
            0
          ) as fraud_events_count
        FROM payment_orders p
        JOIN users u ON u.id = p.user_id
        WHERE p.type = 'withdrawal'
          AND p.status IN ('pending', 'created')
        ORDER BY p.amount DESC, p.created_at ASC
        LIMIT $1
      `,
        [limit]
      )

      return res.rows.map((row) => {
        const fraudCount = parseInt(row.fraud_events_count || '0', 10)
        const reasons: string[] = []
        let riskScore = 10

        if (parseFloat(row.amount) > 10000) {
          riskScore += 30
          reasons.push('High value withdrawal (> ₹10,000)')
        }
        if (fraudCount > 0) {
          riskScore += 40
          reasons.push(`User has ${fraudCount} recorded fraud alert(s)`)
        }

        return {
          id: row.id,
          userId: row.user_id,
          userName: row.username || row.phone || 'Player',
          amount: parseFloat(row.amount),
          requestedAt: row.created_at,
          riskScore: Math.min(riskScore, 100),
          riskReasons: reasons.length ? reasons : ['Normal pattern']
        }
      })
    } catch (err: any) {
      console.error('[FinanceAnalytics] Pending withdrawals query error:', err.message)
      return []
    }
  }

  public async approveWithdrawal(orderId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.db.query(
        "UPDATE payment_orders SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'created') RETURNING id, amount",
        [orderId]
      )
      if (res.rowCount === 0) {
        return { success: false, message: 'Withdrawal not found or already processed' }
      }
      await this.db.query(
        "UPDATE wallet_transactions SET status = 'completed', description = 'Withdrawal approved by AI Guardian' WHERE reference_id = $1 AND type = 'withdrawal'",
        [orderId]
      )
      return { success: true, message: `Withdrawal ${orderId} (₹${res.rows[0].amount}) approved and marked paid.` }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  }

  public async rejectWithdrawal(orderId: string, reason = 'Flagged by AI Risk Guardian'): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.db.query(
        "UPDATE payment_orders SET status = 'refunded', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'created') RETURNING id, user_id, amount",
        [orderId]
      )
      if (res.rowCount === 0) {
        return { success: false, message: 'Withdrawal not found or already processed' }
      }
      const { user_id, amount } = res.rows[0]
      await this.db.query(
        "UPDATE wallet_transactions SET status = 'reversed', description = $1 WHERE reference_id = $2 AND type = 'withdrawal'",
        [`Withdrawal rejected: ${reason}`, orderId]
      )
      // Refund balance back to user
      await this.db.query(
        "UPDATE wallets SET real_balance = real_balance + $1, updated_at = NOW() WHERE user_id = $2",
        [amount, user_id]
      )
      return { success: true, message: `Withdrawal ${orderId} rejected. ₹${amount} refunded back to user balance.` }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  }
}
