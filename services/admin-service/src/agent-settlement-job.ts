import { Pool } from 'pg'
import { calculateDailySettlement, AgentNode, PlayerNetLoss, AgentSettlementResult } from './agent-settlement'

// Synchronizes commission for a specific date (default: today IST).
// Idempotent: checks existing total_commission in agent_commission_ledger and
// credits only the newly earned delta into agent_wallets (balance & total_earned).
export async function syncRealtimeCommissionForDate(
  db: Pool,
  dateStr?: string,
  log: (msg: string) => void = console.log
): Promise<AgentSettlementResult[]> {
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const targetDate = dateStr || nowIst.toISOString().slice(0, 10)

  const agentsRes = await db.query('SELECT id, parent_agent_id, commission_rate, game_commissions, status FROM agents')
  const agents: AgentNode[] = agentsRes.rows.map(r => {
    let gameCommissions: Record<string, number> = {}
    try {
      if (typeof r.game_commissions === 'string') {
        gameCommissions = JSON.parse(r.game_commissions)
      } else if (r.game_commissions && typeof r.game_commissions === 'object') {
        gameCommissions = r.game_commissions
      }
    } catch (_) {}
    return {
      id: r.id,
      parentAgentId: r.parent_agent_id,
      commissionRate: parseFloat(r.commission_rate),
      gameCommissions,
      status: r.status,
    }
  })
  if (agents.length === 0) return []

  const lossesRes = await db.query(
    `SELECT u.agent_id,
            CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' 
                 WHEN wt.description ILIKE '%matka%' THEN 'matka' 
                 WHEN wt.description ILIKE '%cricket%' THEN 'cricket' 
                 WHEN wt.description ILIKE '%aviator%' THEN 'aviator' 
                 ELSE COALESCE(gr.game_type::text, 'general') END AS game_type,
            COALESCE(SUM(CASE WHEN wt.type = 'game_debit' AND wt.status = 'completed' THEN wt.amount ELSE 0 END), 0)::float AS turnover,
            COALESCE(SUM(CASE WHEN wt.type = 'game_debit' THEN wt.amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN wt.type = 'game_credit' THEN wt.amount ELSE 0 END), 0)::float AS net_house_win
     FROM wallet_transactions wt
     JOIN users u ON u.id = wt.user_id
     LEFT JOIN game_rooms gr ON gr.id::text = wt.reference_id
     WHERE u.agent_id IS NOT NULL
       AND wt.type IN ('game_debit', 'game_credit')
       AND wt.status = 'completed'
       AND wt.created_at >= ($1::date AT TIME ZONE 'Asia/Kolkata')
       AND wt.created_at <  (($1::date + 1) AT TIME ZONE 'Asia/Kolkata')
     GROUP BY u.agent_id, CASE WHEN wt.description ILIKE '%color%' THEN 'color_prediction' WHEN wt.description ILIKE '%matka%' THEN 'matka' WHEN wt.description ILIKE '%cricket%' THEN 'cricket' WHEN wt.description ILIKE '%aviator%' THEN 'aviator' ELSE COALESCE(gr.game_type::text, 'general') END`,
    [targetDate]
  )
  const playerLosses: PlayerNetLoss[] = lossesRes.rows.map(r => ({
    agentId: r.agent_id,
    gameType: r.game_type,
    netHouseWin: parseFloat(r.net_house_win),
    turnover: parseFloat(r.turnover),
  }))

  const results = calculateDailySettlement(agents, playerLosses)
  if (results.length === 0) return []

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    for (const r of results) {
      const existingLedger = await client.query(
        `SELECT total_commission::float FROM agent_commission_ledger WHERE agent_id = $1 AND date = $2 FOR UPDATE`,
        [r.agentId, targetDate]
      )
      const oldTotal = existingLedger.rows.length > 0 ? parseFloat(existingLedger.rows[0].total_commission) : 0
      const delta = Math.round((r.totalCommission - oldTotal) * 100) / 100

      await client.query(
        `INSERT INTO agent_commission_ledger (agent_id, date, direct_commission, override_commission, total_commission, game_breakdown)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_id, date) DO UPDATE SET
           direct_commission = EXCLUDED.direct_commission,
           override_commission = EXCLUDED.override_commission,
           total_commission = EXCLUDED.total_commission,
           game_breakdown = EXCLUDED.game_breakdown`,
        [r.agentId, targetDate, r.directCommission, r.overrideCommission, r.totalCommission, JSON.stringify(r.gameBreakdown)]
      )

      if (delta > 0) {
        await client.query(
          `INSERT INTO agent_wallets (agent_id, balance, total_earned)
           VALUES ($1, $2, $2)
           ON CONFLICT (agent_id) DO UPDATE SET
             balance = agent_wallets.balance + EXCLUDED.balance,
             total_earned = agent_wallets.total_earned + EXCLUDED.total_earned,
             updated_at = NOW()`,
          [r.agentId, delta]
        )
      }
    }
    await client.query('COMMIT')
    log(`[agent-settlement] synced ${targetDate}: ${results.length} agent(s) processed`)
    return results
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

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
    await syncRealtimeCommissionForDate(this.db, dateStr, this.log)
  }
}
