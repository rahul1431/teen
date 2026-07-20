import { Pool } from 'pg'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from './agent-settlement'

// Runs the previous day's agent commission settlement once per day, shortly
// after midnight IST. Mirrors the setInterval-with-time-check pattern used
// by GameWatchdog (services/game-gateway/src/watchdog.ts) — no external cron
// infra needed. Idempotent: skips a date that already has ledger rows, so a
// missed/late tick or a process restart can never double-settle.
export class AgentSettlementJob {
  private static readonly CHECK_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes
  private static readonly TARGET_HOUR_IST = 0 // run between 00:00–00:30 IST
  private static readonly IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

  constructor(private db: Pool, private log: (msg: string) => void = console.log) {}

  start(): void {
    setInterval(() => {
      this.tick().catch(err => console.error('[agent-settlement] tick failed', err))
    }, AgentSettlementJob.CHECK_INTERVAL_MS)
    this.log('[agent-settlement] job started (checks every 5m, runs ~00:00-00:30 IST)')
  }

  private async tick(): Promise<void> {
    const nowIst = new Date(Date.now() + AgentSettlementJob.IST_OFFSET_MS)
    if (nowIst.getUTCHours() !== AgentSettlementJob.TARGET_HOUR_IST) return

    // Settle "yesterday" in IST terms.
    const yesterdayIst = new Date(nowIst)
    yesterdayIst.setUTCDate(yesterdayIst.getUTCDate() - 1)
    const dateStr = yesterdayIst.toISOString().slice(0, 10) // YYYY-MM-DD

    const alreadyRun = await this.db.query('SELECT 1 FROM agent_commission_ledger WHERE date = $1 LIMIT 1', [dateStr])
    if (alreadyRun.rows.length > 0) return // already settled this date

    await this.runSettlementForDate(dateStr)
  }

  async runSettlementForDate(dateStr: string): Promise<void> {
    const agentsRes = await this.db.query('SELECT id, parent_agent_id, commission_rate, status FROM agents')
    const agents: AgentNode[] = agentsRes.rows.map(r => ({
      id: r.id, parentAgentId: r.parent_agent_id, commissionRate: parseFloat(r.commission_rate), status: r.status,
    }))
    if (agents.length === 0) return

    // Net house win per player for the target IST day, attributed to their
    // direct agent. game_debit = player staked/lost, game_credit = player
    // won back — matches WalletService.TxnType (services/wallet-service/src/wallet.service.ts:5).
    const lossesRes = await this.db.query(
      `SELECT u.agent_id,
              COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0) AS net_house_win
       FROM wallet_transactions wt
       JOIN users u ON u.id = wt.user_id
       WHERE u.agent_id IS NOT NULL
         AND wt.type IN ('game_debit', 'game_credit')
         AND wt.created_at >= ($1::date AT TIME ZONE 'Asia/Kolkata')
         AND wt.created_at <  (($1::date + 1) AT TIME ZONE 'Asia/Kolkata')
       GROUP BY u.agent_id`,
      [dateStr]
    )
    const playerLosses: PlayerNetLoss[] = lossesRes.rows.map(r => ({ agentId: r.agent_id, netHouseWin: parseFloat(r.net_house_win) }))

    const results = calculateDailySettlement(agents, playerLosses)
    if (results.length === 0) return

    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const r of results) {
        await client.query(
          `INSERT INTO agent_commission_ledger (agent_id, date, direct_commission, override_commission, total_commission)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id, date) DO NOTHING`,
          [r.agentId, dateStr, r.directCommission, r.overrideCommission, r.totalCommission]
        )
        if (r.totalCommission > 0) {
          await client.query(
            `UPDATE agent_wallets SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE agent_id = $2`,
            [r.totalCommission, r.agentId]
          )
        }
      }
      await client.query('COMMIT')
      this.log(`[agent-settlement] settled ${dateStr}: ${results.length} agent(s)`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
